import { createHash } from "node:crypto";
import type { Page } from "playwright";
import type {
  ActionRisk,
  AppGraph,
  CandidateAction,
  EffectiveConfig,
  ElementRef,
  RouteNode,
} from "./contracts.js";
import { SCHEMA_VERSION } from "./contracts.js";

const riskyWords =
  /\b(delete|remove|destroy|pay|buy|purchase|send|publish|invite|logout|sign\s*out)\b/i;
const trackingParameter = /^(utm_.+|fbclid|gclid)$/i;
export const INTERACTIVE_SELECTOR =
  "a,button,input,select,textarea,[role],[onclick],[tabindex],[style*='cursor']";

interface ExtractedElement {
  element: ElementRef;
  kind: CandidateAction["kind"];
  href?: string;
}

export async function exploreApplication(options: {
  page: Page;
  target: string;
  config: EffectiveConfig;
  signal: AbortSignal;
}): Promise<AppGraph> {
  const root = canonicalizeUrl(options.target);
  const queue: Array<{ url: string; depth: number }> = [
    { url: root, depth: 0 },
  ];
  const queued = new Set([root]);
  const visited = new Set<string>();
  const queryVariants = new Map<string, number>();
  const routes: RouteNode[] = [];
  const stopReasons: string[] = [];
  const startedAt = performance.now();
  let actionCount = 0;
  let skippedActions = 0;
  let skippedByPolicy = 0;
  let budgetExhausted = 0;
  const budgetLimits = new Set<string>();

  while (queue.length > 0) {
    if (options.signal.aborted) {
      stopReasons.push("cancelled");
      break;
    }
    if (
      performance.now() - startedAt >=
      options.config.exploration.crawlTimeoutMs
    ) {
      stopReasons.push("crawl-timeout");
      break;
    }
    if (routes.length >= options.config.maxPages) {
      stopReasons.push("max-pages");
      break;
    }
    const current = queue.shift();
    if (!current || visited.has(current.url)) continue;
    visited.add(current.url);
    try {
      await options.page.goto(current.url, {
        waitUntil: "domcontentloaded",
        timeout: options.config.timeoutMs,
      });
      if (options.config.browser.settleMs > 0)
        await options.page.waitForTimeout(options.config.browser.settleMs);
    } catch (error) {
      const cancelled = options.signal.aborted;
      const timedOut = error instanceof Error && /timeout/i.test(error.message);
      stopReasons.push(
        cancelled
          ? "cancelled"
          : timedOut
            ? "navigation-timeout"
            : "navigation-failed",
      );
      routes.push({
        url: current.url,
        depth: current.depth,
        title: "",
        stateSignature: "navigation-failed",
        elements: [],
        actions: [],
        navigationStatus: cancelled
          ? "cancelled"
          : timedOut
            ? "timed-out"
            : "navigation-failed",
      });
      continue;
    }
    const extracted = await extractElements(options.page, current.url);
    const actions: CandidateAction[] = [];
    for (const candidate of extracted) {
      actionCount += 1;
      const decision = classifyAction(candidate, current.url, options.config);
      let outcome: CandidateAction["outcome"] = "skipped";
      if (actionCount > options.config.exploration.maxActions) {
        outcome = "budget-exhausted";
        skippedActions += 1;
        budgetExhausted += 1;
        budgetLimits.add("max-actions");
      } else if (
        decision.risk === "safe" &&
        candidate.kind === "navigate" &&
        decision.destination
      ) {
        const destination = decision.destination;
        const path = new URL(destination).pathname;
        const variants = queryVariants.get(path) ?? 0;
        if (
          new URL(destination).search &&
          variants >= options.config.exploration.maxQueryVariantsPerPath
        ) {
          decision.reason = "query-variant budget reached";
          skippedActions += 1;
          budgetExhausted += 1;
          budgetLimits.add("max-query-variants-per-path");
        } else if (current.depth >= options.config.maxDepth) {
          decision.reason = "max-depth reached";
          skippedActions += 1;
          budgetExhausted += 1;
          budgetLimits.add("max-depth");
        } else if (queued.has(destination)) {
          decision.reason = "already discovered";
          skippedActions += 1;
        } else {
          if (new URL(destination).search)
            queryVariants.set(path, variants + 1);
          queue.push({ url: destination, depth: current.depth + 1 });
          queued.add(destination);
          outcome = "queued";
        }
      } else if (decision.risk === "safe" && candidate.kind === "click") {
        // The behavior checker owns execution, but the action is scheduled now.
        outcome = "queued";
      } else {
        skippedActions += 1;
        skippedByPolicy += 1;
      }
      actions.push({
        id: `action-${current.depth}-${actions.length + 1}`,
        routeUrl: current.url,
        element: candidate.element,
        kind: candidate.kind,
        risk: decision.risk,
        reason: decision.reason,
        destination: decision.destination,
        outcome,
      });
    }
    routes.push({
      url: current.url,
      depth: current.depth,
      title: await options.page.title(),
      stateSignature: signature(extracted.map((item) => item.element)),
      elements: extracted.map((item) => item.element),
      actions,
      navigationStatus: "visited",
    });
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    target: root,
    routes,
    coverage: {
      status:
        queue.length === 0 &&
        stopReasons.length === 0 &&
        budgetLimits.size === 0
          ? "complete"
          : "incomplete",
      visitedPages: routes.length,
      discoveredPages: queued.size,
      pendingRoutes: queue.map((item) => item.url),
      skippedActions,
      stopReasons: [...stopReasons, ...budgetLimits],
      skippedByPolicy,
      budgetExhausted,
    },
  };
}

