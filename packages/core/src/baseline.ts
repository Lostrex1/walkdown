import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { redactText } from "./artifact-writer.js";
import type {
  AppGraph,
  Baseline,
  BaselineEntry,
  ComparisonResult,
  FindingState,
  PublishedFinding,
  RuleId,
  RunResult,
  Severity,
  Suppression,
  VerificationResult,
} from "./contracts.js";
import { RULE_IDS, SCHEMA_VERSION } from "./contracts.js";
import { WalkdownError } from "./errors.js";

export const FINGERPRINT_VERSION = 1;
export const BASELINE_VERSION = 1 as const;
const sensitiveQueryKey =
  /(?:token|auth|session|password|secret|api[_-]?key|access[_-]?key)/i;
export const RULE_VERSIONS: Record<RuleId, string> = Object.fromEntries(
  RULE_IDS.map((id) => [id, "1"]),
) as Record<RuleId, string>;

const severitySchema = z.enum(["info", "warning", "error", "blocking"]);
const sourceSchema = z
  .object({
    provider: z.string().min(1),
    providerVersion: z.string().min(1),
    nativeId: z.string().min(1),
    adapterVersion: z.string().min(1),
  })
  .strict();
const suppressionSchema = z
  .object({
    fingerprint: z.string().min(1),
    ruleId: z.string().min(1),
    reason: z.string().min(1),
    author: z.string().min(1).optional(),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();
const entrySchema = z
  .object({
    fingerprint: z.string().min(1),
    fingerprintVersion: z.number().int().positive(),
    ruleId: z.string().min(1),
    ruleVersion: z.string().min(1),
    severity: severitySchema,
    route: z.string().url(),
    source: sourceSchema,
    status: z.enum(["active", "fixed"]),
    firstSeenAt: z.string().datetime(),
    lastSeenAt: z.string().datetime(),
  })
  .strict();
const baselineSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    baselineVersion: z.literal(BASELINE_VERSION),
    target: z.string().url(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    sourceRunId: z.string().min(1),
    fingerprintVersion: z.number().int().positive(),
    ruleVersions: z.record(z.string().min(1)),
    entries: z.array(entrySchema),
    suppressions: z.array(suppressionSchema),
  })
  .strict();

export function createBaseline(
  result: RunResult,
  options: {
    previous?: Baseline;
    suppressions?: readonly Suppression[];
    now?: string;
  } = {},
): Baseline {
  const target = sanitizeUrl(result.target);
  if (options.previous && options.previous.target !== target)
    throw new WalkdownError(
      "INVALID_ARGUMENT",
      "The previous baseline target differs from the selected run.",
      "Use a baseline created for the same normalized target.",
    );
  const now = options.now ?? new Date().toISOString();
  const previousByFingerprint = new Map(
    options.previous?.entries.map((entry) => [entry.fingerprint, entry]),
  );
  const currentByFingerprint = new Map(
    result.findings.map((finding) => [finding.fingerprint, finding]),
  );
  const entries: BaselineEntry[] = [];
  for (const finding of result.findings) {
    const previous = previousByFingerprint.get(finding.fingerprint);
    entries.push({
      fingerprint: finding.fingerprint,
      fingerprintVersion: FINGERPRINT_VERSION,
      ruleId: finding.ruleId,
      ruleVersion: ruleVersion(finding),
      severity: finding.severity,
      route: sanitizeUrl(finding.route),
      source: finding.source,
      status: "active",
      firstSeenAt: previous?.firstSeenAt ?? now,
      lastSeenAt: now,
    });
  }
  for (const previous of options.previous?.entries ?? []) {
    if (currentByFingerprint.has(previous.fingerprint)) continue;
    entries.push({ ...previous, status: "fixed" });
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    baselineVersion: BASELINE_VERSION,
    target,
    createdAt: options.previous?.createdAt ?? now,
    updatedAt: now,
    sourceRunId: result.run.runId,
    fingerprintVersion: FINGERPRINT_VERSION,
    ruleVersions: Object.fromEntries(
      entries.map((entry) => [entry.ruleId, entry.ruleVersion]),
    ),
    entries: entries.sort(compareEntries),
    suppressions: sanitizeSuppressions(
      options.suppressions ?? options.previous?.suppressions ?? [],
    ),
  };
}

export function compareWithBaseline(
  result: RunResult,
  baseline: Baseline,
  options: {
    failOn?: readonly Severity[];
    now?: string;
    regression?: ComparisonResult["regression"];
  } = {},
): RunResult {
  if (baseline.target !== sanitizeUrl(result.target))
    throw new WalkdownError(
      "INVALID_CONFIG",
      `Baseline target ${baseline.target} does not match ${result.target}.`,
      "Select a baseline for the same normalized target.",
    );
  const now = options.now ?? new Date().toISOString();
  const failOn = [...(options.failOn ?? ["error", "blocking"])] as Severity[];
  const entries = new Map(
    baseline.entries.map((entry) => [entry.fingerprint, entry]),
  );
  const currentRuleVersions = ruleVersionsFromResult(result);
  const migrations = Object.entries(baseline.ruleVersions)
    .filter(
      ([ruleId, version]) =>
        currentRuleVersions[ruleId] !== undefined &&
        currentRuleVersions[ruleId] !== version,
    )
    .map(([ruleId, version]) => ({
      ruleId,
      baselineVersion: version,
      currentVersion: currentRuleVersions[ruleId] ?? "unknown",
      reason: "Rule identity changed; update the baseline explicitly.",
    }));
  for (const finding of result.findings) {
    const entry = baseline.entries.find(
      (candidate) => candidate.fingerprint === finding.fingerprint,
    );
    const currentVersion = ruleVersion(finding);
    if (
      entry &&
      entry.ruleVersion !== currentVersion &&
      !migrations.some((migration) => migration.ruleId === finding.ruleId)
    )
      migrations.push({
        ruleId: finding.ruleId,
        baselineVersion: entry.ruleVersion,
        currentVersion,
        reason: "Rule identity changed; update the baseline explicitly.",
      });
  }
  if (baseline.fingerprintVersion !== FINGERPRINT_VERSION)
    migrations.push({
      ruleId: "*",
      baselineVersion: `fingerprint-v${baseline.fingerprintVersion}`,
      currentVersion: `fingerprint-v${FINGERPRINT_VERSION}`,
      reason: "Fingerprint identity changed; update the baseline explicitly.",
    });
  const migrationRules = new Set(migrations.map((item) => item.ruleId));
  const expiredSuppressions = baseline.suppressions.filter((suppression) =>
    isExpired(suppression, now),
  );
  const findings = result.findings.map((finding) => {
    const state = classifyFinding(
      finding,
      entries.get(finding.fingerprint),
      baseline.suppressions,
      migrationRules,
      now,
    );
    return { ...finding, state };
  });
  const present = new Set(findings.map((finding) => finding.fingerprint));
  const fixed = baseline.entries
    .filter(
      (entry) =>
        entry.status === "active" &&
        !present.has(entry.fingerprint) &&
        !migrationRules.has(entry.ruleId) &&
        !migrationRules.has("*"),
    )
    .map(({ fingerprint, ruleId, severity, route, source }) => ({
      fingerprint,
      ruleId,
      severity,
      route,
      source,
    }));
  const counts: ComparisonResult["counts"] = {
    new: 0,
    persistent: 0,
    fixed: fixed.length,
    regressed: 0,
    ignored: 0,
    inconclusive: 0,
  };
  for (const finding of findings) counts[finding.state] += 1;
  const failures = findings
    .filter(
      (finding) =>
        (finding.state === "new" || finding.state === "regressed") &&
        failOn.includes(finding.severity),
    )
    .map((finding) => finding.fingerprint);
  const incomplete =
    result.run.status !== "completed" ||
    result.coverage.status === "incomplete" ||
    migrations.length > 0;
  return {
    ...result,
    findings,
    summary: {
      ...result.summary,
      verdict: incomplete
        ? "incomplete"
        : failures.length > 0
          ? "fail"
          : "pass",
      blockers: failures.length,
    },
    comparison: {
      baselineVersion: BASELINE_VERSION,
      sourceRunId: baseline.sourceRunId,
      comparedAt: now,
      counts,
      fixed,
      migrations,
      expiredSuppressions,
      policy: { failOn, failures },
      regression: options.regression,
    },
  };
}

function sanitizeUrl(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()])
    if (sensitiveQueryKey.test(key)) url.searchParams.delete(key);
  return url.toString();
}

