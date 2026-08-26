import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { gzipSync } from "node:zlib";
import { DefaultArtifactClient } from "@actions/artifact";
import * as core from "@actions/core";
import {
  type ActionResult,
  isUntrustedFork,
  redactUrl,
  renderActionSummary,
  runCommand,
  selectArtifactFiles,
  waitForHealth,
} from "./lib.js";

function integerInput(name: string, fallback: number): number {
  const raw = core.getInput(name).trim();
  const value = raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer.`);
  return value;
}

async function readEvent(): Promise<unknown> {
  if (!process.env.GITHUB_EVENT_PATH) return undefined;
  try {
    return JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  } catch {
    return undefined;
  }
}

async function uploadSarif(path: string, token: string): Promise<boolean> {
  const mode = core.getInput("upload-sarif").trim().toLowerCase() || "auto";
  if (mode === "false") return false;
  if (isUntrustedFork(await readEvent())) {
    core.warning("SARIF upload skipped for an untrusted fork pull request.");
    return false;
  }
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
  if (
    !token ||
    !owner ||
    !repo ||
    !process.env.GITHUB_SHA ||
    !process.env.GITHUB_REF
  ) {
    core.warning(
      "SARIF upload skipped because repository context or token is unavailable.",
    );
    return false;
  }
  try {
    const sarif = gzipSync(await readFile(path)).toString("base64");
    const response = await fetch(
      `${process.env.GITHUB_API_URL ?? "https://api.github.com"}/repos/${owner}/${repo}/code-scanning/sarifs`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          commit_sha: process.env.GITHUB_SHA,
          ref: process.env.GITHUB_REF,
          sarif,
          tool_name: "Walkdown",
          validate: true,
        }),
      },
    );
    if (!response.ok)
      throw new Error(`GitHub returned HTTP ${response.status}`);
    return true;
  } catch (error) {
    core.warning(
      `SARIF upload unavailable; results remain in the artifact. ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

function annotate(result: ActionResult): void {
  for (const finding of result.findings.slice(0, 50)) {
    const message = `${finding.ruleId} on ${redactUrl(finding.route)}: ${finding.message}`;
    if (finding.severity === "blocking" || finding.severity === "error")
      core.error(message, { title: `Walkdown ${finding.state} finding` });
    else if (finding.severity === "warning")
      core.warning(message, { title: `Walkdown ${finding.state} finding` });
    else core.notice(message, { title: `Walkdown ${finding.state} finding` });
  }
}

async function main(): Promise<void> {
  const cancellation = new AbortController();
  process.once("SIGINT", () => cancellation.abort());
  process.once("SIGTERM", () => cancellation.abort());
  const target = core.getInput("target", { required: true });
  const healthUrl = core.getInput("health-url").trim() || target;
  core.info(`Waiting for ${redactUrl(healthUrl)}`);
  try {
    await waitForHealth(healthUrl, {
      timeoutMs: integerInput("health-timeout-ms", 60_000),
      intervalMs: integerInput("health-interval-ms", 1_000),
    });
  } catch (error) {
    await core.summary
      .addHeading("Walkdown: target unavailable")
      .addCodeBlock(redactUrl(healthUrl))
      .addRaw(error instanceof Error ? error.message : String(error))
      .write();
    throw error;
  }

  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const outputDirectory = resolve(
    workspace,
    core.getInput("output-dir") || ".walkdown-ci",
  );
  await mkdir(outputDirectory, { recursive: true });
  const cliVersion = core.getInput("cli-version") || "0.1.0";
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  let cliPath: string;
  let npmPrefix: string;
  const commandTimeout = integerInput("command-timeout-ms", 300_000);
  if (cliVersion === "workspace") {
    cliPath = join(workspace, "packages", "cli", "dist", "main.js");
    npmPrefix = workspace;
  } else {
    npmPrefix = join(
      process.env.RUNNER_TEMP ?? outputDirectory,
      `walkdown-cli-${cliVersion}`,
    );
    await mkdir(npmPrefix, { recursive: true });
    const installed = await runCommand(
      npm,
      [
        "install",
        "--prefix",
        npmPrefix,
        "--no-audit",
        "--no-fund",
        "--ignore-scripts",
        `walkdown@${cliVersion}`,
      ],
      commandTimeout,
      cancellation.signal,
    );
    if (installed.exitCode !== 0)
      throw new Error(`CLI installation failed. ${installed.stderr}`);
    cliPath = join(npmPrefix, "node_modules", "walkdown", "dist", "main.js");
  }
  if (core.getBooleanInput("install-browser")) {
    const installed = await runCommand(
      npm,
      [
        "exec",
        "--prefix",
        npmPrefix,
        "--",
        "playwright",
        "install",
        "chromium",
      ],
      commandTimeout,
      cancellation.signal,
    );
    if (installed.exitCode !== 0)
      throw new Error(`Chromium installation failed. ${installed.stderr}`);
  }

  const args = [
    cliPath,
    "scan",
    target,
    "--output-dir",
    outputDirectory,
    "--timeout-ms",
    String(integerInput("timeout-ms", 30_000)),
    "--fail-on",
    core.getInput("fail-on") || "error,blocking",
    "--format",
    "json",
    "--quiet",
  ];
  const config = core.getInput("config").trim();
  const baseline = core.getInput("baseline").trim();
  if (config) args.push("--config", resolve(workspace, config));
  if (baseline) args.push("--baseline", resolve(workspace, baseline));
  if (!core.getBooleanInput("screenshots")) args.push("--disable-screenshots");
  if (!core.getBooleanInput("trace")) args.push("--disable-trace");
  const execution = await runCommand(
    process.execPath,
    args,
    commandTimeout,
    cancellation.signal,
  );
  if (!execution.stdout.trim())
    throw new Error(
      `Walkdown produced no canonical result. ${execution.stderr}`,
    );
  const result = JSON.parse(execution.stdout) as ActionResult;
  const runDirectory = join(outputDirectory, "runs", result.run.runId);
  const resultPath = join(outputDirectory, "results.json");
  const sarifPath = join(outputDirectory, "results.sarif");
  await copyFile(join(runDirectory, "result.json"), resultPath);
  await copyFile(join(runDirectory, "report.sarif"), sarifPath);

  core.setOutput("result-path", resultPath);
  core.setOutput("sarif-path", sarifPath);
  core.setOutput("verdict", result.summary.verdict);
  core.setOutput("run-id", result.run.runId);
  core.setOutput("status", result.run.status);
  annotate(result);
  await core.summary.addRaw(renderActionSummary(result)).write();

  const artifactName = core.getInput("artifact-name") || "walkdown-results";
  if (core.getBooleanInput("upload-artifact")) {
    const files = await selectArtifactFiles(outputDirectory, runDirectory, {
      uploadEvidence: core.getBooleanInput("upload-evidence"),
      screenshots: core.getBooleanInput("screenshots"),
      trace: core.getBooleanInput("trace"),
    });
    try {
      await new DefaultArtifactClient().uploadArtifact(
        artifactName,
        files,
        outputDirectory,
        { retentionDays: integerInput("artifact-retention-days", 7) },
      );
      core.setOutput("artifact-name", artifactName);
    } catch (error) {
      core.warning(
        `Artifact upload unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  core.setOutput(
    "sarif-uploaded",
    await uploadSarif(sarifPath, core.getInput("github-token")),
  );

  if (execution.exitCode !== 0) {
    const category =
      execution.exitCode <= 2
        ? "Walkdown findings"
        : "Walkdown execution error";
    core.setFailed(`${category} (CLI exit code ${execution.exitCode}).`);
  }
}

main().catch((error) =>
  core.setFailed(error instanceof Error ? error.message : String(error)),
);