export function canonicalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()])
    if (trackingParameter.test(key)) url.searchParams.delete(key);
  const entries = [...url.searchParams.entries()].sort(
    ([firstKey, firstValue], [secondKey, secondValue]) =>
      firstKey.localeCompare(secondKey) ||
      firstValue.localeCompare(secondValue),
  );
  url.search = "";
  for (const [key, entry] of entries) url.searchParams.append(key, entry);
  return url.toString();
}

async function extractElements(
  page: Page,
  baseUrl: string,
): Promise<ExtractedElement[]> {
  return page.locator(INTERACTIVE_SELECTOR).evaluateAll((nodes, pageBase) => {
    const roleFor = (element: Element): string =>
      element.getAttribute("role") ??
      {
        A: "link",
        BUTTON: "button",
        INPUT: "input",
        SELECT: "select",
        TEXTAREA: "textbox",
      }[element.tagName] ??
      "interactive";
    return nodes.map((node, index) => {
      const element = node as HTMLElement;
      const computed = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const attributes = [
        "href",
        "type",
        "name",
        "aria-label",
        "title",
        "download",
        "formaction",
        "disabled",
        "tabindex",
        "role",
        "aria-controls",
        "aria-expanded",
        "aria-haspopup",
        "aria-labelledby",
        "aria-modal",
        "aria-pressed",
        "alt",
        "data-walkdown-safe",
      ].reduce<Record<string, string>>((result, name) => {
        const value = element.getAttribute(name);
        if (value !== null) result[name] = value;
        return result;
      }, {});
      const href =
        element instanceof HTMLAnchorElement && element.href
          ? new URL(element.href, pageBase).toString()
          : undefined;
      const kind =
        element instanceof HTMLAnchorElement && element.hasAttribute("download")
          ? "download"
          : element instanceof HTMLAnchorElement
            ? "navigate"
            : element instanceof HTMLInputElement && element.type === "file"
              ? "upload"
              : element instanceof HTMLInputElement ||
                  element instanceof HTMLTextAreaElement
                ? "input"
                : element instanceof HTMLSelectElement
                  ? "select"
                  : element.closest("form")
                    ? "submit"
                    : "click";
      const labelledBy = (element.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      const labels =
        element instanceof HTMLInputElement ||
        element instanceof HTMLSelectElement ||
        element instanceof HTMLTextAreaElement
          ? [...(element.labels ?? [])]
              .map((label) => label.innerText.trim())
              .filter(Boolean)
              .join(" ")
          : "";
      const descendantAlternative =
        element.querySelector("img[alt]")?.getAttribute("alt") ||
        element.querySelector("svg title")?.textContent?.trim() ||
        "";
      const name =
        element.getAttribute("aria-label") ||
        labelledBy ||
        labels ||
        element.getAttribute("title") ||
        element.innerText.trim() ||
        descendantAlternative ||
        element.getAttribute("alt") ||
        element.getAttribute("name") ||
        "";
      const context =
        element
          .closest("section,article,main,nav,form")
          ?.getAttribute("aria-label") ||
        element
          .closest("section,article,main,nav,form")
          ?.tagName.toLowerCase() ||
        "document";
      const clickHints: Array<"handler" | "pointer"> = [];
      if (
        element.hasAttribute("onclick") ||
        typeof element.onclick === "function"
      )
        clickHints.push("handler");
      if (computed.cursor === "pointer") clickHints.push("pointer");
      return {
        element: {
          id: `element-${index + 1}`,
          role: roleFor(element),
          name,
          text: element.innerText.trim() || undefined,
          attributes,
          context,
          visible:
            computed.visibility !== "hidden" &&
            computed.display !== "none" &&
            rect.width > 0 &&
            rect.height > 0,
          tagName: element.tagName.toLowerCase(),
          clickHints,
          bounds: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        },
        kind,
        href,
      };
    });
  }, baseUrl);
}

function classifyAction(
  candidate: ExtractedElement,
  routeUrl: string,
  config: EffectiveConfig,
): { risk: ActionRisk; reason: string; destination?: string } {
  const text = `${candidate.element.name} ${candidate.element.text ?? ""} ${Object.values(candidate.element.attributes).join(" ")}`;
  if (riskyWords.test(text))
    return {
      risk: "destructive",
      reason: "matched protected action vocabulary",
    };
  if (candidate.kind === "upload")
    return { risk: "side-effect", reason: "file upload is blocked by default" };
  if (candidate.kind === "submit")
    return {
      risk: "side-effect",
      reason: "form submission is blocked by default",
    };
  if (candidate.kind === "input" || candidate.kind === "select")
    return {
      risk: "unknown",
      reason: "form control is not activated by default",
    };
  if (candidate.kind === "click") {
    if (
      candidate.element.tagName === "button" &&
      !("disabled" in candidate.element.attributes) &&
      (config.checks.interaction.allowButtonClicks ||
        candidate.element.attributes["aria-controls"] !== undefined ||
        candidate.element.attributes["aria-expanded"] !== undefined ||
        candidate.element.attributes["aria-haspopup"] !== undefined ||
        candidate.element.attributes["aria-pressed"] !== undefined ||
        candidate.element.attributes["data-walkdown-safe"] !== undefined)
    )
      return {
        risk: "safe",
        reason: "authorized or reversible native non-form button",
      };
    return {
      risk: "unknown",
      reason: "non-native or ambiguous click control is not activated",
    };
  }
  if (candidate.kind !== "navigate")
    return {
      risk: "unknown",
      reason: "non-navigation control is not activated by default",
    };
  const rawHref = candidate.element.attributes.href?.trim() ?? "";
  if (
    rawHref === "" ||
    rawHref.startsWith("#") ||
    /^javascript\s*:/i.test(rawHref)
  )
    return {
      risk: "unknown",
      reason: "placeholder navigation target is not activated",
    };
  if (!candidate.href)
    return {
      risk: "unknown",
      reason: "navigation target is unavailable",
    };
  const parsedDestination = new URL(candidate.href);
  if (
    parsedDestination.protocol !== "http:" &&
    parsedDestination.protocol !== "https:"
  )
    return {
      risk: "external",
      reason: `${parsedDestination.protocol} navigation is not checked`,
    };
  const destination = canonicalizeUrl(candidate.href);
  const origin = new URL(routeUrl).origin;
  if (new URL(destination).origin !== origin) {
    if (
      !config.exploration.allowExternalNavigation ||
      !config.allowedOrigins.includes(new URL(destination).origin)
    )
      return {
        risk: "external",
        reason: "external navigation is blocked by policy",
        destination,
      };
  }
  if (!matchesFilters(destination, config))
    return {
      risk: "unknown",
      reason: "route excluded by include/exclude policy",
      destination,
    };
  return { risk: "safe", reason: "same-origin GET navigation", destination };
}

function matchesFilters(url: string, config: EffectiveConfig): boolean {
  const value = new URL(url).pathname;
  if (config.exclude.some((pattern) => matchesPattern(value, pattern)))
    return false;
  return (
    config.include.length === 0 ||
    config.include.some((pattern) => matchesPattern(value, pattern))
  );
}

function matchesPattern(value: string, pattern: string): boolean {
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*");
  return new RegExp(`^${expression}$`).test(value);
}

function signature(elements: ElementRef[]): string {
  return createHash("sha256")
    .update(
      elements
        .map((element) => `${element.role}:${element.name}:${element.context}`)
        .join("|"),
    )
    .digest("hex")
    .slice(0, 16);
}
