import { z } from "zod";
import { validateEffectiveConfigSnapshot } from "./config.js";
import { SCHEMA_VERSION } from "./contracts.js";
import { WalkdownError } from "./errors.js";

const severity = z.enum(["info", "warning", "error", "blocking"]);
const source = z
  .object({
    provider: z.string().min(1),
    providerVersion: z.string().min(1),
    nativeId: z.string().min(1),
    adapterVersion: z.string().min(1),
  })
  .strict();
const element = z
  .object({
    id: z.string().min(1),
    role: z.string(),
    name: z.string(),
    text: z.string().optional(),
    attributes: z.record(z.string()),
    context: z.string(),
    visible: z.boolean(),
    tagName: z.string().optional(),
    clickHints: z.array(z.enum(["handler", "pointer"])).optional(),
    bounds: z
      .object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
      })
      .strict()
      .optional(),
  })
  .strict();
const action = z
  .object({
    id: z.string().min(1),
    routeUrl: z.string().url(),
    element,
    kind: z.enum([
      "navigate",
      "click",
      "submit",
      "input",
      "select",
      "upload",
      "download",
      "unknown",
    ]),
    risk: z.enum([
      "safe",
      "reversible",
      "side-effect",
      "destructive",
      "external",
      "unknown",
    ]),
    reason: z.string(),
    destination: z.string().url().optional(),
    outcome: z.enum([
      "queued",
      "skipped",
      "budget-exhausted",
      "executed",
      "inconclusive",
    ]),
  })
  .strict();
const evidence = z
  .object({
    type: z.enum([
      "screenshot",
      "trace",
      "accessibility",
      "observations",
      "app-graph",
      "findings",
      "manifest",
      "result",
    ]),
    path: z
      .string()
      .min(1)
      .refine(
        (path) => !/^(?:[A-Za-z]:|\/)|(?:^|\/)\.\.(?:\/|$)/.test(path),
        "must be a relative portable path",
      ),
    status: z.enum(["available", "omitted", "truncated"]),
    bytes: z.number().int().nonnegative().optional(),
    reason: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status !== "available" && !value.reason)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "omitted/truncated evidence needs a reason",
      });
  });
const coverage = z
  .object({
    status: z.enum(["complete", "incomplete"]),
    visitedPages: z.number().int().nonnegative(),
    discoveredPages: z.number().int().nonnegative(),
    pendingRoutes: z.array(z.string().url()),
    skippedActions: z.number().int().nonnegative(),
    stopReasons: z.array(z.string()),
    skippedByPolicy: z.number().int().nonnegative().optional(),
    budgetExhausted: z.number().int().nonnegative().optional(),
    attemptedActions: z.number().int().nonnegative().optional(),
    executedActions: z.number().int().nonnegative().optional(),
    inconclusiveActions: z.number().int().nonnegative().optional(),
  })
  .strict();
