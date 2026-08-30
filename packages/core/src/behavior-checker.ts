import { createHash } from "node:crypto";
import type { BrowserContext, Locator, Page } from "playwright";
import type {
  AppGraph,
  CandidateAction,
  EffectiveConfig,
  ElementRef,
  InteractionAttempt,
  ObservableEffect,
  Observation,
  PageStateDigest,
  Viewport,
} from "./contracts.js";
import { INTERACTIVE_SELECTOR } from "./safe-explorer.js";

export interface BehaviorCheckResult {
  attempts: InteractionAttempt[];
}

type Observe = (
  kind: Observation["kind"],
  data: Record<string, unknown>,
) => void;

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const modalSelector = "dialog[open],[role=dialog],[aria-modal=true]";

export async function runBehaviorChecks(options: {
  context: BrowserContext;
  appGraph: AppGraph;
  config: EffectiveConfig;
  signal: AbortSignal;
  observe: Observe;
  focus?: {
    routeUrl: string;
    element: Pick<ElementRef, "role" | "name" | "context">;
    action: Pick<CandidateAction, "kind" | "risk">;
  };
}): Promise<BehaviorCheckResult> {
  const attempts: InteractionAttempt[] = [];
  const primaryViewport = options.config.viewports[0];
  if (primaryViewport) {
    for (const route of options.appGraph.routes) {
      const safeActions = options.focus
        ? focusedActions(route.actions, route.url, options.focus)
        : route.actions
            .filter(isSafeClick)
            .slice(0, options.config.checks.interaction.maxControlsPerPage);
      for (const action of safeActions) {
        if (options.signal.aborted) return { attempts };
        const attempt = await probeInteraction({
          ...options,
          routeUrl: route.url,
          action,
          viewport: primaryViewport,
        });
        action.outcome =
          attempt.outcome === "inconclusive" ? "inconclusive" : "executed";
        attempts.push(attempt);
        options.observe("interaction-attempt", { ...attempt });
      }
    }
  }

  for (const route of options.appGraph.routes) {
    for (const viewport of options.config.viewports) {
      if (options.signal.aborted) return { attempts };
      await probeViewport({
        ...options,
        routeUrl: route.url,
        viewport,
      });
    }
  }

  if (primaryViewport) {
    for (const route of options.appGraph.routes) {
      const modalActions = route.actions
        .filter(isSafeModalTrigger)
        .slice(0, options.config.checks.interaction.maxControlsPerPage);
      for (const action of modalActions) {
        if (options.signal.aborted) return { attempts };
        await probeModalFocus({
          ...options,
          routeUrl: route.url,
          action,
          viewport: primaryViewport,
        });
      }
    }
  }
  return { attempts };
}

function focusedActions(
  actions: readonly CandidateAction[],
  routeUrl: string,
  focus: NonNullable<Parameters<typeof runBehaviorChecks>[0]["focus"]>,
): CandidateAction[] {
  if (routeUrl !== focus.routeUrl) return [];
  const action = actions.find(
    (candidate) =>
      candidate.kind === focus.action.kind &&
      candidate.risk === focus.action.risk &&
      candidate.element.role === focus.element.role &&
      candidate.element.name === focus.element.name &&
      candidate.element.context === focus.element.context,
  );
  return action && isSafeClick(action) ? [action] : [];
}

