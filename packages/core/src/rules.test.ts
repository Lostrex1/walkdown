import { describe, expect, it } from "vitest";
import type {
  AppGraph,
  CandidateAction,
  ChecksConfig,
  Observation,
  RuleContext,
} from "./index.js";
import {
  classifyNetworkRequest,
  evaluateRules,
  loadConfig,
  SCHEMA_VERSION,
} from "./index.js";

const target = "http://127.0.0.1:4100/";

describe("navigation and runtime rules", () => {
  it("detects configured placeholders but excludes protocols and downloads", () => {
    const missingTarget = action("missing-target", "", undefined);
    delete missingTarget.element.attributes.href;
    const context = fixtureContext({
      actions: [
        missingTarget,
        action("empty-1", "", undefined),
        action("empty-2", "", undefined),
        action("hash", "#", undefined),
        action("javascript", "javascript:void(0)", undefined),
        action("configured", "/coming-soon", `${target}coming-soon`),
        action("email", "mailto:hello@example.com", undefined),
        action("phone", "tel:+34123456789", undefined),
        action("download", "/report.csv", `${target}report.csv`, "download"),
        action("healthy", "/healthy", `${target}healthy`),
      ],
      configure(checks) {
        checks.placeholders.push("/coming-soon");
      },
    });

    const findings = evaluateRules(context).findings.filter(
      (finding) => finding.ruleId === "navigation.placeholder-link",
    );

    expect(findings).toHaveLength(4);
    expect(
      findings.find((finding) => finding.samples[0]?.data.href === ""),
    ).toMatchObject({ occurrenceCount: 3 });
    expect(JSON.stringify(findings)).not.toContain("mailto:");
    expect(JSON.stringify(findings)).not.toContain("tel:");
    expect(JSON.stringify(findings)).not.toContain("report.csv");
  });

  it("detects a broken internal destination and preserves redirects", () => {
    const destination = `${target}redirect`;
    const finalUrl = `${target}missing`;
    const context = fixtureContext({
      actions: [
        action("broken", "/redirect", destination),
        action("loop", "/loop", `${target}loop`),
        action("not-found", "/not-found", `${target}not-found`),
        action("healthy", "/healthy", `${target}healthy`),
        action(
          "external",
          "https://example.com/missing",
          "https://example.com/missing",
        ),
        action("download", "/missing.csv", `${target}missing.csv`, "download"),
      ],
      observations: [
        observation(1, "response", {
          status: 302,
          url: destination,
          redirectChain: [destination],
          resourceType: "document",
          scope: "first-party",
          role: "navigation",
        }),
        observation(2, "response", {
          status: 503,
          url: finalUrl,
          redirectChain: [destination, finalUrl],
          resourceType: "document",
          scope: "first-party",
          role: "navigation",
        }),
        observation(3, "request-failed", {
          url: `${target}loop-b`,
          error: "net::ERR_TOO_MANY_REDIRECTS",
          redirectChain: [
            `${target}loop`,
            `${target}loop-a`,
            `${target}loop-b`,
          ],
          resourceType: "document",
          scope: "first-party",
          role: "navigation",
          expectedCancellation: false,
        }),
        observation(4, "response", {
          status: 404,
          url: `${target}not-found`,
          redirectChain: [`${target}not-found`],
          resourceType: "document",
          scope: "first-party",
          role: "navigation",
        }),
        observation(5, "response", {
          status: 200,
          url: `${target}healthy`,
          redirectChain: [`${target}healthy`],
          resourceType: "document",
          scope: "first-party",
          role: "navigation",
        }),
      ],
    });

    const findings = evaluateRules(context).findings.filter(
      (finding) => finding.ruleId === "navigation.broken-internal-link",
    );

    expect(findings).toHaveLength(3);
    expect(
      findings.find((finding) => finding.message.includes("HTTP 503")),
    ).toMatchObject({
      route: target,
      message: "Internal link ended with HTTP 503.",
      samples: [
        {
          data: {
            destination,
            redirectChain: [destination, finalUrl],
          },
        },
      ],
    });
    expect(findings).toContainEqual(
      expect.objectContaining({
        message: "Internal link entered a redirect loop.",
      }),
    );
    expect(findings).toContainEqual(
      expect.objectContaining({
        message: "Internal link ended with HTTP 404.",
      }),
    );
    expect(JSON.stringify(findings)).not.toContain("healthy");
  });

  it("emits page and console errors, deduplicates repeats, and keeps samples", () => {
    const context = fixtureContext({
      observations: [
        observation(1, "page-error", {
          routeUrl: `${target}dashboard`,
          message: "Crash 123e4567-e89b-12d3-a456-426614174000",
          stack: "Error: Crash\n at dashboard.js:10:2",
        }),
        observation(2, "page-error", {
          routeUrl: `${target}dashboard`,
          message: "Crash 987e6543-e21b-12d3-a456-426614174999",
          stack: "Error: Crash\n at dashboard.js:10:2",
        }),
        observation(3, "console", {
          routeUrl: target,
          level: "warning",
          text: "benign warning",
        }),
        observation(4, "console", {
          routeUrl: target,
          level: "error",
          text: "Hydration failed",
        }),
      ],
    });

    const findings = evaluateRules(context).findings;
    expect(
      findings.find((finding) => finding.ruleId === "runtime.page-error"),
    ).toMatchObject({
      occurrenceCount: 2,
      samples: [{ sequence: 1 }, { sequence: 2 }],
    });
    expect(
      findings.filter((finding) => finding.ruleId === "runtime.console-error"),
    ).toHaveLength(1);
    expect(JSON.stringify(findings)).not.toContain("benign warning");
  });

  it("filters known console noise without removing captured evidence", () => {
    const context = fixtureContext({
      observations: [
        observation(1, "console", {
          routeUrl: target,
          level: "error",
          text: "ResizeObserver loop limit exceeded",
        }),
      ],
      configure(checks) {
        checks.rules["runtime.console-error"].ignoreMessagePatterns = [
          "*ResizeObserver*",
        ];
      },
    });

    expect(evaluateRules(context).findings).toEqual([]);
    expect(context.observations).toHaveLength(1);
  });

  it("reports first-party failures and 5xx but not third-party, 4xx, or expected cancellations", () => {
    const context = fixtureContext({
      observations: [
        networkObservation(1, "request-failed", `${target}api/offline`, {
          error: "net::ERR_CONNECTION_REFUSED",
          resourceType: "fetch",
        }),
        networkObservation(2, "response", `${target}api/error`, {
          status: 503,
          resourceType: "xhr",
        }),
        networkObservation(3, "response", `${target}asset.svg`, {
          status: 404,
          resourceType: "image",
        }),
        networkObservation(
          4,
          "request-failed",
          "https://cdn.example/asset.js",
          {
            error: "net::ERR_CONNECTION_REFUSED",
            resourceType: "script",
          },
        ),
        networkObservation(5, "request-failed", `${target}slow-image.png`, {
          error: "net::ERR_ABORTED",
          resourceType: "image",
        }),
      ],
    });

    const findings = evaluateRules(context).findings.filter(
      (finding) => finding.ruleId === "runtime.failed-request",
    );
    expect(findings).toHaveLength(2);
    expect(JSON.stringify(findings)).toContain("api/offline");
    expect(JSON.stringify(findings)).toContain("api/error");
    expect(JSON.stringify(findings)).not.toContain("cdn.example");
    expect(JSON.stringify(findings)).not.toContain("slow-image");
    expect(JSON.stringify(findings)).not.toContain("asset.svg");
  });

  it("classifies request scope, role, and expected cancellation explicitly", () => {
    expect(
      classifyNetworkRequest({
        target,
        url: `${target}image.png`,
        resourceType: "image",
        errorText: "net::ERR_ABORTED",
      }),
    ).toEqual({
      scope: "first-party",
      role: "resource",
      resourceType: "image",
      expectedCancellation: true,
    });
    expect(
      classifyNetworkRequest({
        target,
        url: "https://cdn.example/app.js",
        resourceType: "document",
        navigation: true,
        errorText: "net::ERR_ABORTED",
      }),
    ).toMatchObject({
      scope: "third-party",
      role: "navigation",
      expectedCancellation: false,
    });
  });

  it("respects enabled and severity while keeping rule semantics fixed", () => {
    const context = fixtureContext({
      observations: [
        observation(1, "console", {
          routeUrl: target,
          level: "error",
          text: "broken",
        }),
        observation(2, "page-error", {
          routeUrl: target,
          message: "crash",
        }),
      ],
      configure(checks) {
        checks.rules["runtime.console-error"].enabled = false;
        checks.rules["runtime.page-error"].severity = "blocking";
      },
    });

    expect(evaluateRules(context).findings).toEqual([
      expect.objectContaining({
        ruleId: "runtime.page-error",
        severity: "blocking",
      }),
    ]);
  });

  it("produces stable IDs and fingerprints across local ports and timestamps", () => {
    const first = fixtureContext({
      target: "http://127.0.0.1:4100/",
      observations: [
        observation(1, "page-error", {
          routeUrl: "http://127.0.0.1:4100/dashboard",
          message: "Failed at 2026-08-25T10:00:00.123Z",
        }),
      ],
    });
    const second = fixtureContext({
      target: "http://127.0.0.1:5200/",
      observations: [
        observation(1, "page-error", {
          routeUrl: "http://127.0.0.1:5200/dashboard",
          message: "Failed at 2026-08-25T10:05:17.999Z",
        }),
      ],
    });

    const firstFinding = evaluateRules(first).findings[0];
    const secondFinding = evaluateRules(second).findings[0];
    expect(firstFinding?.id).toBe(secondFinding?.id);
    expect(firstFinding?.fingerprint).toBe(secondFinding?.fingerprint);
  });
});

