import { spawn } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";

export type Severity = "info" | "warning" | "error" | "blocking";

export interface ActionFinding {
  fingerprint: string;
  ruleId: string;
  state: string;
  severity: Severity;
  route: string;
  message: string;
}

export interface ActionResult {
  run: { runId: string; status: string; version: string };
  target: string;
  coverage: {
    status: string;
    visitedPages: number;
    discoveredPages: number;
    skippedActions: number;
    stopReasons: string[];
  };
  summary: {
    verdict: "pass" | "fail" | "incomplete";
    findingCount: number;
    blockers: number;
    bySeverity: Record<Severity, number>;
  };
  findings: ActionFinding[];
  comparison?: {
    counts: Record<string, number>;
    policy: { failures: string[] };
  };
  evidence: Array<{ type: string; path: string; status: string }>;
}

export interface HealthWaitOptions {
  timeoutMs: number;
  intervalMs: number;
  fetcher?: typeof fetch;
  now?: () => number;
  pause?: (milliseconds: number) => Promise<void>;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCommand(
  command: string,
  args: string[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, {
      cwd: process.env.GITHUB_WORKSPACE ?? process.cwd(),
      env: process.env,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const rejectAndStop = (error: Error) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(error);
    };
    const onAbort = () => rejectAndStop(new Error("Command cancelled."));
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(
      () => rejectAndStop(new Error(`Command exceeded ${timeoutMs} ms.`)),
      timeoutMs,
    );
    child.once("error", (error) => rejectAndStop(error));
    child.once("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      accept({ exitCode: code ?? 4, stdout, stderr });
    });
  });
}

export async function waitForHealth(
  url: string,
  options: HealthWaitOptions,
): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const pause =
    options.pause ??
    ((milliseconds) =>
      new Promise((accept) => setTimeout(accept, milliseconds)));
  const started = now();
  let lastFailure = "no response";
  while (now() - started <= options.timeoutMs) {
    try {
      const remaining = Math.max(1, options.timeoutMs - (now() - started));
      const response = await fetcher(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(remaining),
      });
      if (response.status >= 200 && response.status < 500) return;
      lastFailure = `HTTP ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
    await pause(options.intervalMs);
  }
  throw new Error(
    `Target did not become available within ${options.timeoutMs} ms (${lastFailure}).`,
  );
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid URL]";
  }
}

export function isUntrustedFork(event: unknown): boolean {
  if (!event || typeof event !== "object") return false;
  const pullRequest = (event as { pull_request?: unknown }).pull_request;
  if (!pullRequest || typeof pullRequest !== "object") return false;
  const head = (pullRequest as { head?: unknown }).head;
  if (!head || typeof head !== "object") return false;
  const repo = (head as { repo?: unknown }).repo;
  return Boolean(
    repo && typeof repo === "object" && (repo as { fork?: unknown }).fork,
  );
}

export function renderActionSummary(result: ActionResult): string {
  const comparison = result.comparison?.counts;
  const delta = comparison
    ? `New ${comparison.new ?? 0} · regressed ${comparison.regressed ?? 0} · persistent ${comparison.persistent ?? 0} · fixed ${comparison.fixed ?? 0}`
    : "No baseline comparison";
  const blockers = result.findings
    .filter(
      (finding) =>
        finding.severity === "blocking" || finding.severity === "error",
    )
    .slice(0, 10)
    .map(
      (finding) =>
        `- **${finding.severity}** \`${finding.ruleId}\` on \`${redactUrl(finding.route)}\`: ${finding.message}`,
    );
  return [
    `# Walkdown: ${result.summary.verdict.toUpperCase()}`,
    "",
    `Target: \`${redactUrl(result.target)}\``,
    `Run: \`${result.run.runId}\``,
    `Findings: ${result.summary.findingCount} (blocking ${result.summary.blockers}, error ${result.summary.bySeverity.error}, warning ${result.summary.bySeverity.warning})`,
    `Delta: ${delta}`,
    `Coverage: ${result.coverage.status}; ${result.coverage.visitedPages}/${result.coverage.discoveredPages} pages visited; ${result.coverage.skippedActions} unsafe or unknown actions skipped.`,
    "",
    "## Blocking evidence",
    "",
    ...(blockers.length > 0 ? blockers : ["No blocking or error findings."]),
    "",
    "## Reproduce locally",
    "",
    `\`npx walkdown@${result.run.version} scan ${redactUrl(result.target)} --format human\``,
    "",
  ].join("\n");
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    }),
  );
  return nested.flat();
}

export async function selectArtifactFiles(
  outputDirectory: string,
  runDirectory: string,
  options: { uploadEvidence: boolean; screenshots: boolean; trace: boolean },
): Promise<string[]> {
  const candidates = [
    join(outputDirectory, "results.json"),
    join(outputDirectory, "results.sarif"),
    join(runDirectory, "report.md"),
    join(runDirectory, "report.jsonl"),
  ];
  if (options.uploadEvidence) {
    for (const path of await listFiles(runDirectory)) {
      const normalized = path.replaceAll("\\", "/");
      if (!options.screenshots && /\/screenshots?\//i.test(normalized))
        continue;
      if (!options.trace && /(?:^|\/)trace\.zip$/i.test(normalized)) continue;
      candidates.push(path);
    }
  }
  const unique = [...new Set(candidates.map((path) => resolve(path)))];
  const existing: string[] = [];
  for (const path of unique) {
    try {
      if ((await stat(path)).isFile()) existing.push(path);
    } catch {
      // Optional derived artifacts may not exist after an incomplete scan.
    }
  }
  return existing;
}
