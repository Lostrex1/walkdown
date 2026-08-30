import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
  type Request,
} from "playwright";
import { ArtifactWriter, redactText } from "./artifact-writer.js";
import {
  type BehaviorCheckResult,
  runBehaviorChecks,
} from "./behavior-checker.js";
import type {
  AppGraph,
  EffectiveConfig,
  EvidenceRef,
  FindingsArtifact,
  Observation,
  PageState,
} from "./contracts.js";
import { SCHEMA_VERSION } from "./contracts.js";
import { WalkdownError } from "./errors.js";
import { classifyNetworkRequest } from "./network-classification.js";
import { evaluateRules } from "./rules.js";
import { exploreApplication } from "./safe-explorer.js";

export interface BrowserSessionResult {
  observations: Observation[];
  evidence: EvidenceRef[];
  findings: FindingsArtifact;
  behavior: BehaviorCheckResult;
  pageState: PageState;
  appGraph: AppGraph;
  omissions: string[];
}

export async function runBrowserSession(options: {
  target: string;
  runDirectory: string;
  config: EffectiveConfig;
  signal: AbortSignal;
  focus?: {
    routeUrl: string;
    element: Pick<
      import("./contracts.js").ElementRef,
      "role" | "name" | "context"
    >;
    action: Pick<import("./contracts.js").CandidateAction, "kind" | "risk">;
  };
}): Promise<BrowserSessionResult> {
  if (options.signal.aborted)
    throw new WalkdownError(
      "CANCELLED",
      "Browser session cancelled before launch.",
      "The run was cancelled and can be started again.",
    );
  const writer = new ArtifactWriter(
    options.runDirectory,
    options.config.browser.maxArtifactBytes,
  );
  const observations: Observation[] = [];
  const pendingObserverTasks = new Set<Promise<void>>();
  const trackObserverTask = (task: Promise<unknown>) => {
    const safeTask = task.then(
      () => undefined,
      () => undefined,
    );
    pendingObserverTasks.add(safeTask);
    void safeTask.finally(() => pendingObserverTasks.delete(safeTask));
  };
  const startedAt = performance.now();
  const observe = (
    kind: Observation["kind"],
    data: Record<string, unknown>,
  ) => {
    observations.push({
      sequence: observations.length + 1,
      atMs: Math.round(performance.now() - startedAt),
      kind,
      data,
    });
  };
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let currentUrl = options.target;
  let pageState: PageState = { url: options.target, title: "" };
  let findings: FindingsArtifact = {
    schemaVersion: SCHEMA_VERSION,
    target: options.target,
    findings: [],
  };
  let behavior: BehaviorCheckResult = { attempts: [] };
  let tracingStarted = false;
  let appGraph: AppGraph = {
    schemaVersion: SCHEMA_VERSION,
    target: options.target,
    routes: [],
    coverage: {
      status: "incomplete",
      visitedPages: 0,
      discoveredPages: 0,
      pendingRoutes: [options.target],
      skippedActions: 0,
      stopReasons: ["browser-session-incomplete"],
    },
  };
  const abort = () => {
    void context?.close();
  };
  options.signal.addEventListener("abort", abort, { once: true });

  try {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      throw new WalkdownError(
        "BROWSER_UNAVAILABLE",
        "Chromium is unavailable to Walkdown.",
        "Run `npx playwright install chromium` explicitly, then retry.",
        error,
      );
    }
    const viewport = options.config.viewports[0];
    if (!viewport) {
      throw new WalkdownError(
        "INVALID_CONFIG",
        "At least one viewport is required.",
        "Configure a viewport before starting a scan.",
      );
    }
    context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      userAgent: options.config.browser.userAgent,
    });
    await writer.ensureDirectory();
    if (options.config.browser.trace) {
      await context.tracing.start({ screenshots: true, snapshots: true });
      tracingStarted = true;
    }
    page = await context.newPage();
    await validateDynamicSelectors(page, options.config);
    installObservers(page, observe, options.target, trackObserverTask);
    try {
      await page.goto(options.target, {
        waitUntil: "domcontentloaded",
        timeout: options.config.timeoutMs,
      });
    } catch (error) {
      if (options.signal.aborted)
        throw new WalkdownError(
          "CANCELLED",
          "Browser session cancelled during initial navigation.",
          "The run was cancelled and can be started again.",
          error,
        );
      throw new WalkdownError(
        "NAVIGATION_FAILED",
        `Unable to navigate to ${options.target}.`,
        "Verify the target is available and increase timeoutMs if needed.",
        error,
      );
    }
    if (options.config.browser.settleMs > 0)
      await page.waitForTimeout(options.config.browser.settleMs);
    currentUrl = page.url();
    pageState = { url: currentUrl, title: await page.title() };
    const ariaSnapshot = await page
      .locator("body")
      .ariaSnapshot()
      .catch(() => undefined);
    if (ariaSnapshot !== undefined) {
      await writer.writeText(
        "accessibility.yaml",
        "accessibility",
        redactText(ariaSnapshot),
      );
      pageState.accessibilityPath = "artifacts/accessibility.yaml";
    }
    if (options.config.browser.screenshot) {
      const screenshot = await page.screenshot({ fullPage: true });
      await writer.writeBuffer("initial.png", "screenshot", screenshot);
    }
    const graph = await exploreApplication({
      page,
      target: options.target,
      config: options.config,
      signal: options.signal,
    });
    appGraph = graph;
    if (!context)
      throw new Error("Browser context closed before behavior checks.");
    behavior = await runBehaviorChecks({
      context,
      appGraph: graph,
      config: options.config,
      signal: options.signal,
      observe,
      focus: options.focus,
    });
    reconcileActionLedger(graph, behavior);
    if (options.signal.aborted)
      throw new WalkdownError(
        "CANCELLED",
        "Browser session cancelled during exploration.",
        "The run was cancelled and can be started again.",
      );
    findings = evaluateRules({
      target: options.target,
      observations,
      appGraph: graph,
      config: options.config.checks,
    });
    await writer.writeJson("app-graph.json", "app-graph", graph);
    await writer.writeJson("observations.json", "observations", observations);
    await writer.writeJson("findings.json", "findings", findings);
  } finally {
    await drainTasks(pendingObserverTasks);
    if (context && tracingStarted) {
      try {
        await context.tracing.stop({ path: writer.artifactPath("trace.zip") });
        await writer.registerFile("trace.zip", "trace");
      } catch {
        writer.omissions.push(
          "trace.zip: trace was unavailable during cleanup",
        );
      }
    }
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    options.signal.removeEventListener("abort", abort);
    await writer.writeManifest(observations);
  }
  return {
    observations,
    evidence: writer.evidence,
    findings,
    behavior,
    pageState,
    appGraph,
    omissions: writer.omissions,
  };
}