async function probeInteraction(options: {
  context: BrowserContext;
  config: EffectiveConfig;
  signal: AbortSignal;
  observe: Observe;
  routeUrl: string;
  action: CandidateAction;
  viewport: Viewport;
}): Promise<InteractionAttempt> {
  const page = await options.context.newPage();
  await page.setViewportSize({
    width: options.viewport.width,
    height: options.viewport.height,
  });
  const postActionRequests: Array<{
    url: string;
    method: string;
    resourceType: string;
    sequence: number;
  }> = [];
  let actionStarted = false;
  let dialogObserved = false;
  let downloadObserved = false;
  let popupObserved = false;
  const popups: Page[] = [];
  const dialogTasks = new Set<Promise<void>>();
  page.on("request", (request) => {
    if (actionStarted)
      postActionRequests.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        sequence: postActionRequests.length + 1,
      });
  });
  page.on("dialog", (dialog) => {
    dialogObserved = true;
    trackTask(dialogTasks, dialog.dismiss());
  });
  page.on("download", () => {
    downloadObserved = true;
  });
  page.on("popup", (popup) => {
    popupObserved = true;
    popups.push(popup);
    popup.on("dialog", (dialog) => trackTask(dialogTasks, dialog.dismiss()));
    trackTask(dialogTasks, closeBehaviorPopup(popup));
  });

  const base: Omit<InteractionAttempt, "outcome" | "effects" | "reason"> = {
    routeUrl: options.routeUrl,
    viewport: options.viewport.name,
    element: options.action.element,
  };
  try {
    await page.goto(options.routeUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.config.timeoutMs,
    });
    await settle(page, options.config.checks.interaction.layoutSettleMs);
    const locator = await reidentify(page, options.action.element);
    if (!locator)
      return {
        ...base,
        outcome: "inconclusive",
        effects: [],
        reason: "control could not be reidentified",
      };
    const firstBaseline = await captureDigest(
      page,
      options.config.checks.interaction.dynamicSelectors,
    );
    await settle(page, options.config.checks.interaction.stabilityMs);
    const before = await captureDigest(
      page,
      options.config.checks.interaction.dynamicSelectors,
    );
    if (!stableDigest(firstBaseline, before))
      return {
        ...base,
        outcome: "inconclusive",
        effects: [],
        before,
        reason: "page state was unstable before the action",
      };
    const triggerFocus = await locator.evaluate(focusIdentity);
    actionStarted = true;
    try {
      await locator.click({
        timeout: interactionTimeout(options.config),
      });
    } catch (error) {
      return {
        ...base,
        outcome: "inconclusive",
        effects: [],
        before,
        reason: `action could not be executed: ${errorMessage(error)}`,
      };
    }
    await waitForPotentialEffect(
      page,
      before,
      options.config.checks.interaction,
      () => dialogObserved || downloadObserved || popupObserved,
    );
    const after = await captureDigest(
      page,
      options.config.checks.interaction.dynamicSelectors,
    );
    const effects = observableEffects({
      before,
      after,
      triggerFocus,
      postActionRequests,
      ignoreRequestPatterns:
        options.config.checks.interaction.ignoreRequestPatterns,
      dialogObserved,
      downloadObserved,
      popupObserved,
    });
    return {
      ...base,
      outcome: effects.length > 0 ? "pass" : "fail",
      effects,
      before,
      after,
      reason:
        effects.length > 0
          ? "action produced an allowed observable effect"
          : "action completed technically without an observable effect",
    };
  } catch (error) {
    return {
      ...base,
      outcome: "inconclusive",
      effects: [],
      reason: `probe could not complete: ${errorMessage(error)}`,
    };
  } finally {
    await drainTrackedTasks(dialogTasks);
    await Promise.all(
      popups.map((popup) => popup.close().catch(() => undefined)),
    );
    await page.close().catch(() => undefined);
  }
}

