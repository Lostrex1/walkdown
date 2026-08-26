# Walkdown

Walkdown is a local-first, agent-native web behavior linter. It runs an application in a real browser, safely explores its observable surface, and produces reproducible findings with evidence.

The project is specification-driven. Product requirements, architecture decisions, and implementation order live in [`spec/`](spec/README.md).

## Status

The **001–008 MVP is complete**, including the GitHub Action and pull-request experience. The next specified priority is the optional Preflight integration in 015.

## Principles

- Evidence before opinion.
- Deterministic and local-first by default.
- Safe exploration: no destructive or unknown actions without explicit permission.
- Versioned JSON as the canonical contract for humans and agents.

## Planned stack

TypeScript (strict ESM), Node.js 22+, Playwright, Vitest, and Biome.

## Development

Requires Node.js 22 or later.

```bash
npm install
npm run check
npm test
npm run dev -- scan http://localhost:3000
```

`walkdown scan <url>` opens the target in Chromium and persists a local run. It captures initial navigation, console and page errors, requests/responses, dialogs, downloads, popups, a screenshot, an accessibility snapshot and a trace. Runs are written under `.walkdown/runs/` by default. Chromium is never installed by the CLI: install it explicitly for local development with `npx playwright install chromium`.

Configuration is loaded from `walkdown.config.yaml`. See [walkdown.config.example.yaml](walkdown.config.example.yaml) and [schemas/config.schema.json](schemas/config.schema.json). Precedence is CLI flags, then `WALKDOWN_OUTPUT_DIR`, `WALKDOWN_TIMEOUT_MS`, and `WALKDOWN_MAX_PAGES`, then the config file, then defaults. Use `--print-config` to inspect the effective non-sensitive configuration.

Human output is sent to stdout. `--format` supports `human`, `json`, `jsonl`, `markdown`, `sarif`, and `agent`; `--quiet` emits canonical JSON. Every successful browser session also writes the canonical `result.json` inside its run directory. Diagnostics and errors go to stderr. See [RunResult and output formats](docs/outputs.md) for contracts, provenance, evidence links, and exit semantics.

Browser capture defaults to a 100 ms settle window and 10 MB maximum size per artifact. Configure these limits under `browser` in `walkdown.config.yaml`; oversized artifacts are omitted explicitly in the run manifest rather than silently truncated. Evidence paths in that manifest always use `/` relative to the run directory and sensitive token-like values are redacted before persistence.

Walkdown explores with deterministic breadth-first traversal. It follows only same-origin GET links by default and saves `artifacts/app-graph.json` with coverage, pending routes and skipped actions. URLs lose fragments, tracking query parameters (`utm_*`, `fbclid`, `gclid`) and have their remaining query parameters sorted. Buttons, form controls, uploads, downloads, unknown controls, external links and actions matching protected vocabulary such as delete, pay, send, publish, invite or logout are never activated by default. Configure budgets under `exploration`; reaching one is reported as incomplete coverage, never as a complete scan.

After exploration, Walkdown evaluates deterministic navigation and runtime checks and saves `artifacts/findings.json`. Built-in rules cover placeholder links, broken internal destinations and redirect loops, page exceptions, console errors, and failed first-party requests. Known noise can be filtered without deleting the underlying evidence. See [Navigation and runtime checks](docs/checks.md) for rule IDs, defaults, and valid configuration.

Walkdown also probes authorized safe controls in isolated pages, compares normalized before/after state, measures every configured viewport, performs center-point hit testing, inventories accessible names, traverses focus with real Tab events, and checks modal focus behavior. Generic button clicks require explicit permission and uncertain attempts remain evidence without becoming failures. See [Interaction, responsive, and functional accessibility checks](docs/behavior-checks.md) for effect semantics, rule IDs, safety policy, and configuration.

Reviewed debt can be stored explicitly with `walkdown baseline`. Later scans classify findings as new, persistent, regressed, ignored, or inconclusive and report fixed baseline entries separately. `walkdown verify <fingerprint>` re-observes one finding with a semantic recipe and tri-state result; `walkdown regression` applies the baseline policy with a conservative full-scan fallback. See [Baseline, verification, and regression](docs/baseline-and-verification.md).

GitHub workflows can use `Lostrex1/walkdown@v1` against an application they start in the same job. The Action performs bounded readiness checks, pins CLI semantics, produces a Job Summary and annotations, retains JSON/SARIF even on findings, and safely skips Code Scanning writes for untrusted forks or insufficient permissions. Screenshots, traces, and raw evidence remain opt-in. See [GitHub Action](docs/github-action.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
