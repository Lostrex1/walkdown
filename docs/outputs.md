# RunResult and output formats

Every completed scan writes `result.json` in its run directory. This versioned `RunResult` is the canonical public contract; terminal, JSONL, Markdown, SARIF, and agent output are derived views of the same immutable value. Portable derived files are saved beside it as `report.jsonl`, `report.md`, `report.sarif`, and `agent.txt`.

The v1 JSON contract is documented by [the result schema](../schemas/run-result.schema.json). It contains the finalized run identity, normalized target, redacted effective configuration, coverage, verdict summary, findings, and evidence inventory. Existing diagnostic artifacts such as `run.json` and `artifacts/findings.json` remain available for consumers of earlier milestones.

## Findings

A published finding keeps detection provenance in `source`. Native checks use `provider: "walkdown"`. An adapter can preserve an external provider's namespace, version, native ID, original message, and adapter version without implying that Walkdown performed the detection.

The contract deliberately separates:

- `facts`: observations supported by captured evidence;
- `inference`: the bounded conclusion drawn from those facts;
- `repair`: a framework-neutral objective, constraints, and acceptance criteria;
- `verification`: a focused command and its expected outcome.

Evidence paths use `/` and are relative to the run directory. An artifact that could not be retained is represented with `status: "omitted"` or `"truncated"` and a reason.

When a baseline is applied, the same result can include `comparison`: deterministic state counts, fixed identities, migrations, expired suppressions, policy failures, and regression fallback metadata. Active findings carry their comparison state; the canonical evidence and detection message remain unchanged.

## CLI formats

```text
walkdown scan https://app.example --format human
walkdown scan https://app.example --format json
walkdown scan https://app.example --format jsonl
walkdown scan https://app.example --format markdown
walkdown scan https://app.example --format sarif
walkdown scan https://app.example --format agent
```

`--quiet` is an alias for canonical JSON output. `--verbose` expands the terminal finding list. Human output uses color only on a TTY and never when `NO_COLOR` is set. JSONL starts with run context, emits one event per finding, includes coverage, and always ends with a summary event. Markdown links to relative evidence. SARIF validates against the vendored official OASIS SARIF 2.1.0 schema and does not invent source-code locations. The agent view explicitly points back to `result.json`; it is a convenience prompt, not another source of truth.

All formats share exit semantics:

- `0`: pass;
- `1`: completed scan with error or blocking findings;
- `2`: incomplete or cancelled scan/coverage;
- `3`: invalid invocation or configuration;
- `4`: infrastructure failure.

Changing `--format` never changes the verdict or exit code.
