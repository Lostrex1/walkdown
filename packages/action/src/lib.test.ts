import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ActionResult,
  isUntrustedFork,
  redactUrl,
  renderActionSummary,
  runCommand,
  selectArtifactFiles,
  waitForHealth,
} from "./lib.js";

const result: ActionResult = {
  run: { runId: "run-1", status: "completed", version: "0.1.0" },
  target: "https://user:pass@example.test/app?token=secret#private",
  coverage: {
    status: "complete",
    visitedPages: 2,
    discoveredPages: 2,
    skippedActions: 3,
    stopReasons: [],
  },
  summary: {
    verdict: "fail",
    findingCount: 2,
    blockers: 1,
    bySeverity: { info: 0, warning: 1, error: 0, blocking: 1 },
  },
  findings: [
    {
      fingerprint: "one",
      ruleId: "runtime.page-error",
      state: "new",
      severity: "blocking",
      route: "https://example.test/x?secret=1",
      message: "Page failed",
    },
    {
      fingerprint: "two",
      ruleId: "navigation.placeholder-link",
      state: "persistent",
      severity: "warning",
      route: "https://example.test/",
      message: "Placeholder",
    },
  ],
  comparison: {
    counts: { new: 1, regressed: 0, persistent: 1, fixed: 2 },
    policy: { failures: ["one"] },
  },
  evidence: [],
};

describe("GitHub Action helpers", () => {
  it("waits through transient health failures", async () => {
    let attempts = 0;
    await waitForHealth("https://example.test", {
      timeoutMs: 10,
      intervalMs: 1,
      fetcher: async () =>
        new Response(null, { status: ++attempts === 2 ? 204 : 503 }),
      pause: async () => undefined,
    });
    expect(attempts).toBe(2);
  });

  it("reports a bounded unavailable target", async () => {
    let now = 0;
    await expect(
      waitForHealth("https://example.test", {
        timeoutMs: 10,
        intervalMs: 5,
        fetcher: async () => {
          throw new Error("refused");
        },
        now: () => (now += 5),
        pause: async () => undefined,
      }),
    ).rejects.toThrow("did not become available");
  });

  it("preserves child exit codes and supports cancellation", async () => {
    const exited = await runCommand(
      process.execPath,
      ["-e", "process.exit(2)"],
      5_000,
    );
    expect(exited.exitCode).toBe(2);
    const cancellation = new AbortController();
    const pending = runCommand(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      5_000,
      cancellation.signal,
    );
    cancellation.abort();
    await expect(pending).rejects.toThrow("cancelled");
  });

  it("redacts URL credentials, query and fragment", () => {
    expect(redactUrl("https://u:p@example.test/a?token=x#y")).toBe(
      "https://example.test/a",
    );
  });

  it("renders verdict, delta, coverage, blockers and local command", () => {
    const summary = renderActionSummary(result);
    expect(summary).toContain("Walkdown: FAIL");
    expect(summary).toContain("New 1 · regressed 0 · persistent 1 · fixed 2");
    expect(summary).toContain("2/2 pages");
    expect(summary).toContain("runtime.page-error");
    expect(summary).toContain("npx walkdown@0.1.0 scan");
    expect(summary).not.toContain("secret");
  });

  it("identifies untrusted fork pull requests", () => {
    expect(
      isUntrustedFork({ pull_request: { head: { repo: { fork: true } } } }),
    ).toBe(true);
    expect(
      isUntrustedFork({ pull_request: { head: { repo: { fork: false } } } }),
    ).toBe(false);
  });

  it("keeps raw screenshots and traces private unless opted in", async () => {
    const root = await mkdtemp(join(tmpdir(), "walkdown-action-"));
    const run = join(root, "runs", "one");
    await mkdir(join(run, "screenshots"), { recursive: true });
    await writeFile(join(root, "results.json"), "{}");
    await writeFile(join(root, "results.sarif"), "{}");
    await writeFile(join(run, "report.md"), "report");
    await writeFile(join(run, "screenshots", "page.png"), "image");
    await writeFile(join(run, "trace.zip"), "trace");
    const safe = await selectArtifactFiles(root, run, {
      uploadEvidence: false,
      screenshots: false,
      trace: false,
    });
    expect(safe.some((path) => path.endsWith("page.png"))).toBe(false);
    expect(safe.some((path) => path.endsWith("trace.zip"))).toBe(false);
    const full = await selectArtifactFiles(root, run, {
      uploadEvidence: true,
      screenshots: true,
      trace: true,
    });
    expect(full.some((path) => path.endsWith("page.png"))).toBe(true);
    expect(full.some((path) => path.endsWith("trace.zip"))).toBe(true);
  });
});