function fixtureContext(options: {
  target?: string;
  actions?: CandidateAction[];
  observations?: Observation[];
  configure?: (checks: ChecksConfig) => void;
}): RuleContext {
  const fixtureTarget = options.target ?? target;
  const checks = structuredClone(loadConfig({ cwd: "." }).checks);
  options.configure?.(checks);
  const appGraph: AppGraph = {
    schemaVersion: SCHEMA_VERSION,
    target: fixtureTarget,
    routes: [
      {
        url: fixtureTarget,
        depth: 0,
        title: "Fixture",
        stateSignature: "fixture",
        elements: [],
        actions: options.actions ?? [],
      },
    ],
    coverage: {
      status: "complete",
      visitedPages: 1,
      discoveredPages: 1,
      pendingRoutes: [],
      skippedActions: 0,
      stopReasons: [],
    },
  };
  return {
    target: fixtureTarget,
    observations: options.observations ?? [],
    appGraph,
    config: checks,
  };
}

function action(
  id: string,
  href: string,
  destination?: string,
  kind: CandidateAction["kind"] = "navigate",
): CandidateAction {
  return {
    id,
    routeUrl: target,
    element: {
      id: `element-${id}`,
      role: "link",
      name: id,
      attributes: { href },
      context: "main",
      visible: true,
    },
    kind,
    risk: kind === "download" ? "unknown" : "safe",
    reason: "fixture",
    destination,
    outcome: "queued",
  };
}

function observation(
  sequence: number,
  kind: Observation["kind"],
  data: Record<string, unknown>,
): Observation {
  return { sequence, atMs: sequence * 10, kind, data };
}

function networkObservation(
  sequence: number,
  kind: "request-failed" | "response",
  url: string,
  data: Record<string, unknown>,
): Observation {
  const resourceType = String(data.resourceType);
  return observation(sequence, kind, {
    url,
    routeUrl: target,
    ...data,
    ...classifyNetworkRequest({
      target,
      url,
      resourceType,
      errorText: typeof data.error === "string" ? data.error : undefined,
    }),
  });
}