async function probeViewport(options: {
  context: BrowserContext;
  config: EffectiveConfig;
  signal: AbortSignal;
  observe: Observe;
  routeUrl: string;
  viewport: Viewport;
}): Promise<void> {
  const page = await options.context.newPage();
  const drainDialogs = installDialogDismissal(page);
  await page.setViewportSize({
    width: options.viewport.width,
    height: options.viewport.height,
  });
  try {
    await page.goto(options.routeUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.config.timeoutMs,
    });
    await settle(page, options.config.checks.interaction.layoutSettleMs);
    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      const overflowBy = Math.max(0, root.scrollWidth - root.clientWidth);
      let offender: { tagName: string; id: string; right: number } | undefined;
      for (const candidate of document.body.querySelectorAll("*")) {
        const element = candidate as HTMLElement;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          rect.width === 0 ||
          rect.right <= root.clientWidth + 1
        )
          continue;
        if (!offender || rect.right > offender.right)
          offender = {
            tagName: element.tagName.toLowerCase(),
            id: element.id,
            right: Math.round(rect.right),
          };
      }
      return {
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
        overflowBy,
        offender,
      };
    });
    if (overflow.overflowBy > 1)
      options.observe("layout-check", {
        issue: "horizontal-overflow",
        routeUrl: options.routeUrl,
        viewport: options.viewport,
        ...overflow,
      });

    const controls = page.locator(INTERACTIVE_SELECTOR);
    const count = Math.min(
      await controls.count(),
      Math.max(options.config.checks.interaction.maxControlsPerPage * 2, 20),
    );
    for (let index = 0; index < count; index += 1) {
      if (options.signal.aborted) return;
      const locator = controls.nth(index);
      const details = await controlDetails(locator, index).catch(
        () => undefined,
      );
      if (!details?.visible || details.disabled) continue;
      if (details.pseudoControl)
        options.observe("accessibility-check", {
          issue: "pseudo-control",
          outcome: "fail",
          routeUrl: options.routeUrl,
          viewport: options.viewport,
          element: details.element,
          reason: details.pseudoReason,
        });
      if (details.interactive && details.name === "")
        options.observe("accessibility-check", {
          issue: "missing-name",
          outcome: "fail",
          routeUrl: options.routeUrl,
          viewport: options.viewport,
          element: details.element,
        });
      if (!details.interactive) continue;
      try {
        await locator.scrollIntoViewIfNeeded({
          timeout: Math.min(options.config.timeoutMs, 2_000),
        });
      } catch {
        options.observe("layout-check", {
          issue: "outside-viewport",
          routeUrl: options.routeUrl,
          viewport: options.viewport,
          element: details.element,
          reason: "control could not be scrolled into view",
        });
        continue;
      }
      const box = await locator.boundingBox();
      if (!box) continue;
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      if (
        center.x < 0 ||
        center.y < 0 ||
        center.x > options.viewport.width ||
        center.y > options.viewport.height
      ) {
        options.observe("layout-check", {
          issue: "outside-viewport",
          routeUrl: options.routeUrl,
          viewport: options.viewport,
          element: details.element,
          bounds: roundedBox(box),
        });
        continue;
      }
      const hit = await locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const pointerEvents = getComputedStyle(element).pointerEvents;
        const top = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return {
          actionable:
            pointerEvents !== "none" &&
            (top === element || element.contains(top)),
          coveringTag: top?.tagName.toLowerCase(),
          coveringId: (top as HTMLElement | null)?.id,
        };
      });
      if (!hit.actionable)
        options.observe("layout-check", {
          issue: "obstructed-control",
          routeUrl: options.routeUrl,
          viewport: options.viewport,
          element: details.element,
          bounds: roundedBox(box),
          coveringTag: hit.coveringTag,
          coveringId: hit.coveringId,
          reason: "center point is covered or ignores pointer events",
        });
    }
    await probeKeyboard(options, page);
  } catch (error) {
    options.observe("accessibility-check", {
      issue: "viewport-probe",
      outcome: "inconclusive",
      routeUrl: options.routeUrl,
      viewport: options.viewport,
      reason: errorMessage(error),
    });
  } finally {
    await drainDialogs();
    await page.close().catch(() => undefined);
  }
}

async function probeKeyboard(
  options: {
    config: EffectiveConfig;
    observe: Observe;
    routeUrl: string;
    viewport: Viewport;
  },
  page: Page,
): Promise<void> {
  const expected = await page.locator(focusableSelector).evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const element = node as HTMLElement;
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map((node, index) => {
        const element = node as HTMLElement;
        const key = `focus-${index + 1}`;
        element.dataset.walkdownFocusKey = key;
        return key;
      }),
  );
  if (expected.length === 0) return;
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  });
  const reached = new Set<string>();
  const maximum = Math.min(
    options.config.checks.interaction.keyboardMaxSteps,
    expected.length + 3,
  );
  let lostFocus = false;
  for (let step = 0; step < maximum; step += 1) {
    await page.keyboard.press("Tab");
    const key = await page.evaluate(
      () =>
        (document.activeElement as HTMLElement | null)?.dataset
          .walkdownFocusKey,
    );
    if (!key) {
      if (step > 0) lostFocus = true;
      continue;
    }
    if (reached.has(key)) break;
    reached.add(key);
    if (reached.size === expected.length) break;
  }
  const unreachable = expected.filter((key) => !reached.has(key));
  if (!lostFocus && unreachable.length === 0) return;
  const budgetLimited =
    options.config.checks.interaction.keyboardMaxSteps < expected.length;
  options.observe("accessibility-check", {
    issue: "keyboard-focus",
    outcome: budgetLimited ? "inconclusive" : "fail",
    routeUrl: options.routeUrl,
    viewport: options.viewport,
    reached: [...reached],
    unreachable,
    lostFocus,
    reason: budgetLimited
      ? "keyboard traversal budget was exhausted"
      : lostFocus
        ? "keyboard traversal lost document focus"
        : "keyboard traversal cycled before reaching all controls",
  });
}