export async function readBaseline(filePath: string): Promise<Baseline> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new WalkdownError(
      "FILESYSTEM_ERROR",
      `Cannot read baseline at ${filePath}.`,
      "Create it with `walkdown baseline` or select another path.",
      error,
    );
  }
  const parsed = baselineSchema.safeParse(value);
  if (!parsed.success)
    throw new WalkdownError(
      "INVALID_CONFIG",
      `Invalid baseline: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      "Fix or recreate the versioned baseline.",
    );
  return parsed.data;
}

export async function writeBaseline(
  filePath: string,
  baseline: Baseline,
): Promise<void> {
  await writeJsonAtomic(filePath, baseline);
}

export async function writeVerificationResult(
  runDirectory: string,
  result: VerificationResult,
): Promise<string> {
  const filePath = join(runDirectory, "verification.json");
  await writeJsonAtomic(filePath, result);
  return filePath;
}

export function evaluateWalkdownVerification(options: {
  sourceFinding: PublishedFinding;
  sourceRunId: string;
  verificationResult: RunResult;
  appGraph: AppGraph;
  executor?: VerificationResult["executor"];
}): VerificationResult {
  const route =
    options.sourceFinding.verification.route ?? options.sourceFinding.route;
  const routeNode = options.appGraph.routes.find(
    (candidate) => candidate.url === route,
  );
  const expectedElement = options.sourceFinding.verification.element;
  const reachedElement =
    expectedElement === undefined ||
    routeNode?.elements.some(
      (element) =>
        element.role === expectedElement.role &&
        element.name === expectedElement.name &&
        element.context === expectedElement.context,
    ) === true;
  const repeated = options.verificationResult.findings.find(
    (finding) => finding.fingerprint === options.sourceFinding.fingerprint,
  );
  return {
    schemaVersion: SCHEMA_VERSION,
    fingerprint: options.sourceFinding.fingerprint,
    outcome:
      !routeNode || !reachedElement
        ? "inconclusive"
        : repeated
          ? "fail"
          : "pass",
    executor: options.executor ??
      options.sourceFinding.verification.executor ?? {
        provider: "walkdown",
        version: "legacy-v1",
      },
    sourceRunId: options.sourceRunId,
    verificationRunId: options.verificationResult.run.runId,
    route,
    reason: !routeNode
      ? "The original route was not reached."
      : !reachedElement
        ? "The original semantic element was not reached."
        : repeated
          ? "The original finding was reproduced."
          : "The original context was reached and the finding was absent.",
    finding: repeated,
  };
}

export async function readRunResult(filePath: string): Promise<RunResult> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as RunResult;
    if (
      value.schemaVersion !== SCHEMA_VERSION ||
      !value.run?.runId ||
      !Array.isArray(value.findings)
    )
      throw new Error("Unsupported result contract.");
    return value;
  } catch (error) {
    throw new WalkdownError(
      "FILESYSTEM_ERROR",
      `Cannot read run result at ${filePath}.`,
      "Select a valid Walkdown result.json file.",
      error,
    );
  }
}

export async function findLatestRunResult(
  outputDir: string,
  fingerprint?: string,
): Promise<{ filePath: string; result: RunResult }> {
  const runsDirectory = join(outputDir, "runs");
  let names: string[];
  try {
    names = (await readdir(runsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((first, second) => second.localeCompare(first));
  } catch (error) {
    throw new WalkdownError(
      "FILESYSTEM_ERROR",
      `Cannot inspect runs at ${runsDirectory}.`,
      "Run a scan first or pass an explicit result path.",
      error,
    );
  }
  for (const name of names) {
    const filePath = join(runsDirectory, name, "result.json");
    try {
      const result = await readRunResult(filePath);
      if (
        fingerprint === undefined ||
        result.findings.some((finding) => finding.fingerprint === fingerprint)
      )
        return { filePath, result };
    } catch {
      // Incomplete runs without a canonical result are skipped.
    }
  }
  throw new WalkdownError(
    "INVALID_ARGUMENT",
    fingerprint
      ? `No prior result contains fingerprint ${fingerprint}.`
      : "No completed Walkdown result was found.",
    "Run a scan first or pass an explicit result path.",
  );
}

function classifyFinding(
  finding: PublishedFinding,
  entry: BaselineEntry | undefined,
  suppressions: readonly Suppression[],
  migrationRules: ReadonlySet<string>,
  now: string,
): FindingState {
  if (migrationRules.has("*") || migrationRules.has(finding.ruleId))
    return "inconclusive";
  if (
    suppressions.some(
      (suppression) =>
        suppression.fingerprint === finding.fingerprint &&
        suppression.ruleId === finding.ruleId &&
        !isExpired(suppression, now),
    )
  )
    return "ignored";
  if (!entry) return "new";
  return entry.status === "fixed" ? "regressed" : "persistent";
}

function ruleVersionsFromResult(result: RunResult): Record<string, string> {
  return Object.fromEntries(
    result.findings.map((finding) => [finding.ruleId, ruleVersion(finding)]),
  );
}

function ruleVersion(finding: PublishedFinding): string {
  return finding.source.provider === "walkdown"
    ? (RULE_VERSIONS[finding.ruleId as RuleId] ?? finding.source.adapterVersion)
    : `${finding.source.providerVersion}/${finding.source.adapterVersion}`;
}

function sanitizeSuppressions(
  suppressions: readonly Suppression[],
): Suppression[] {
  return suppressions
    .map((suppression) => ({
      ...suppression,
      reason: redactText(suppression.reason),
      author: suppression.author ? redactText(suppression.author) : undefined,
    }))
    .sort(
      (first, second) =>
        first.ruleId.localeCompare(second.ruleId) ||
        first.fingerprint.localeCompare(second.fingerprint),
    );
}

function isExpired(suppression: Suppression, now: string): boolean {
  return suppression.expiresAt !== undefined && suppression.expiresAt <= now;
}

function compareEntries(first: BaselineEntry, second: BaselineEntry): number {
  return (
    first.ruleId.localeCompare(second.ruleId) ||
    first.route.localeCompare(second.route) ||
    first.fingerprint.localeCompare(second.fingerprint)
  );
}

async function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
}
