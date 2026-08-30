import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Ajv } from "ajv";
import { afterEach, describe, expect, it } from "vitest";
import {
  compareWithBaseline,
  createBaseline,
  evaluateWalkdownVerification,
  readBaseline,
  writeBaseline,
} from "./baseline.js";
import type {
  PublishedFinding,
  RunResult,
  Suppression,
  VerificationResult,
} from "./contracts.js";

const directories: string[] = [];
const now = "2026-08-25T12:00:00.000Z";
const later = "2026-08-26T12:00:00.000Z";

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("baseline and comparison", () => {
  it("creates a reviewable versioned baseline without heavy evidence or secrets", async () => {
    const result = runResult([finding("stable-fingerprint")]);
    result.target = "https://example.test/?token=must-not-leak";
    if (result.findings[0])
      result.findings[0].route =
        "https://example.test/checkout?session=must-not-leak";
    result.findings[0]?.evidence.push({
      type: "screenshot",
      path: "artifacts/private.png",
      status: "available",
      bytes: 20,
    });
    result.findings[0]?.observations.push({
      data: { token: "must-not-leak" },
    });
    const baseline = createBaseline(result, { now });
    const serialized = JSON.stringify(baseline);
    expect(serialized).not.toContain("private.png");
    expect(serialized).not.toContain("must-not-leak");
    expect(serialized).not.toContain("Original provider message");
    expect(baseline.entries[0]).toMatchObject({
      fingerprint: "stable-fingerprint",
      fingerprintVersion: 1,
      ruleVersion: "1",
      status: "active",
    });

    const schema = JSON.parse(
      await readFile(resolve("schemas/baseline.schema.json"), "utf8"),
    );
    const ajv = schemaValidator();
    expect(ajv.validate(schema, baseline), JSON.stringify(ajv.errors)).toBe(
      true,
    );
    const directory = await mkdtemp(join(tmpdir(), "walkdown-baseline-"));
    directories.push(directory);
    const filePath = join(directory, "baseline.json");
    await writeBaseline(filePath, baseline);
    await expect(readBaseline(filePath)).resolves.toEqual(baseline);
  });

  it("classifies new, persistent, fixed, and regressed findings deterministically", async () => {
    const initial = runResult([
      finding("stable-fingerprint"),
      finding("fixed-fingerprint", "runtime.console-error"),
    ]);
    const baseline = createBaseline(initial, { now });
    const current = runResult([
      finding("stable-fingerprint", "runtime.page-error", "Changed copy"),
      finding("new-fingerprint", "runtime.failed-request"),
    ]);
    const compared = compareWithBaseline(current, baseline, { now: later });
    expect(compared.findings.map((item) => item.state)).toEqual([
      "persistent",
      "new",
    ]);
    expect(compared.comparison?.counts).toMatchObject({
      new: 1,
      persistent: 1,
      fixed: 1,
      regressed: 0,
    });
    expect(compared.summary).toMatchObject({ verdict: "fail", blockers: 1 });

    const updated = createBaseline(current, {
      previous: baseline,
      now: later,
    });
    const reappeared = compareWithBaseline(
      runResult([
        finding("stable-fingerprint"),
        finding("new-fingerprint", "runtime.failed-request"),
        finding("fixed-fingerprint", "runtime.console-error"),
      ]),
      updated,
      { now: "2026-08-27T12:00:00.000Z" },
    );
    expect(
      reappeared.findings.find(
        (item) => item.fingerprint === "fixed-fingerprint",
      )?.state,
    ).toBe("regressed");

    const schema = JSON.parse(
      await readFile(resolve("schemas/comparison.schema.json"), "utf8"),
    );
    const ajv = schemaValidator();
    expect(
      ajv.validate(schema, reappeared.comparison),
      JSON.stringify(ajv.errors),
    ).toBe(true);
  });

  it("honors suppression expiry and reports rule migrations explicitly", () => {
    const initial = runResult([finding("stable-fingerprint")]);
    const suppression: Suppression = {
      fingerprint: "stable-fingerprint",
      ruleId: "runtime.page-error",
      reason: "Accepted until the upstream migration completes.",
      expiresAt: "2026-08-26T00:00:00.000Z",
    };
    const baseline = createBaseline(initial, {
      now,
      suppressions: [suppression],
    });
    const ignored = compareWithBaseline(initial, baseline, {
      now: "2026-08-25T18:00:00.000Z",
    });
    expect(ignored.findings[0]?.state).toBe("ignored");
    expect(ignored.summary.verdict).toBe("pass");

    const expired = compareWithBaseline(initial, baseline, { now: later });
    expect(expired.findings[0]?.state).toBe("persistent");
    expect(expired.comparison?.expiredSuppressions).toEqual([suppression]);

    const incompatible = {
      ...baseline,
      ruleVersions: { "runtime.page-error": "0" },
    };
    const migration = compareWithBaseline(initial, incompatible, {
      now: later,
    });
    expect(migration.findings[0]?.state).toBe("inconclusive");
    expect(migration.summary.verdict).toBe("incomplete");
    expect(migration.comparison?.migrations[0]).toMatchObject({
      ruleId: "runtime.page-error",
      baselineVersion: "0",
      currentVersion: "1",
    });
  });

  it("detects a rule migration even when the current run has no findings", () => {
    const initial = runResult([finding("stable-fingerprint")]);
    initial.ruleManifest = {
      "runtime.page-error": { version: "1", enabled: true, outcome: "completed" },
    };
    const baseline = createBaseline(initial, { now });
    const current = runResult([]);
    current.ruleManifest = {
      "runtime.page-error": { version: "2", enabled: true, outcome: "completed" },
    };
    const compared = compareWithBaseline(current, baseline, { now: later });
    expect(compared.summary.verdict).toBe("incomplete");
    expect(compared.comparison?.migrations).toContainEqual(
      expect.objectContaining({ ruleId: "runtime.page-error", currentVersion: "2" }),
    );
    expect(compared.comparison?.counts.fixed).toBe(0);
  });

  it("keeps irrelevant changes stable and validates verification results", async () => {
    const corpus = JSON.parse(
      await readFile(
        resolve("packages/core/src/fixtures/baseline-stability.v1.json"),
        "utf8",
      ),
    ) as Record<string, { fingerprint: string; message: string }>;
    const baseline = createBaseline(
      runResult([finding(corpus.unchanged?.fingerprint ?? "missing")]),
      { now },
    );
    const irrelevant = compareWithBaseline(
      runResult([
        finding(
          corpus.irrelevantChange?.fingerprint ?? "missing",
          "runtime.page-error",
          corpus.irrelevantChange?.message,
        ),
      ]),
      baseline,
      { now: later },
    );
    expect(irrelevant.findings[0]?.state).toBe("persistent");
    const relevant = compareWithBaseline(
      runResult([
        finding(
          corpus.relevantChange?.fingerprint ?? "missing",
          "runtime.page-error",
          corpus.relevantChange?.message,
        ),
      ]),
      baseline,
      { now: later },
    );
    expect(relevant.comparison?.counts).toMatchObject({ new: 1, fixed: 1 });

    const verification: VerificationResult = {
      schemaVersion: 1,
      fingerprint: "stable-fingerprint",
      outcome: "inconclusive",
      executor: { provider: "walkdown", version: "1" },
      sourceRunId: "source-run",
      route: "https://example.test/checkout",
      reason: "The original semantic element was not reached.",
    };
    const schema = JSON.parse(
      await readFile(resolve("schemas/verification.schema.json"), "utf8"),
    );
    const ajv = schemaValidator();
    expect(ajv.validate(schema, verification), JSON.stringify(ajv.errors)).toBe(
      true,
    );
  });

  it("returns pass, fail, or inconclusive only from re-observed context", () => {
    const source = finding("stable-fingerprint");
    source.verification.element = {
      role: "button",
      name: "Continue",
      context: "main",
    };
    const appGraph = {
      schemaVersion: 1 as const,
      target: "https://example.test/checkout",
      routes: [
        {
          url: "https://example.test/checkout",
          depth: 0,
          title: "Checkout",
          stateSignature: "stable",
          elements: [
            {
              id: "continue",
              role: "button",
              name: "Continue",
              attributes: {},
              context: "main",
              visible: true,
            },
          ],
          actions: [],
        },
      ],
      coverage: {
        status: "complete" as const,
        visitedPages: 1,
        discoveredPages: 1,
        pendingRoutes: [],
        skippedActions: 0,
        stopReasons: [],
      },
    };
    const pass = evaluateWalkdownVerification({
      sourceFinding: source,
      sourceRunId: "source",
      verificationResult: runResult([]),
      appGraph,
    });
    const fail = evaluateWalkdownVerification({
      sourceFinding: source,
      sourceRunId: "source",
      verificationResult: runResult([source]),
      appGraph,
    });
    const observedRoute = appGraph.routes[0];
    if (!observedRoute) throw new Error("Fixture route is missing.");
    const inconclusive = evaluateWalkdownVerification({
      sourceFinding: source,
      sourceRunId: "source",
      verificationResult: runResult([]),
      appGraph: {
        ...appGraph,
        routes: [{ ...observedRoute, elements: [] }],
      },
    });
    expect(pass.outcome).toBe("pass");
    expect(fail.outcome).toBe("fail");
    expect(inconclusive).toMatchObject({
      outcome: "inconclusive",
      reason: "The original semantic element was not reached.",
    });
  });

  it("never returns PASS for an interaction finding whose original action was not executed", () => {
    const source = finding("action-fingerprint", "interaction.dead-control");
    source.verification.element = { role: "button", name: "Save", context: "main" };
    source.verification.action = { kind: "click", risk: "safe" };
    const appGraph = {
      schemaVersion: 1 as const,
      target: source.route,
      routes: [{
        url: source.route, depth: 0, title: "Fixture", stateSignature: "stable",
        elements: [{ id: "save", role: "button", name: "Save", attributes: {}, context: "main", visible: true }],
        actions: [],
      }],
      coverage: { status: "complete" as const, visitedPages: 1, discoveredPages: 1, pendingRoutes: [], skippedActions: 0, stopReasons: [] },
    };
    const verification = evaluateWalkdownVerification({
      sourceFinding: source,
      sourceRunId: "source",
      verificationResult: runResult([]),
      appGraph,
      behavior: { attempts: [] },
    });
    expect(verification).toMatchObject({
      outcome: "inconclusive",
      reason: "The original action was not executed conclusively.",
    });
  });
});