async function probeModalFocus(options: {
  context: BrowserContext;
  config: EffectiveConfig;
  signal: AbortSignal;
  observe: Observe;
  routeUrl: string;
  action: CandidateAction;
  viewport: Viewport;
}): Promise<void> {
  const page = await options.context.newPage();
  const drainDialogs = installDialogDismissal(page);
  await page.setViewportSize({
    width: options.viewport.width,
    height: options.viewport.height,
  });
  try {
    await page.goto(options.routeUrl, {
      waitUntil: "domcontentloaded",
      timeout: options.config.timeoutMs,
    });
    await settle(page, options.config.checks.interaction.layoutSettleMs);
    const trigger = await reidentify(page, options.action.element);
    if (!trigger) {
      observeModal(
        options,
        "inconclusive",
        "modal trigger could not be reidentified",
      );
      return;
    }
    await trigger.evaluate((element) => {
      (element as HTMLElement).dataset.walkdownModalTrigger = "true";
    });
    try {
      await trigger.click({ timeout: interactionTimeout(options.config) });
    } catch (error) {
      observeModal(
        options,
        "inconclusive",
        `modal trigger could not be executed: ${errorMessage(error)}`,
      );
      return;
    }
    await settle(page, options.config.checks.interaction.effectTimeoutMs);
    const modal = page.locator(modalSelector).filter({ visible: true }).first();
    if ((await modal.count()) === 0) return;
    const entryInside = await modal.evaluate((element) =>
      element.contains(document.activeElement),
    );
    const focusableCount = await modal.locator(focusableSelector).count();
    let contained = true;
    for (let step = 0; step < Math.max(focusableCount + 1, 2); step += 1) {
      await page.keyboard.press("Tab");
      if (
        !(await modal.evaluate((element) =>
          element.contains(document.activeElement),
        ))
      ) {
        contained = false;
        break;
      }
    }
    await page.keyboard.press("Escape");
    await settle(
      page,
      Math.min(options.config.checks.interaction.effectTimeoutMs, 250),
    );
    const stillOpen = await modal.isVisible().catch(() => false);
    const returned = await page.evaluate(
      () =>
        (document.activeElement as HTMLElement | null)?.dataset
          .walkdownModalTrigger === "true",
    );
    if (!entryInside || !contained || (!stillOpen && !returned)) {
      const failures = [
        !entryInside ? "focus did not enter the modal" : undefined,
        !contained ? "Tab moved focus outside the modal" : undefined,
        !stillOpen && !returned
          ? "focus was not returned to the trigger"
          : undefined,
      ].filter((value): value is string => value !== undefined);
      observeModal(options, "fail", failures.join("; "), {
        entryInside,
        contained,
        returned,
        stillOpen,
      });
    } else if (stillOpen) {
      observeModal(
        options,
        "inconclusive",
        "modal remained open, so focus return could not be evaluated",
        { entryInside, contained, stillOpen },
      );
    }
  } catch (error) {
    observeModal(options, "inconclusive", errorMessage(error));
  } finally {
    await drainDialogs();
    await page.close().catch(() => undefined);
  }
}

function observeModal(
  options: {
    observe: Observe;
    routeUrl: string;
    viewport: Viewport;
    action: CandidateAction;
  },
  outcome: "fail" | "inconclusive",
  reason: string,
  extra: Record<string, unknown> = {},
): void {
  options.observe("accessibility-check", {
    issue: "modal-focus",
    outcome,
    routeUrl: options.routeUrl,
    viewport: options.viewport,
    element: options.action.element,
    reason,
    ...extra,
  });
}

