import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Ajv } from "ajv";
import * as AjvDraft04 from "ajv-draft-04";
import { describe, expect, it } from "vitest";
import type {
  AppGraph,
  EffectiveConfig,
  Finding,
  Run,
  RunResult,
} from "./contracts.js";
import { RULE_IDS } from "./contracts.js";
import {
  renderAgentPrompt,
  renderJsonl,
  renderMarkdown,
  renderTerminal,
  toSarif,
} from "./reporters.js";
import { assembleRunResult } from "./run-result.js";
import { validateRunResult } from "./contracts-validation.js";

const fixturePath = resolve("packages/core/src/fixtures/run-result.v1.json");
const resultSchemaPath = resolve("schemas/run-result.schema.json");
const eventSchemaPath = resolve("schemas/run-result-event.schema.json");
const sarifSchemaPath = resolve("schemas/sarif-2.1.0.schema.json");

describe("RunResult v1", () => {
  it("assembles native findings with provenance, repair, evidence, and redaction", () => {
    const run = nativeRun();
    run.config.browser.userAgent = "token=do-not-persist";
    const finding = nativeFinding();
    if (finding.samples[0]) finding.samples[0].data.apiKey = "also-secret";
    const result = assembleRunResult({
      run,
      appGraph: graph(),
      findings: [finding],
      evidence: [
        {
          type: "observations",
          path: "artifacts/observations.json",
          bytes: 120,
          truncated: false,
        },
      ],
      omissions: ["trace.zip: exceeded 100 byte limit"],
    });
    expect(result.summary).toMatchObject({ verdict: "fail", blockers: 1 });
    expect(result.findings[0]).toMatchObject({
      ruleId: "interaction.dead-control",
      source: {
        provider: "walkdown",
        providerVersion: "0.1.0",
        nativeId: "interaction.dead-control",
        adapterVersion: "1",
      },
      element: { id: "button-1" },
      repair: { acceptanceCriteria: expect.any(Array) },
    });
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        path: "artifacts/trace.zip",
        status: "omitted",
        reason: "exceeded 100 byte limit",
      }),
    );
    expect(JSON.stringify(result)).not.toContain("do-not-persist");
    expect(JSON.stringify(result)).not.toContain("also-secret");
  });

  it("rejects evidence paths outside the run directory", () => {
    expect(() =>
      assembleRunResult({
        run: nativeRun(),
        appGraph: graph(),
        findings: [],
        evidence: [
          { type: "trace", path: "../trace.zip", bytes: 1, truncated: false },
        ],
      }),
    ).toThrow("relative to the run");
  });

  it("rejects malformed public contracts instead of accepting partial JSON", () => {
    const result = assembleRunResult({
      run: nativeRun(), appGraph: graph(), findings: [], evidence: [],
    });
    expect(() => validateRunResult({ ...result, unexpected: true })).toThrow(
      "Invalid run result",
    );
    expect(() => validateRunResult({ ...result, findings: [{}] })).toThrow(
      "Invalid run result",
    );
    const schema = JSON.parse(readFileSync(resultSchemaPath, "utf8"));
    const ajv = new Ajv({ strict: false, formats: { "date-time": true, uri: true } });
    expect(ajv.validate(schema, result), JSON.stringify(ajv.errors)).toBe(true);
  });

  it("validates the golden external-provider fixture and official SARIF output", async () => {
    const fixture = JSON.parse(
      await readFile(fixturePath, "utf8"),
    ) as RunResult;
    const schema = JSON.parse(await readFile(resultSchemaPath, "utf8"));
    const ajv = new Ajv({
      strict: false,
      formats: { "date-time": true, uri: true },
    });
    expect(ajv.validate(schema, fixture), JSON.stringify(ajv.errors)).toBe(
      true,
    );

    const sarifSchema = JSON.parse(await readFile(sarifSchemaPath, "utf8"));
    const sarifAjv = new AjvDraft04.default.default({
      strict: false,
      formats: { uri: true, "uri-reference": true, "date-time": true },
    });
    expect(
      sarifAjv.validate(sarifSchema, toSarif(fixture)),
      JSON.stringify(sarifAjv.errors),
    ).toBe(true);
    expect(JSON.stringify(toSarif(fixture))).not.toContain("physicalLocation");
  });

  it("renders stable incremental, terminal, Markdown, and agent views", async () => {
    const fixture = JSON.parse(
      await readFile(fixturePath, "utf8"),
    ) as RunResult;
    const jsonl = renderJsonl(fixture)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(jsonl.map((event) => event.type)).toEqual([
      "run",
      "finding",
      "coverage",
      "summary",
    ]);
    expect(jsonl.at(-1)?.summary).toEqual(fixture.summary);
    const eventSchema = JSON.parse(await readFile(eventSchemaPath, "utf8"));
    const eventAjv = new Ajv({ strict: false });
    for (const event of jsonl)
      expect(
        eventAjv.validate(eventSchema, event),
        JSON.stringify(eventAjv.errors),
      ).toBe(true);
    expect(renderTerminal(fixture, { color: false })).not.toContain("\u001b[");
    expect(renderTerminal(fixture, { color: true })).toContain("\u001b[");
    const markdown = renderMarkdown(fixture);
    expect(markdown).toContain("[observations](artifacts/observations.json)");
    expect(markdown).toContain("**Repair contract**");
    const agent = renderAgentPrompt(fixture);
    expect(agent).toContain("result.json as the canonical source");
    expect(agent).toContain("preflight.runtime:fixture");
  });
});