function runResult(findings: PublishedFinding[]): RunResult {
  return {
    schemaVersion: 1,
    run: {
      runId: "fixture-run",
      startedAt: now,
      finishedAt: now,
      status: "completed",
      version: "0.1.0",
    },
    target: "https://example.test/",
    config: {} as RunResult["config"],
    coverage: {
      status: "complete",
      visitedPages: 1,
      discoveredPages: 1,
      pendingRoutes: [],
      skippedActions: 0,
      stopReasons: [],
    },
    summary: {
      verdict: findings.some((item) => item.severity === "error")
        ? "fail"
        : "pass",
      findingCount: findings.length,
      blockers: findings.filter((item) => item.severity === "error").length,
      bySeverity: {
        info: 0,
        warning: 0,
        error: findings.filter((item) => item.severity === "error").length,
        blocking: 0,
      },
    },
    findings,
    evidence: [],
  };
}

function finding(
  fingerprint: string,
  ruleId = "runtime.page-error",
  message = "Page emitted an unhandled JavaScript exception.",
): PublishedFinding {
  return {
    id: `${ruleId}:${fingerprint}`,
    fingerprint,
    ruleId,
    source: {
      provider: "walkdown",
      providerVersion: "0.1.0",
      nativeId: ruleId,
      adapterVersion: "1",
    },
    state: "new",
    severity: "error",
    confidence: "high",
    route: "https://example.test/checkout",
    message,
    occurrenceCount: 1,
    facts: [message],
    observations: [],
    evidence: [],
    inference: "The flow is unreliable.",
    repair: {
      objective: "Prevent the error.",
      constraints: ["Preserve behavior."],
      acceptanceCriteria: ["The error is absent."],
    },
    expectedOutcome: "The flow completes.",
    verification: {
      command: `walkdown verify ${fingerprint}`,
      expectedOutcome: "The finding is absent.",
      executor: { provider: "walkdown", version: "1" },
      route: "https://example.test/checkout",
      assertion: { type: "finding-absent", ruleId, fingerprint },
    },
  };
}

function schemaValidator(): Ajv {
  return new Ajv({
    strict: false,
    formats: { "date-time": true, uri: true },
  });
}
