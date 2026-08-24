import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from "playwright";
import { ArtifactWriter, redactText } from "./artifact-writer.js";
import type {
  EffectiveConfig,
  EvidenceRef,
  Observation,
  PageState,
} from "./contracts.js";
import { WalkdownError } from "./errors.js";

export interface BrowserSessionResult {
  observations: Observation[];
  evidence: EvidenceRef[];
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
    await writer.writeJson("observations.json", "observations", observations);
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
  return { observations, evidence: writer.evidence, pageState };
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
    }),
  );
  page.on("pageerror", (error) =>
    observe("page-error", { message: redactText(error.message) }),
  );
  page.on("requestfailed", (request) =>
    observe("request-failed", {
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
      error: redactText(request.failure()?.errorText ?? "unknown"),
    }),
  );
  page.on("response", (response) =>
    observe("response", {
      status: response.status(),
      method: response.request().method(),
      resourceType: response.request().resourceType(),
      url: response.url(),
      firstParty: sameOrigin(target, response.url()),
    }),
  );
  page.on("dialog", (dialog) => {
    observe("dialog", {
      type: dialog.type(),
      message: redactText(dialog.message()),
    });
    void dialog.dismiss();
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

function sameOrigin(first: string, second: string): boolean {
  try {
    return new URL(first).origin === new URL(second).origin;
  } catch {
    return false;
  }
}