const verification = z
  .object({
    command: z.string().min(1),
    expectedOutcome: z.string().min(1),
    executor: z
      .object({ provider: z.string().min(1), version: z.string().min(1) })
      .strict()
      .optional(),
    route: z.string().url().optional(),
    element: element
      .pick({ role: true, name: true, context: true })
      .strict()
      .optional(),
    action: action.pick({ kind: true, risk: true }).strict().optional(),
    assertion: z
      .object({
        type: z.literal("finding-absent"),
        ruleId: z.string().min(1),
        fingerprint: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict();
const finding = z
  .object({
    id: z.string().min(1),
    fingerprint: z.string().min(1),
    ruleId: z.string().min(1),
    source,
    state: z.enum([
      "new",
      "persistent",
      "regressed",
      "fixed",
      "ignored",
      "inconclusive",
    ]),
    severity,
    confidence: z.enum(["low", "medium", "high"]),
    route: z.string().url(),
    element: element.optional(),
    action: action.optional(),
    message: z.string().min(1),
    occurrenceCount: z.number().int().positive(),
    facts: z.array(z.string()).min(1),
    observations: z.array(
      z
        .object({
          sequence: z.number().int().positive().optional(),
          atMs: z.number().nonnegative().optional(),
          data: z.record(z.unknown()),
        })
        .strict(),
    ),
    evidence: z.array(evidence),
    inference: z.string().min(1),
    repair: z
      .object({
        objective: z.string().min(1),
        constraints: z.array(z.string()).min(1),
        acceptanceCriteria: z.array(z.string()).min(1),
      })
      .strict(),
    expectedOutcome: z.string().min(1),
    verification,
  })
  .strict();
const comparison = z
  .object({
    baselineVersion: z.literal(1),
    sourceRunId: z.string().min(1),
    comparedAt: z.string().datetime(),
    counts: z
      .object({
        new: z.number().int().nonnegative(),
        persistent: z.number().int().nonnegative(),
        fixed: z.number().int().nonnegative(),
        regressed: z.number().int().nonnegative(),
        ignored: z.number().int().nonnegative(),
        inconclusive: z.number().int().nonnegative(),
      })
      .strict(),
    fixed: z.array(
      z
        .object({
          fingerprint: z.string().min(1),
          ruleId: z.string().min(1),
          severity,
          route: z.string().url(),
          source,
        })
        .strict(),
    ),
    migrations: z.array(
      z
        .object({
          ruleId: z.string().min(1),
          baselineVersion: z.string().min(1),
          currentVersion: z.string().min(1),
          reason: z.string().min(1),
        })
        .strict(),
    ),
    expiredSuppressions: z.array(
      z
        .object({
          fingerprint: z.string().min(1),
          ruleId: z.string().min(1),
          reason: z.string().min(1),
          author: z.string().min(1).optional(),
          expiresAt: z.string().datetime().optional(),
        })
        .strict(),
    ),
    policy: z
      .object({
        failOn: z.array(severity).min(1),
        failures: z.array(z.string()),
      })
      .strict(),
    regression: z
      .object({ mode: z.enum(["focused", "full"]), reason: z.string().min(1) })
      .strict()
      .optional(),
  })
  .strict();

export const runResultSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    run: z
      .object({
        runId: z.string().min(1),
        startedAt: z.string().datetime(),
        finishedAt: z.string().datetime(),
        status: z.enum(["completed", "cancelled", "incomplete"]),
        version: z.string().min(1),
      })
      .strict(),
    target: z.string().url(),
    config: z.unknown(),
    coverage,
    summary: z
      .object({
        verdict: z.enum(["pass", "fail", "incomplete"]),
        findingCount: z.number().int().nonnegative(),
        blockers: z.number().int().nonnegative(),
        bySeverity: z
          .object({
            info: z.number().int().nonnegative(),
            warning: z.number().int().nonnegative(),
            error: z.number().int().nonnegative(),
            blocking: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    findings: z.array(finding),
    evidence: z.array(evidence),
    ruleManifest: z
      .record(
        z
          .object({
            version: z.string().min(1),
            enabled: z.boolean(),
            outcome: z.enum(["completed", "skipped"]),
          })
          .strict(),
      )
      .optional(),
    comparison: comparison.optional(),
  })
  .strict();

export function validateRunResult(value: unknown): void {
  const parsed = runResultSchema.safeParse(value);
  if (!parsed.success)
    throw invalid(
      "run result",
      parsed.error.issues.map((issue) => issue.message).join("; "),
    );
  // Config is validated with the same strict runtime validator used at the CLI boundary.
  try {
    validateEffectiveConfigSnapshot(parsed.data.config);
  } catch (error) {
    if (error instanceof WalkdownError)
      throw invalid("run result config", error.message);
    throw error;
  }
}

export function assertSupportedSchema(value: unknown, artifact: string): void {
  if (
    value &&
    typeof value === "object" &&
    "schemaVersion" in value &&
    typeof value.schemaVersion === "number" &&
    value.schemaVersion > SCHEMA_VERSION
  )
    throw new WalkdownError(
      "UNSUPPORTED_SCHEMA_VERSION",
      `${artifact} schemaVersion ${value.schemaVersion} is newer than supported version ${SCHEMA_VERSION}.`,
      "Upgrade Walkdown or use a compatible artifact.",
    );
}

function invalid(artifact: string, details: string): WalkdownError {
  return new WalkdownError(
    "INVALID_CONFIG",
    `Invalid ${artifact}: ${details}`,
    "Fix or recreate the versioned artifact.",
  );
}