async function reidentify(
  page: Page,
  expected: ElementRef,
): Promise<Locator | undefined> {
  const match = /^element-(\d+)$/.exec(expected.id);
  if (!match) return undefined;
  const index = Number(match[1]) - 1;
  const locator = page.locator(INTERACTIVE_SELECTOR).nth(index);
  if (
    index < 0 ||
    (await locator.count()) === 0 ||
    !(await locator.isVisible())
  )
    return undefined;
  const actual = await locator.evaluate((element) => {
    const html = element as HTMLElement;
    const role =
      html.getAttribute("role") ??
      ({
        A: "link",
        BUTTON: "button",
        INPUT: "input",
        SELECT: "select",
        TEXTAREA: "textbox",
      }[html.tagName] ||
        "interactive");
    const labelledBy = (html.getAttribute("aria-labelledby") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
    const labels =
      html instanceof HTMLInputElement ||
      html instanceof HTMLSelectElement ||
      html instanceof HTMLTextAreaElement
        ? [...(html.labels ?? [])]
            .map((label) => label.innerText.trim())
            .filter(Boolean)
            .join(" ")
        : "";
    const descendantAlternative =
      html.querySelector("img[alt]")?.getAttribute("alt") ||
      html.querySelector("svg title")?.textContent?.trim() ||
      "";
    const name =
      html.getAttribute("aria-label") ||
      labelledBy ||
      labels ||
      html.getAttribute("title") ||
      html.innerText.trim() ||
      descendantAlternative ||
      html.getAttribute("alt") ||
      html.getAttribute("name") ||
      "";
    return { role, name, tagName: html.tagName.toLowerCase() };
  });
  return actual.role === expected.role &&
    actual.name === expected.name &&
    (!expected.tagName || actual.tagName === expected.tagName)
    ? locator
    : undefined;
}

async function captureDigest(
  page: Page,
  dynamicSelectors: readonly string[],
): Promise<PageStateDigest> {
  const raw = await page.evaluate(
    ({ selectors, modalSelectorValue }) => {
      const isDynamic = (element: Element): boolean =>
        selectors.some((selector) => {
          try {
            return (
              element.matches(selector) || element.closest(selector) !== null
            );
          } catch {
            return false;
          }
        });
      const visibleText: string[] = [];
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );
      let textNode = walker.nextNode();
      while (textNode) {
        const parent = textNode.parentElement;
        const text = textNode.textContent?.trim();
        if (parent && text && !isDynamic(parent)) {
          const style = getComputedStyle(parent);
          if (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            parent.getClientRects().length > 0
          )
            visibleText.push(text);
        }
        textNode = walker.nextNode();
      }
      const root = document.body.cloneNode(true) as HTMLElement;
      for (const selector of selectors) {
        try {
          for (const node of root.querySelectorAll(selector)) node.remove();
        } catch {
          // Invalid user selectors are ignored by the probe and remain visible in config.
        }
      }
      for (const node of root.querySelectorAll(
        "script,style,noscript,template",
      ))
        node.remove();
      for (const element of root.querySelectorAll("*")) {
        for (const attribute of [...element.attributes])
          if (
            attribute.name === "class" ||
            attribute.name === "style" ||
            attribute.name === "id" ||
            attribute.name === "nonce" ||
            attribute.name.startsWith("data-react") ||
            attribute.name.startsWith("data-v-")
          )
            element.removeAttribute(attribute.name);
      }
      const active = (document.activeElement ?? document.body) as HTMLElement;
      const activeName =
        active === document.body
          ? ""
          : active.getAttribute?.("aria-label") ||
            active.getAttribute?.("title") ||
            active.innerText?.trim() ||
            active.getAttribute?.("name") ||
            "";
      const focus = `${active.tagName?.toLowerCase() ?? "unknown"}:${activeName}`;
      const feedback = [
        ...document.querySelectorAll("[role=status],[role=alert],[aria-live]"),
      ]
        .map((node) => (node as HTMLElement).innerText.trim())
        .join("|");
      const dialogs = [...document.querySelectorAll(modalSelectorValue)].filter(
        (node) => {
          const element = node as HTMLElement;
          const style = getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden";
        },
      ).length;
      return {
        url: location.href,
        dom: `${root.innerHTML}|visible:${visibleText.join("|")}`,
        focus,
        feedback,
        dialogs,
      };
    },
    { selectors: [...dynamicSelectors], modalSelectorValue: modalSelector },
  );
  return {
    url: raw.url,
    domHash: hash(normalizeDynamicText(raw.dom)),
    focus: raw.focus,
    feedbackHash: hash(normalizeDynamicText(raw.feedback)),
    dialogCount: raw.dialogs,
  };
}