async function validateDynamicSelectors(
  page: Page,
  config: EffectiveConfig,
): Promise<void> {
  for (const selector of config.checks.interaction.dynamicSelectors) {
    try {
      await page.locator(selector).count();
    } catch (error) {
      throw new WalkdownError(
        "INVALID_CONFIG",
        `Invalid checks.interaction.dynamicSelectors selector: ${selector}.`,
        "Correct the CSS selector before running Walkdown.",
        error,
      );
    }
  }
}

function reconcileActionLedger(
  graph: AppGraph,
  behavior: BehaviorCheckResult,
): void {
  const attempted = behavior.attempts.length;
  const executed = behavior.attempts.filter(
    (attempt) => attempt.outcome === "pass" || attempt.outcome === "fail",
  ).length;
  const inconclusive = behavior.attempts.filter(
    (attempt) => attempt.outcome === "inconclusive",
  ).length;
  graph.coverage.attemptedActions = attempted;
  graph.coverage.executedActions = executed;
  graph.coverage.inconclusiveActions = inconclusive;
  graph.coverage.skippedActions = graph.routes
    .flatMap((route) => route.actions)
    .filter(
      (action) =>
        action.outcome === "skipped" || action.outcome === "budget-exhausted",
    ).length;
}

function installObservers(
  page: Page,
  observe: (kind: Observation["kind"], data: Record<string, unknown>) => void,
  target: string,
  track: (task: Promise<unknown>) => void,
): void {
  page.on("console", (message) =>
    observe("console", {
      level: message.type(),
      text: redactText(message.text()),
      routeUrl: page.url(),
      location: message.location(),
    }),
  );
  page.on("pageerror", (error) =>
    observe("page-error", {
      message: redactText(error.message),
      routeUrl: page.url(),
      stack: error.stack ? redactText(error.stack) : undefined,
    }),
  );
  page.on("requestfailed", (request) => {
    const error = redactText(request.failure()?.errorText ?? "unknown");
    const classification = classifyNetworkRequest({
      target,
      url: request.url(),
      resourceType: request.resourceType(),
      navigation: request.isNavigationRequest(),
      errorText: error,
    });
    observe("request-failed", {
      method: request.method(),
      url: request.url(),
      error,
      routeUrl: page.url(),
      redirectChain: requestRedirectChain(request),
      ...classification,
      firstParty: classification.scope === "first-party",
    });
  });
  page.on("response", (response) => {
    const request = response.request();
    const classification = classifyNetworkRequest({
      target,
      url: response.url(),
      resourceType: request.resourceType(),
      navigation: request.isNavigationRequest(),
    });
    observe("response", {
      status: response.status(),
      method: request.method(),
      url: response.url(),
      routeUrl: page.url(),
      redirectChain: requestRedirectChain(request),
      ...classification,
      firstParty: classification.scope === "first-party",
    });
  });
  page.on("dialog", (dialog) => {
    observe("dialog", {
      type: dialog.type(),
      message: redactText(dialog.message()),
    });
    track(dialog.dismiss());
  });
  page.on("download", (download) =>
    observe("download", {
      suggestedFilename: redactText(download.suggestedFilename()),
    }),
  );
  page.on("popup", (popup) => {
    observe("popup", { url: popup.url() });
    popup.on("dialog", (dialog) => track(dialog.dismiss()));
    popup.on("popup", (child) => {
      child.on("dialog", (dialog) => track(dialog.dismiss()));
      track(child.close());
    });
    track(closePopupAfterEvents(popup));
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      observe("navigation", { url: frame.url() });
      observe("url-change", { url: frame.url() });
    }
  });
}

async function drainTasks(tasks: Set<Promise<void>>): Promise<void> {
  while (tasks.size > 0) await Promise.allSettled([...tasks]);
}

async function closePopupAfterEvents(popup: Page): Promise<void> {
  await popup
    .waitForLoadState("domcontentloaded", { timeout: 1_000 })
    .catch(() => undefined);
  await popup.waitForTimeout(500).catch(() => undefined);
  await popup.close().catch(() => undefined);
}

function requestRedirectChain(request: Request): string[] {
  const chain: string[] = [];
  let current: Request | null = request;
  while (current) {
    chain.unshift(current.url());
    current = current.redirectedFrom();
  }
  return chain;
}