function nativeRun(): Run {
  return {
    schemaVersion: 1,
    runId: "fixture-native",
    target: "https://example.test/",
    startedAt: "2026-08-25T10:00:00.000Z",
    finishedAt: "2026-08-25T10:00:05.000Z",
    status: "completed",
    version: "0.1.0",
    config: config(),
  };
}

function nativeFinding(): Finding {
  return {
    id: "interaction.dead-control:fixture",
    fingerprint: "0123456789abcdef",
    ruleId: "interaction.dead-control",
    severity: "error",
    route: "https://example.test/",
    message: "Control completed without an observable effect.",
    occurrenceCount: 1,
    samples: [
      {
        data: {
          element: graph().routes[0]?.elements[0],
          outcome: "fail",
        },
      },
    ],
  };
}

function graph(): AppGraph {
  const element = {
    id: "button-1",
    role: "button",
    name: "Continue",
    attributes: { type: "button" },
    context: "main",
    visible: true,
  };
  return {
    schemaVersion: 1,
    target: "https://example.test/",
    routes: [
      {
        url: "https://example.test/",
        depth: 0,
        title: "Fixture",
        stateSignature: "fixture",
        elements: [element],
        actions: [
          {
            id: "action-1",
            routeUrl: "https://example.test/",
            element,
            kind: "click",
            risk: "safe",
            reason: "Fixture action",
            outcome: "queued",
          },
        ],
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
}

function config(): EffectiveConfig {
  return {
    schemaVersion: 1,
    outputDir: ".walkdown",
    timeoutMs: 30_000,
    maxPages: 25,
    maxDepth: 3,
    include: [],
    exclude: [],
    allowedOrigins: [],
    viewports: [{ name: "desktop", width: 1440, height: 900 }],
    browser: {
      trace: true,
      screenshot: true,
      settleMs: 100,
      maxArtifactBytes: 1_000_000,
    },
    exploration: {
      maxActions: 100,
      crawlTimeoutMs: 60_000,
      maxQueryVariantsPerPath: 3,
      allowExternalNavigation: false,
    },
    baseline: { path: "baseline.json", failOn: ["error", "blocking"] },
    checks: {
      placeholders: [],
      rules: Object.fromEntries(
        RULE_IDS.map((id) => [
          id,
          {
            enabled: true,
            severity: "warning",
            ignoreMessagePatterns: [],
            ignoreUrlPatterns: [],
          },
        ]),
      ) as unknown as EffectiveConfig["checks"]["rules"],
      interaction: {
        allowButtonClicks: false,
        effectTimeoutMs: 500,
        stabilityMs: 100,
        layoutSettleMs: 100,
        maxControlsPerPage: 20,
        keyboardMaxSteps: 50,
        dynamicSelectors: [],
        ignoreRequestPatterns: [],
      },
    },
  };
}