function focusIdentity(element: Element): string {
  const html = element as HTMLElement;
  const name =
    html === document.body
      ? ""
      : html.getAttribute?.("aria-label") ||
        html.getAttribute?.("title") ||
        html.innerText?.trim() ||
        html.getAttribute?.("name") ||
        "";
  return `${html.tagName?.toLowerCase() ?? "unknown"}:${name}`;
}

function observableEffects(options: {
  before: PageStateDigest;
  after: PageStateDigest;
  triggerFocus: string;
  postActionRequests: ReadonlyArray<{
    url: string;
    method: string;
    resourceType: string;
    sequence: number;
  }>;
  ignoreRequestPatterns: readonly string[];
  dialogObserved: boolean;
  downloadObserved: boolean;
  popupObserved: boolean;
}): ObservableEffect[] {
  const effects: ObservableEffect[] = [];
  if (options.before.url !== options.after.url)
    effects.push({ kind: "navigation", detail: options.after.url });
  if (
    options.before.domHash !== options.after.domHash ||
    options.before.dialogCount !== options.after.dialogCount
  )
    effects.push({ kind: "dom-mutation" });
  const request = options.postActionRequests.find(
    (candidate) =>
      !matchesAny(candidate.url, options.ignoreRequestPatterns) &&
      candidate.resourceType !== "eventsource",
  );
  if (request)
    effects.push({
      kind: "request",
      detail: `${request.method} ${request.url} #${request.sequence}`,
    });
  if (options.dialogObserved) effects.push({ kind: "dialog" });
  if (options.downloadObserved) effects.push({ kind: "download" });
  if (options.popupObserved) effects.push({ kind: "popup" });
  if (
    options.before.focus !== options.after.focus &&
    options.after.focus !== options.triggerFocus &&
    !options.after.focus.startsWith("body:")
  )
    effects.push({ kind: "focus", detail: options.after.focus });
  if (options.before.feedbackHash !== options.after.feedbackHash)
    effects.push({ kind: "accessible-feedback" });
  return effects.filter(
    (effect, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.kind === effect.kind && candidate.detail === effect.detail,
      ) === index,
  );
}

async function waitForPotentialEffect(
  page: Page,
  before: PageStateDigest,
  config: EffectiveConfig["checks"]["interaction"],
  directEffect: () => boolean,
): Promise<void> {
  const deadline = performance.now() + config.effectTimeoutMs;
  while (performance.now() < deadline) {
    if (directEffect()) return;
    await settle(page, Math.min(50, Math.max(1, deadline - performance.now())));
    if (page.isClosed()) return;
    const current = await captureDigest(page, config.dynamicSelectors).catch(
      () => undefined,
    );
    if (current && !stableDigest(before, current)) return;
  }
}

