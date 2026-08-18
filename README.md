# Walkdown

Walkdown is a local-first, agent-native web behavior linter. It runs an application in a real browser, safely explores its observable surface, and produces reproducible findings with evidence.

The project is specification-driven. Product requirements, architecture decisions, and implementation order live in [`spec/`](spec/README.md).

## Status

The project is at the start of the MVP. The next implementation milestone is **002 · browser engine and base evidence**.

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

`walkdown scan <url>` currently validates configuration and persists a local run; browser automation begins in milestone 002. Runs are written under `.walkdown/runs/` by default.

Configuration is loaded from `walkdown.config.yaml`. See [walkdown.config.example.yaml](walkdown.config.example.yaml) and [schemas/config.schema.json](schemas/config.schema.json). Precedence is CLI flags, then `WALKDOWN_OUTPUT_DIR`, `WALKDOWN_TIMEOUT_MS`, and `WALKDOWN_MAX_PAGES`, then the config file, then defaults. Use `--print-config` to inspect the effective non-sensitive configuration.

Human output is sent to stdout. `--format json` or `--quiet` emits one JSON result only; diagnostics and errors go to stderr.

## License

Licensed under the [Apache License 2.0](LICENSE).
