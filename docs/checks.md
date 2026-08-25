# Navigation and runtime checks

For active interaction, responsive, keyboard, and modal rules, see [Interaction, responsive, and functional accessibility checks](behavior-checks.md).

Walkdown evaluates built-in checks from the observations and application graph already captured during a scan. Rules are pure: they do not navigate, write artifacts, or print output. The browser session writes their versioned result to `artifacts/findings.json` and keeps the source observations unchanged in `artifacts/observations.json`.

## Built-in rules

| Rule ID | Default | Meaning |
| --- | --- | --- |
| `navigation.placeholder-link` | `warning` | A link uses an empty target, `#`, `javascript:void(0)`, `javascript:;`, or an exact configured placeholder. |
| `navigation.broken-internal-link` | `error` | An observed same-origin link ends in HTTP 4xx/5xx or a redirect loop. Redirect URLs are retained in the sample. |
| `runtime.page-error` | `error` | The page emitted an unhandled JavaScript exception. The route, relative timestamp, redacted message, and redacted stack are retained when available. |
| `runtime.console-error` | `warning` | The page emitted a console message at error level. Generic warnings do not produce this finding. |
| `runtime.failed-request` | `error` | A first-party navigation or resource request failed before a response or returned 5xx. Expected cancellation noise and third-party failures remain evidence but do not produce a finding. |

`mailto:`, `tel:`, downloads, and external links are not checked as broken internal links. A response can support both a broken-link finding and a failed-request finding because those rules describe different observable facts.

Repeated events with the same normalized cause and route become one finding with `occurrenceCount` and up to three samples. IDs and SHA-256 fingerprints do not depend on the run ID, relative timestamp, UUID values, ISO timestamps, or ephemeral localhost ports.

## Configuration and suppression

Every rule accepts `enabled` and `severity`. Severity can be `info`, `warning`, `error`, or `blocking`; changing it does not change the rule condition.

Only these explicit filters are valid:

- `ignoreMessagePatterns` for `runtime.page-error` and `runtime.console-error`.
- `ignoreUrlPatterns` for `navigation.broken-internal-link`.
- Both filters for `runtime.failed-request`.

Patterns are case-insensitive whole-value globs where `*` matches any characters. Unknown fields and filters on a rule that does not support them are rejected. Filtering prevents a finding but never removes the original event from the run evidence.

```yaml
checks:
  placeholders: ["", "#", "javascript:void(0)", "/coming-soon"]
  rules:
    runtime.console-error:
      enabled: true
      severity: warning
      ignoreMessagePatterns:
        - "*ResizeObserver loop limit exceeded*"
    runtime.failed-request:
      enabled: true
      severity: error
      ignoreMessagePatterns:
        - "*ERR_ABORTED*"
      ignoreUrlPatterns:
        - "*/expected-offline-probe"
```

Disabling a rule is appropriate only when its condition is intentionally outside the scan policy. Prefer a narrow filter for known noise so other instances remain visible.
