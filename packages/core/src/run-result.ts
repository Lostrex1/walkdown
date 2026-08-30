import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { redactValue } from "./artifact-writer.js";
import { RULE_VERSIONS } from "./baseline.js";
import type {
  AppGraph,
  CandidateAction,
  ElementRef,
  EvidenceRef,
  Finding,
  FindingConfidence,
  FindingSample,
  PublishedEvidenceRef,
  PublishedFinding,
  RuleId,
  Run,
  RunResult,
  Severity,
} from "./contracts.js";
import { RULE_IDS, SCHEMA_VERSION } from "./contracts.js";
import { validateRunResult } from "./contracts-validation.js";
import {
  renderAgentPrompt,
  renderJsonl,
  renderMarkdown,
  toSarif,
} from "./reporters.js";

interface Guidance {
  confidence: FindingConfidence;
  inference: string;
  objective: string;
  constraints: string[];
  acceptanceCriteria: string[];
  expectedOutcome: string;
}

const commonConstraints = [
  "Preserve intended user behavior and existing public interfaces.",
  "Do not weaken or disable the check to hide the finding.",
];

const guidance: Record<RuleId, Guidance> = {
  "navigation.placeholder-link": guide(
    "high",
    "The navigation control has no usable destination.",
    "Give the control a valid destination or remove its navigation semantics.",
    "Activating the control reaches the intended route without a placeholder URL.",
  ),
  "navigation.broken-internal-link": guide(
    "high",
    "The observed first-party navigation did not complete successfully.",
    "Restore the destination or update the control to a valid internal route.",
    "The destination completes without an HTTP error or redirect loop.",
  ),
  "runtime.page-error": guide(
    "high",
    "The page emitted an unhandled runtime exception during the observed flow.",
    "Handle or prevent the exception while preserving the intended flow.",
    "The same flow completes without an unhandled page exception.",
  ),
  "runtime.console-error": guide(
    "medium",
    "The page reported an error through the browser console.",
    "Resolve the underlying error or emit an appropriate non-error diagnostic.",
    "The same flow produces no matching console error.",
  ),
  "runtime.failed-request": guide(
    "high",
    "A required first-party request failed or returned a server error.",
    "Make the request complete successfully or handle the failure explicitly.",
    "The request succeeds or the interface presents an intentional recoverable state.",
  ),
  "interaction.dead-control": guide(
    "medium",
    "The safe control produced no observable user-facing effect.",
    "Connect the control to its intended behavior and expose resulting feedback.",
    "Activation produces the intended observable effect.",
  ),
  "interaction.pseudo-control": guide(
    "high",
    "The element appears interactive without complete control semantics.",
    "Use an appropriate semantic control with keyboard and accessibility behavior.",
    "The control is operable and exposes the correct accessible role and name.",
  ),
  "responsive.horizontal-overflow": guide(
    "high",
    "Rendered content exceeds the configured viewport width.",
    "Constrain or reflow the overflowing content at the affected viewport.",
    "The page has no unintended horizontal overflow at the affected viewport.",
  ),
  "interaction.obstructed-control": guide(
    "medium",
    "The visible control could not be reached at its actionable point.",
    "Remove the obstruction or reposition the control within the usable viewport.",
    "The control is visible and actionable at every configured viewport.",
  ),
  "accessibility.missing-name": guide(
    "high",
    "The interactive control has no accessible name.",
    "Provide a concise programmatic name that describes the control purpose.",
    "The control exposes a non-empty, meaningful accessible name.",
  ),
  "accessibility.keyboard-focus": guide(
    "medium",
    "Keyboard traversal did not reliably reach the observed controls.",
    "Restore a logical, visible keyboard focus path through interactive controls.",
    "Keyboard traversal reaches each visible control in a logical order.",
  ),
  "accessibility.modal-focus": guide(
    "medium",
    "Modal focus did not move, remain contained, or return as expected.",
    "Implement complete focus entry, containment, dismissal, and restoration.",
    "Opening and closing the modal preserves a predictable keyboard focus cycle.",
  ),
};

function guide(
  confidence: FindingConfidence,
  inference: string,
  objective: string,
  expectedOutcome: string,
): Guidance {
  return {
    confidence,
    inference,
    objective,
    constraints: commonConstraints,
    acceptanceCriteria: [
      expectedOutcome,
      "The focused Walkdown verification command exits successfully.",
    ],
    expectedOutcome,
  };
}

export function assembleRunResult(options: {
  run: Run;
  appGraph: AppGraph;
  findings: readonly Finding[];
  evidence: readonly EvidenceRef[];
  omissions?: readonly string[];
}): RunResult {
  if (options.run.status === "running" || !options.run.finishedAt)
    throw new Error("RunResult can only be assembled from a finalized run.");
  const evidence = [
    ...options.evidence.map(publishEvidence),
    ...(options.omissions ?? []).map(publishOmission),
  ];
  const findings = options.findings.map((finding) =>
    publishFinding(finding, options.run, options.appGraph, evidence),
  );
  const bySeverity: Record<Severity, number> = {
    info: 0,
    warning: 0,
    error: 0,
    blocking: 0,
  };
  for (const finding of findings) bySeverity[finding.severity] += 1;
  const blockers = bySeverity.error + bySeverity.blocking;
  const incomplete =
    options.run.status !== "completed" ||
    options.appGraph.coverage.status === "incomplete";
  return redactValue({
    schemaVersion: SCHEMA_VERSION,
    run: {
      runId: options.run.runId,
      startedAt: options.run.startedAt,
      finishedAt: options.run.finishedAt,
      status: options.run.status,
      version: options.run.version,
    },
    target: options.run.target,
    config: options.run.config,
    coverage: options.appGraph.coverage,
    summary: {
      verdict: incomplete ? "incomplete" : blockers > 0 ? "fail" : "pass",
      findingCount: findings.length,
      blockers,
      bySeverity,
    },
    findings,
    evidence,
    ruleManifest: Object.fromEntries(
      RULE_IDS.map((ruleId) => [
        ruleId,
        {
          version: RULE_VERSIONS[ruleId],
          enabled: options.run.config.checks.rules[ruleId].enabled,
          outcome: "completed" as const,
        },
      ]),
    ),
  });
}

