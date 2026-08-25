import type {
  PublishedFinding,
  RunResult,
  RunVerdict,
  Severity,
} from "./contracts.js";

export type OutputFormat =
  | "human"
  | "json"
  | "jsonl"
  | "markdown"
  | "sarif"
  | "agent";

export function renderRunResult(
  result: RunResult,
  format: OutputFormat,
  options: { color?: boolean; verbose?: boolean } = {},
): string {
  switch (format) {
    case "human":
      return renderTerminal(result, options);
    case "json":
      return `${JSON.stringify(result, null, options.verbose ? 2 : undefined)}\n`;
    case "jsonl":
      return renderJsonl(result);
    case "markdown":
      return renderMarkdown(result);
    case "sarif":
      return `${JSON.stringify(toSarif(result), null, options.verbose ? 2 : undefined)}\n`;
    case "agent":
      return renderAgentPrompt(result);
  }
}

export function renderJsonl(result: RunResult): string {
  const events: unknown[] = [
    {
      schemaVersion: result.schemaVersion,
      type: "run",
      run: result.run,
      target: result.target,
      config: result.config,
    },
    ...result.findings.map((finding) => ({
      schemaVersion: result.schemaVersion,
      type: "finding",
      finding,
    })),
    {
      schemaVersion: result.schemaVersion,
      type: "coverage",
      coverage: result.coverage,
    },
    {
      schemaVersion: result.schemaVersion,
      type: "summary",
      summary: result.summary,
      evidence: result.evidence,
    },
  ];
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

export function renderTerminal(
  result: RunResult,
  options: { color?: boolean; verbose?: boolean } = {},
): string {
  const paint = createPainter(options.color === true);
  const lines = [
    `${paint.verdict(result.summary.verdict.toUpperCase(), result.summary.verdict)} — ${result.target}`,
    `${result.summary.findingCount} findings (${result.summary.blockers} blockers): ${severitySummary(result)}`,
    `Coverage: ${result.coverage.visitedPages}/${result.coverage.discoveredPages} pages, ${result.coverage.status}`,
  ];
  if (result.coverage.stopReasons.length > 0)
    lines.push(`Coverage limits: ${result.coverage.stopReasons.join(", ")}`);
  const visible = options.verbose
    ? result.findings
    : result.findings.slice(0, 10);
  for (const finding of visible)
    lines.push(
      `- ${paint.severity(`[${finding.severity}]`, finding.severity)} ${finding.ruleId} — ${finding.message} (${finding.route})`,
    );
  if (!options.verbose && result.findings.length > visible.length)
    lines.push(
      `… ${result.findings.length - visible.length} more; use --verbose to list all.`,
    );
  lines.push(
    "Next:",
    `  walkdown scan ${result.target} --format json`,
    `  walkdown scan ${result.target} --format markdown`,
    `Result: .walkdown/runs/${result.run.runId}/result.json`,
  );
  return `${lines.join("\n")}\n`;
}

export function renderMarkdown(result: RunResult): string {
  const lines = [
    `# Walkdown: ${result.summary.verdict.toUpperCase()}`,
    "",
    `Target: ${escapeMarkdown(result.target)}`,
    "",
    `Run: \`${result.run.runId}\` · Findings: ${result.summary.findingCount} · Blockers: ${result.summary.blockers}`,
    "",
    "## Coverage",
    "",
    `Visited ${result.coverage.visitedPages} of ${result.coverage.discoveredPages} discovered pages. Coverage is **${result.coverage.status}**.`,
    "",
    "## Findings",
    "",
  ];
  if (result.findings.length === 0) lines.push("No findings.", "");
  for (const finding of result.findings) {
    lines.push(
      `### ${finding.severity.toUpperCase()}: ${escapeMarkdown(finding.ruleId)}`,
      "",
      `${escapeMarkdown(finding.message)} Route: \`${escapeMarkdown(finding.route)}\``,
      "",
      "**Facts**",
      "",
      ...finding.facts.map((fact) => `- ${escapeMarkdown(fact)}`),
      "",
      "**Inference**",
      "",
      escapeMarkdown(finding.inference),
      "",
      "**Repair contract**",
      "",
      escapeMarkdown(finding.repair.objective),
      "",
      ...finding.repair.acceptanceCriteria.map(
        (criterion) => `- ${escapeMarkdown(criterion)}`,
      ),
      "",
      `Verification: \`${escapeMarkdown(finding.verification.command)}\``,
      "",
    );
    const links = finding.evidence.filter(
      (item) => item.status === "available",
    );
    if (links.length > 0)
      lines.push(
        `Evidence: ${links.map((item) => `[${item.type}](${encodeURI(item.path)})`).join(", ")}`,
        "",
      );
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function toSarif(result: RunResult): Record<string, unknown> {
  const rules = [
    ...new Set(result.findings.map((finding) => finding.ruleId)),
  ].map((id) => {
    const finding = result.findings.find(
      (candidate) => candidate.ruleId === id,
    );
    return {
      id,
      name: id.replaceAll(/[.-]/g, "_"),
      shortDescription: { text: finding?.message ?? id },
      help: {
        text: finding?.repair.objective ?? "Review the Walkdown finding.",
        markdown: finding?.repair.objective ?? "Review the Walkdown finding.",
      },
      properties: { provider: finding?.source.provider },
    };
  });
  return {
    $schema:
      "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "Walkdown",
            version: result.run.version,
            informationUri: "https://github.com/Lostrex1/walkdown",
            rules,
          },
        },
        invocations: [
          {
            executionSuccessful: result.run.status === "completed",
            startTimeUtc: result.run.startedAt,
            endTimeUtc: result.run.finishedAt,
            properties: {
              runId: result.run.runId,
              target: result.target,
              coverage: result.coverage,
              verdict: result.summary.verdict,
            },
          },
        ],
        results: result.findings.map(sarifResult),
      },
    ],
  };
}

