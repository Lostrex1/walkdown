# GitHub Action

The Walkdown Action checks an application that your workflow has already started. It waits for readiness, runs an exact CLI version, writes a pull-request Job Summary, emits annotations, and preserves canonical JSON and SARIF before propagating the CLI outcome.

## Node server

```yaml
permissions:
  contents: read
  security-events: write # optional; omit to keep SARIF only as an artifact

steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 22
      cache: npm
  - run: npm ci
  - run: npm run build
  - run: npm run start &
  - uses: Lostrex1/walkdown@v1
    with:
      target: http://127.0.0.1:3000
      health-url: http://127.0.0.1:3000/health
      config: walkdown.config.yaml
      baseline: .walkdown/baseline.json
      cli-version: 0.1.0
```

The workflow owns application startup and teardown. Walkdown never guesses how to launch a stack and never receives application secrets unless the workflow author explicitly exposes them.

## Static application and browser cache

```yaml
- uses: actions/cache@v4
  with:
    path: ~/.cache/ms-playwright
    key: chromium-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
- run: npx serve dist --listen 4173 &
- uses: Lostrex1/walkdown@v1
  with:
    target: http://127.0.0.1:4173
    install-browser: true
    fail-on: error,blocking
```

Pin the major Action tag (`@v1`) and an exact `cli-version`. The Action bundle and CLI have independent releases: the major tag receives compatible Action fixes while the exact CLI keeps check semantics reproducible.

## Outputs and exit behavior

`result-path`, `sarif-path`, `verdict`, `run-id`, `status`, `artifact-name`, and `sarif-uploaded` are available to later steps. CLI exit codes keep their meaning: 0 passes, 1 means policy findings, 2 means incomplete coverage, 3 means invalid invocation, and 4 means infrastructure failure. Results are summarized and uploaded before a non-zero scan outcome fails the step.

The default policy blocks only `new` or `regressed` findings at `error` or `blocking` severity. Persistent reviewed debt remains visible but nonblocking. Change `fail-on` only as an explicit repository policy decision.

## Privacy, forks, and permissions

Screenshots, Playwright traces, and raw evidence are off by default. Lightweight `results.json`, `results.sarif`, Markdown, and JSONL reports are retained for seven days. Opt in with `upload-evidence: true` plus `screenshots: true` and/or `trace: true`; review those artifacts for tokens and personal data before broadening access or retention. URLs shown by the Action omit credentials, query strings, and fragments.

`contents: read` is sufficient for scanning and artifact upload. Add `security-events: write` only for Code Scanning. SARIF publication detects fork pull requests and skips the write; missing permissions also degrade to a warning while SARIF remains downloadable. Do not use `pull_request_target` to run untrusted contribution code with write tokens or secrets.

Set `upload-sarif: false` where Code Scanning is unavailable. Set `upload-artifact: false` for environments that do not provide the GitHub artifact service.

## Timeouts and diagnostics

“Target did not become available” is a startup/readiness failure, not a product finding. Confirm the server binds to `127.0.0.1` or `0.0.0.0`, keep its start step in the same job, and point `health-url` to a cheap endpoint returning any 2xx–4xx response. Increase `health-timeout-ms` for slow startup. `timeout-ms` governs browser operations; `command-timeout-ms` bounds installation and the whole CLI process.

For local reproduction, download `results.json`, use the command in the Job Summary, and run the exact CLI version shown in the workflow.

## Release checklist

The committed `packages/action/dist/index.js` is the immutable Node 24 bundle consumed by GitHub. A v1 release must run `npm run action:check`, `npm run check`, and `npm test`, publish `@walkdown/core@0.1.0` before `walkdown@0.1.0`, create an immutable `v1.x.y` tag, and advance the movable `v1` tag only after the exact tag passes dogfood CI. Release notes must state the bundled Action version and the default CLI version.
