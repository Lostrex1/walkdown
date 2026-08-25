# Interaction, responsive, and functional accessibility checks

Walkdown 005 adds bounded active probes to the passive navigation/runtime checks. Each probe uses a fresh page so state from one control does not make another control appear healthy. It never waits for `networkidle`, submits a form, enters data, uploads a file, or activates a download/external/pseudo-control directly.

## Safe interaction policy

Reversible native buttons with `aria-controls`, `aria-expanded`, `aria-haspopup`, or `aria-pressed` are eligible for interaction. A button can also opt in with `data-walkdown-safe`.

Generic button clicks remain disabled by default because JavaScript can attach remote side effects to a non-form button. Set `checks.interaction.allowButtonClicks: true` only for an application or fixture where those actions are authorized and isolated. Protected action vocabulary, form submissions, uploads, downloads, external controls, ambiguous controls, and destructive actions remain blocked even with this setting.

Each eligible control is reidentified from its stable element reference in a fresh page. Failure to reidentify it, an unstable baseline, obstruction, or a technical click failure produces an `inconclusive` attempt and never `interaction.dead-control`.

## Observable effects

An action passes when the bounded effect window captures at least one of:

- navigation;
- a significant normalized DOM or visible-content change;
- a newly initiated non-ignored request;
- a JavaScript dialog;
- a browser download;
- a popup;
- a meaningful focus move away from the trigger;
- changed accessible feedback from `role=status`, `role=alert`, or `aria-live`.

Click focus on the trigger itself does not count. DOM hashing removes scripts, styles, volatile framework attributes, configured dynamic regions, UUIDs, timestamps, and long generated numbers. Requests already present during baseline activity and configured analytics patterns do not count. Any new effect class must add a positive case, a negative case, and a causal rule.

`interaction.dead-control` is emitted only after Playwright successfully performs the action and the before/after probes find no allowed effect. Findings are not emitted for `inconclusive` attempts, but those attempts remain in `artifacts/observations.json`.

## Responsive and accessibility rules

| Rule ID | Default | Meaning |
| --- | --- | --- |
| `interaction.dead-control` | `error` | An authorized safe control executed without an observable effect. |
| `interaction.pseudo-control` | `warning` | A handler, pointer cursor, or non-native role creates an incomplete click affordance. |
| `responsive.horizontal-overflow` | `error` | Document width exceeds a configured viewport; the furthest offender is retained when identifiable. |
| `interaction.obstructed-control` | `error` | A visible control remains outside the actionable viewport or fails center-point hit testing. |
| `accessibility.missing-name` | `warning` | A visible native/ARIA control has no basic accessible name. Labels, `aria-labelledby`, image alt text, and SVG titles are recognized. |
| `accessibility.keyboard-focus` | `warning` | Bounded real-Tab traversal loses focus or cycles before reaching visible focusable controls. Budget exhaustion is inconclusive. |
| `accessibility.modal-focus` | `error` | An observed modal fails focus entry, reasonable Tab containment, or focus return after closing with Escape. An open modal that cannot be closed by this probe is inconclusive. |

All configured viewports are measured. Defaults include `desktop` (1440×900) and `mobile` (390×844); presets are ordinary configuration and can be replaced.

## Probe configuration

```yaml
checks:
  interaction:
    allowButtonClicks: false
    effectTimeoutMs: 500
    stabilityMs: 100
    layoutSettleMs: 100
    maxControlsPerPage: 20
    keyboardMaxSteps: 50
    dynamicSelectors:
      - "[data-walkdown-dynamic]"
      - "[data-walkdown-volatile]"
    ignoreRequestPatterns:
      - "*/analytics*"
      - "*/collect*"
      - "*google-analytics.com*"
```

The combined Chromium fixture exercises eight valid effect classes, all seven finding rules, a stable modal and a broken modal, polling/analytics noise, obstruction, overflow, accessible icon names, keyboard trapping, and unstable reidentification. On the development machine it completes in roughly 18–20 seconds; CI timing is expected to vary. Its negative controls verify that valid effects and inconclusive attempts do not become dead-control findings.