export async function writeRunResult(
  runDirectory: string,
  result: RunResult,
): Promise<string> {
  validateRunResult(result);
  const filePath = join(runDirectory, "result.json");
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, filePath);
  return filePath;
}

export async function writeDerivedReports(
  runDirectory: string,
  result: RunResult,
): Promise<void> {
  await Promise.all([
    writeTextAtomic(join(runDirectory, "report.jsonl"), renderJsonl(result)),
    writeTextAtomic(join(runDirectory, "report.md"), renderMarkdown(result)),
    writeTextAtomic(
      join(runDirectory, "report.sarif"),
      `${JSON.stringify(toSarif(result), null, 2)}\n`,
    ),
    writeTextAtomic(join(runDirectory, "agent.txt"), renderAgentPrompt(result)),
  ]);
}

async function writeTextAtomic(filePath: string, value: string): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, value, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
}

function publishFinding(
  finding: Finding,
  run: Run,
  graph: AppGraph,
  evidence: readonly PublishedEvidenceRef[],
): PublishedFinding {
  const details = guidance[finding.ruleId];
  const { samples, ...publicFinding } = finding;
  const { element, action } = relatedControl(
    finding.samples,
    finding.route,
    graph,
  );
  const focusedEvidence = evidence.filter((item) =>
    ["screenshot", "trace", "observations", "app-graph", "findings"].includes(
      item.type,
    ),
  );
  return {
    ...publicFinding,
    source: {
      provider: "walkdown",
      providerVersion: run.version,
      nativeId: finding.ruleId,
      adapterVersion: "1",
    },
    state: "new",
    confidence: details.confidence,
    element,
    action,
    facts: [
      finding.message,
      `Observed ${finding.occurrenceCount} time${finding.occurrenceCount === 1 ? "" : "s"} on ${finding.route}.`,
    ],
    observations: samples,
    evidence: focusedEvidence,
    inference: details.inference,
    repair: {
      objective: details.objective,
      constraints: [...details.constraints],
      acceptanceCriteria: [...details.acceptanceCriteria],
    },
    expectedOutcome: details.expectedOutcome,
    verification: {
      command: `walkdown verify ${finding.fingerprint}`,
      expectedOutcome: `No active finding with fingerprint ${finding.fingerprint}.`,
      executor: { provider: "walkdown", version: "1" },
      route: finding.route,
      element: element
        ? { role: element.role, name: element.name, context: element.context }
        : undefined,
      action: action ? { kind: action.kind, risk: action.risk } : undefined,
      assertion: {
        type: "finding-absent",
        ruleId: finding.ruleId,
        fingerprint: finding.fingerprint,
      },
    },
  };
}

function relatedControl(
  samples: readonly FindingSample[],
  route: string,
  graph: AppGraph,
): { element?: ElementRef; action?: CandidateAction } {
  const first = samples[0]?.data;
  const embedded = first?.element;
  if (isElementRef(embedded)) {
    const action = graph.routes
      .find((candidate) => candidate.url === route)
      ?.actions.find((candidate) => candidate.element.id === embedded.id);
    return { element: embedded, action };
  }
  const elementId =
    typeof first?.elementId === "string"
      ? first.elementId
      : typeof first?.sourceElementId === "string"
        ? first.sourceElementId
        : undefined;
  if (!elementId) return {};
  const action = graph.routes
    .find((candidate) => candidate.url === route)
    ?.actions.find((candidate) => candidate.element.id === elementId);
  return action ? { element: action.element, action } : {};
}

function isElementRef(value: unknown): value is ElementRef {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ElementRef>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.role === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.context === "string" &&
    typeof candidate.visible === "boolean" &&
    typeof candidate.attributes === "object"
  );
}

function publishEvidence(item: EvidenceRef): PublishedEvidenceRef {
  assertPortablePath(item.path);
  return {
    type: item.type,
    path: item.path.replaceAll("\\", "/"),
    status: item.truncated ? "truncated" : "available",
    bytes: item.bytes,
    reason: item.truncated
      ? "Artifact was truncated at the configured byte limit."
      : undefined,
  };
}

function publishOmission(value: string): PublishedEvidenceRef {
  const separator = value.indexOf(":");
  const name = separator >= 0 ? value.slice(0, separator) : "unknown";
  const reason = separator >= 0 ? value.slice(separator + 1).trim() : value;
  const path = `artifacts/${name}`.replaceAll("\\", "/");
  assertPortablePath(path);
  return { type: evidenceType(name), path, status: "omitted", reason };
}

function evidenceType(name: string): PublishedEvidenceRef["type"] {
  if (name.endsWith(".png")) return "screenshot";
  if (name.endsWith(".zip")) return "trace";
  if (name.includes("accessibility")) return "accessibility";
  if (name.includes("observation")) return "observations";
  if (name.includes("graph")) return "app-graph";
  return "findings";
}

function assertPortablePath(path: string): void {
  const normalized = path.replaceAll("\\", "/");
  if (
    isAbsolute(path) ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  )
    throw new Error(`Evidence path must be relative to the run: ${path}`);
}