export function renderAgentPrompt(result: RunResult): string {
  const lines = [
    "Use result.json as the canonical source. This prompt is only a derived view.",
    `Run ${result.run.runId} for ${result.target}: ${result.summary.verdict}; ${result.summary.findingCount} findings.`,
    "Preserve user behavior, do not disable checks, and verify every change against the finding acceptance criteria.",
  ];
  for (const finding of result.findings)
    lines.push(
      `- ${finding.id}: ${finding.message} Objective: ${finding.repair.objective} Verify: ${finding.verification.command}`,
    );
  if (result.findings.length === 0) lines.push("No repairs are requested.");
  return `${lines.join("\n")}\n`;
}

function sarifResult(finding: PublishedFinding): Record<string, unknown> {
  return {
    ruleId: finding.ruleId,
    level: sarifLevel(finding.severity),
    message: { text: `${finding.message} Route: ${finding.route}` },
    fingerprints: { "walkdown/v1": finding.fingerprint },
    properties: {
      id: finding.id,
      route: finding.route,
      state: finding.state,
      confidence: finding.confidence,
      source: finding.source,
      evidence: finding.evidence,
      repair: finding.repair,
      verification: finding.verification,
    },
  };
}

function sarifLevel(severity: Severity): "none" | "note" | "warning" | "error" {
  if (severity === "info") return "note";
  if (severity === "warning") return "warning";
  return "error";
}

function severitySummary(result: RunResult): string {
  return (["blocking", "error", "warning", "info"] as const)
    .map((severity) => `${severity}=${result.summary.bySeverity[severity]}`)
    .join(", ");
}

function createPainter(enabled: boolean): {
  verdict(value: string, verdict: RunVerdict): string;
  severity(value: string, severity: Severity): string;
} {
  const wrap = (code: number, value: string) =>
    enabled ? `\u001b[${code}m${value}\u001b[0m` : value;
  return {
    verdict(value, verdict) {
      return wrap(
        verdict === "pass" ? 32 : verdict === "fail" ? 31 : 33,
        value,
      );
    },
    severity(value, severity) {
      return wrap(
        severity === "blocking" || severity === "error"
          ? 31
          : severity === "warning"
            ? 33
            : 36,
        value,
      );
    },
  };
}

function escapeMarkdown(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(/([*_`[\]<>])/g, "\\$1");
}
