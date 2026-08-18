# Walkdown

Walkdown is a local-first, agent-native web behavior linter. It runs an application in a real browser, safely explores its observable surface, and produces reproducible findings with evidence.

The project is specification-driven. Product requirements, architecture decisions, and implementation order live in [`spec/`](spec/README.md).

## Status

The project is at the start of the MVP. The first implementation milestone is **001 · CLI and configuration foundations**.

## Principles

- Evidence before opinion.
- Deterministic and local-first by default.
- Safe exploration: no destructive or unknown actions without explicit permission.
- Versioned JSON as the canonical contract for humans and agents.

## Planned stack

TypeScript (strict ESM), Node.js 22+, Playwright, Vitest, and Biome.

## License

License selection is pending before the first public release.
