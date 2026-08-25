# Baseline, verification, and regression

Walkdown treats the baseline as reviewed project data, never as an implicit side effect of a scan. By default it lives at `<outputDir>/baseline.json` and validates against [baseline.schema.json](../schemas/baseline.schema.json).

## Accept known debt

Run a scan, review its canonical result, then create or explicitly update the baseline:

```text
walkdown scan https://app.example --format json
walkdown baseline
```

Use `walkdown baseline --from path/to/result.json` to select a specific run. The file contains only fingerprints, rules, versions, routes, severities, provenance, timestamps, state history, and suppressions. It never copies observations, session data, screenshots, evidence paths, or absolute filesystem paths.

When a baseline exists, subsequent scans classify active findings:

- `new`: no matching baseline identity;
- `persistent`: matching accepted active debt;
- `regressed`: an entry explicitly recorded as fixed has reappeared;
- `ignored`: an active suppression matches;
- `inconclusive`: fingerprint or rule versions require migration.

Accepted entries absent from the scan appear in `comparison.fixed`. They become historical `fixed` entries only when `walkdown baseline` is run explicitly again. This history lets Walkdown recognize a later regression.

The default policy fails only `new` and `regressed` findings at `error` or `blocking` severity. Persistent debt does not fail. Configure this without changing detection severity:

```yaml
baseline:
  path: baseline.json
  failOn: [warning, error, blocking]
```

Use `--skip-baseline` for a deliberately standalone scan.

## Suppressions

Suppressions are reviewed entries in `baseline.json` and require an exact fingerprint, rule ID, and reason. Author and expiry are optional:

```json
{
  "fingerprint": "0123456789abcdef...",
  "ruleId": "runtime.console-error",
  "reason": "Owned by the upstream migration tracked in APP-123",
  "author": "web-platform",
  "expiresAt": "2026-09-30T00:00:00.000Z"
}
```

Expired suppressions are reported in `comparison.expiredSuppressions` and the finding is evaluated normally. Invalid or incomplete suppressions reject the baseline.

## Verify one finding

```text
walkdown verify <fingerprint>
walkdown verify <fingerprint> --from .walkdown/runs/<run>/result.json --format json
```

The native executor reopens the recorded route with a short budget and uses role, accessible name, and context to reidentify an original element when applicable. It returns:

- `PASS`: the route and semantic context were reached and the fingerprint was absent;
- `FAIL`: the original fingerprint was reproduced;
- `INCONCLUSIVE`: the route, element, or executor could not be reached reliably.

The focused run stores `verification.json` beside its canonical result. A missing element is never treated as proof of repair. Recipes identify their executor provider; v1 implements only `walkdown`, while unknown providers return `INCONCLUSIVE`.

## Regression

```text
walkdown regression
```

Regression loads the baseline target and applies the same state/severity policy. The MVP has no trustworthy code-to-rule impact map, so it deliberately falls back to a full safe scan and records that decision in `comparison.regression`. This confirms that no new or regressed configured blockers appeared without pretending a reduced scan was sufficient.

Rule and fingerprint identity are versioned. A mismatch produces `comparison.migrations`, marks affected findings inconclusive, and exits as incomplete until the baseline is updated explicitly. It never silently turns a version change into hundreds of fixed and new findings.