async function controlDetails(
  locator: Locator,
  index: number,
): Promise<{
  visible: boolean;
  disabled: boolean;
  interactive: boolean;
  pseudoControl: boolean;
  pseudoReason?: string;
  name: string;
  element: Record<string, unknown>;
}> {
  return locator.evaluate((node, elementIndex) => {
    const element = node as HTMLElement;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const tagName = element.tagName.toLowerCase();
    const explicitRole = element.getAttribute("role") ?? "";
    const role =
      explicitRole ||
      ({
        a: "link",
        button: "button",
        input: "input",
        select: "select",
        textarea: "textbox",
      }[tagName] ??
        "interactive");
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
    const visible =
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0;
    const disabled =
      element.hasAttribute("disabled") ||
      element.getAttribute("aria-disabled") === "true";
    const nativeInteractive =
      ["button", "input", "select", "textarea"].includes(tagName) ||
      (tagName === "a" && element.hasAttribute("href"));
    const interactiveRole = [
      "button",
      "link",
      "checkbox",
      "radio",
      "switch",
      "menuitem",
      "tab",
      "textbox",
    ].includes(explicitRole);
    const hasHandler =
      element.hasAttribute("onclick") || typeof element.onclick === "function";
    const pointer = style.cursor === "pointer";
    const tabindex = element.getAttribute("tabindex");
    const pseudoControl =
      ((hasHandler || pointer) && !nativeInteractive && !interactiveRole) ||
      (interactiveRole &&
        !nativeInteractive &&
        tabindex === null &&
        role !== "link");
    const pseudoReason =
      hasHandler || pointer
        ? "click affordance lacks native or ARIA interaction semantics"
        : "non-native interactive role is not keyboard focusable";
    return {
      visible,
      disabled,
      interactive: nativeInteractive || interactiveRole,
      pseudoControl,
      pseudoReason,
      name,
      element: {
        id: `element-${Number(elementIndex) + 1}`,
        tagName,
        role,
        name,
        context:
          element
            .closest("section,article,main,nav,form")
            ?.tagName.toLowerCase() ?? "document",
      },
    };
  }, index);
}

function stableDigest(
  first: PageStateDigest,
  second: PageStateDigest,
): boolean {
  return (
    first.url === second.url &&
    first.domHash === second.domHash &&
    first.feedbackHash === second.feedbackHash &&
    first.dialogCount === second.dialogCount
  );
}

function normalizeDynamicText(value: string): string {
  return value
    .replace(
      /\b\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}:\d{2}(?:\.\d+)?z?\b/gi,
      "<timestamp>",
    )
    .replace(/\b\d{1,2}:\d{2}:\d{2}\b/g, "<time>")
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "<uuid>",
    )
    .replace(/\b\d{10,}\b/g, "<number>")
    .replace(/\s+/g, " ")
    .trim();
}

function isSafeClick(action: CandidateAction): boolean {
  return (
    action.kind === "click" &&
    action.risk === "safe" &&
    action.element.visible &&
    action.outcome !== "budget-exhausted"
  );
}

function isSafeModalTrigger(action: CandidateAction): boolean {
  return (
    isSafeClick(action) &&
    (action.element.attributes["aria-haspopup"] === "dialog" ||
      action.element.attributes["aria-controls"] !== undefined)
  );
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function matchesAny(value: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    const expression = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*");
    return new RegExp(`^${expression}$`, "i").test(value);
  });
}

function roundedBox(box: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Record<string, number> {
  return Object.fromEntries(
    Object.entries(box).map(([key, value]) => [key, Math.round(value)]),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? (error.message.split("\n")[0] ?? "unknown error")
    : String(error);
}

async function settle(page: Page, milliseconds: number): Promise<void> {
  if (milliseconds > 0 && !page.isClosed())
    await page.waitForTimeout(milliseconds);
}

function interactionTimeout(config: EffectiveConfig): number {
  return Math.min(
    config.timeoutMs,
    Math.max(500, config.checks.interaction.effectTimeoutMs * 2),
  );
}

async function closeBehaviorPopup(popup: Page): Promise<void> {
  await popup
    .waitForLoadState("domcontentloaded", { timeout: 1_000 })
    .catch(() => undefined);
  await popup.waitForTimeout(250).catch(() => undefined);
  await popup.close().catch(() => undefined);
}

function installDialogDismissal(page: Page): () => Promise<void> {
  const tasks = new Set<Promise<void>>();
  page.on("dialog", (dialog) => {
    trackTask(tasks, dialog.dismiss());
  });
  return () => drainTrackedTasks(tasks);
}

function trackTask(tasks: Set<Promise<void>>, task: Promise<unknown>): void {
  const safeTask = task.then(
    () => undefined,
    () => undefined,
  );
  tasks.add(safeTask);
  void safeTask.finally(() => tasks.delete(safeTask));
}

async function drainTrackedTasks(tasks: Set<Promise<void>>): Promise<void> {
  while (tasks.size > 0) await Promise.allSettled([...tasks]);
}
