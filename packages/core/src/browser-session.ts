import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
  type Request,
} from "playwright";
import { ArtifactWriter, redactText } from "./artifact-writer.js";
import type {
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
  pageState: PageState;
}

export async function runBrowserSession(options: {
  target: string;
  runDirectory: string;
  config: EffectiveConfig;
  signal: AbortSignal;
}): Promise<BrowserSessionResult> {
  if (options.signal.aborted)
    throw new Error("Browser session cancelled before launch.");
  const writer = new ArtifactWriter(
    options.runDirectory,
    options.config.browser.maxArtifactBytes,
  );
  const observations: Observation[] = [];
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
    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await context.newPage();
    installObservers(page, observe, options.target);
    try {
      await page.goto(options.target, {
        waitUntil: "domcontentloaded",
        timeout: options.config.timeoutMs,
      });
    } catch (error) {
      if (options.signal.aborted) throw error;
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
    const screenshot = await page.screenshot({ fullPage: true });
    await writer.writeBuffer("initial.png", "screenshot", screenshot);
    const graph = await exploreApplication({
      page,
      target: options.target,
      config: options.config,
      signal: options.signal,
    });
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
    if (context) {
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
  return { observations, evidence: writer.evidence, findings, pageState };
}

function installObservers(
  page: Page,
  observe: (kind: Observation["kind"], data: Record<string, unknown>) => void,
  target: string,
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
    void dialog.dismiss().catch(() => undefined);
  });
  page.on("download", (download) =>
    observe("download", {
      suggestedFilename: redactText(download.suggestedFilename()),
    }),
  );
  page.on("popup", (popup) => observe("popup", { url: popup.url() }));
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      observe("navigation", { url: frame.url() });
      observe("url-change", { url: frame.url() });
    }
  });
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
