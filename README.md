# Walkdown

Walkdown is a local-first, agent-native web behavior linter. It runs an application in a real browser, safely explores its observable surface, and produces reproducible findings with evidence.

The project is specification-driven. Product requirements, architecture decisions, and implementation order live in [`spec/`](spec/README.md).

## Status

The project is at the start of the MVP. The next implementation milestone is **004 · navigation and runtime checks**.

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

Human output is sent to stdout. `--format json` or `--quiet` emits one JSON result only; diagnostics and errors go to stderr.

Browser capture defaults to a 100 ms settle window and 10 MB maximum size per artifact. Configure these limits under `browser` in `walkdown.config.yaml`; oversized artifacts are omitted explicitly in the run manifest rather than silently truncated. Evidence paths in that manifest always use `/` relative to the run directory and sensitive token-like values are redacted before persistence.

Walkdown explores with deterministic breadth-first traversal. It follows only same-origin GET links by default and saves `artifacts/app-graph.json` with coverage, pending routes and skipped actions. URLs lose fragments, tracking query parameters (`utm_*`, `fbclid`, `gclid`) and have their remaining query parameters sorted. Buttons, form controls, uploads, downloads, unknown controls, external links and actions matching protected vocabulary such as delete, pay, send, publish, invite or logout are never activated by default. Configure budgets under `exploration`; reaching one is reported as incomplete coverage, never as a complete scan.

## License

Licensed under the [Apache License 2.0](LICENSE).
