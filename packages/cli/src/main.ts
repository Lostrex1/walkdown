#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import {
  assembleRunResult,
  type Baseline,
  type BrowserSessionResult,
  type ConfigOverrides,
  compareWithBaseline,
  createBaseline,
  type EffectiveConfig,
  ExitCode,
  evaluateWalkdownVerification,
  executeRun,
  findLatestRunResult,
  loadConfig,
  normalizeTarget,
  type OutputFormat,
  type RunResult,
  RunStore,
  readBaseline,
  readRunResult,
  renderRunResult,
  runBrowserSession,
  type VerificationResult,
  WalkdownError,
  writeBaseline,
  writeDerivedReports,
  writeRunResult,
  writeVerificationResult,
} from "@walkdown/core";
import { Command } from "commander";

const VERSION = "0.1.0";
interface CommonOptions {
  config?: string;
  outputDir?: string;
  format?: string;
  quiet?: boolean;
  verbose?: boolean;
}
interface ScanOptions extends CommonOptions {
  timeoutMs?: string;
  maxPages?: string;
  printConfig?: boolean;
  baseline?: string;
  skipBaseline?: boolean;
}
interface BaselineOptions extends CommonOptions {
  from?: string;
  output?: string;
}
interface VerifyOptions extends CommonOptions {
  from?: string;
}
interface RegressionOptions extends CommonOptions {
  baseline?: string;
}

function optionInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new WalkdownError(
      "INVALID_ARGUMENT",
      `${name} must be a positive integer.`,
      `Pass a positive integer to ${name}.`,
    );
  return parsed;
}

function outputFormat(value: string | undefined): OutputFormat {
  const supported: OutputFormat[] = [
    "human",
    "json",
    "jsonl",
    "markdown",
    "sarif",
    "agent",
  ];
  if (value === undefined) return "human";
  if (supported.includes(value as OutputFormat)) return value as OutputFormat;
  throw new WalkdownError(
    "INVALID_ARGUMENT",
    `Unsupported output format: ${value}`,
    `Use one of: ${supported.join(", ")}.`,
  );
}

function simpleOutputFormat(value: string | undefined): "human" | "json" {
  if (value === undefined || value === "human" || value === "json")
    return value ?? "human";
  throw new WalkdownError(
    "INVALID_ARGUMENT",
    `Unsupported output format: ${value}`,
    "Use --format human or --format json for this command.",
  );
}

function loadCommandConfig(options: CommonOptions): EffectiveConfig {
  const cli: ConfigOverrides = { outputDir: options.outputDir };
  return loadConfig({ configPath: options.config, cli });
}

async function scan(targetInput: string, options: ScanOptions): Promise<void> {
  const config = loadConfig({
    configPath: options.config,
    cli: {
      outputDir: options.outputDir,
      timeoutMs: options.timeoutMs
        ? optionInteger(options.timeoutMs, "--timeout-ms")
        : undefined,
      maxPages: options.maxPages
        ? optionInteger(options.maxPages, "--max-pages")
        : undefined,
    },
  });
  const target = normalizeTarget(targetInput);
  if (options.printConfig) {
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    return;
  }
  const baselinePath = resolveBaselinePath(config, options.baseline);
  const baseline =
    options.skipBaseline || !existsSync(baselinePath)
      ? undefined
      : await readBaseline(baselinePath);
  const execution = await performScan(target, config, baseline);
  emitRunResult(execution.result, options);
}

async function baselineCommand(options: BaselineOptions): Promise<void> {
  const format = simpleOutputFormat(options.format);
  const config = loadCommandConfig(options);
  const selected = options.from
    ? {
        filePath: resolve(options.from),
        result: await readRunResult(resolve(options.from)),
      }
    : await findLatestRunResult(config.outputDir);
  const outputPath = resolveBaselinePath(config, options.output);
  const previous = existsSync(outputPath)
    ? await readBaseline(outputPath)
    : undefined;
  const baseline = createBaseline(selected.result, { previous });
  await writeBaseline(outputPath, baseline);
  const active = baseline.entries.filter(
    (entry) => entry.status === "active",
  ).length;
  const fixed = baseline.entries.length - active;
  if (options.quiet || format === "json")
    process.stdout.write(`${JSON.stringify(baseline)}\n`);
  else
    process.stdout.write(
      `Baseline written to ${outputPath}\nTarget: ${baseline.target}\nActive: ${active}; fixed history: ${fixed}; suppressions: ${baseline.suppressions.length}\n`,
    );
  process.exitCode = ExitCode.success;
}

async function verifyCommand(
  fingerprint: string,
  options: VerifyOptions,
): Promise<void> {
  simpleOutputFormat(options.format);
  const config = loadCommandConfig(options);
  const selected = options.from
    ? {
        filePath: resolve(options.from),
        result: await readRunResult(resolve(options.from)),
      }
    : await findLatestRunResult(config.outputDir, fingerprint);
  const sourceFinding = selected.result.findings.find(
    (finding) => finding.fingerprint === fingerprint,
  );
  if (!sourceFinding)
    throw new WalkdownError(
      "INVALID_ARGUMENT",
      `Result ${selected.filePath} does not contain ${fingerprint}.`,
      "Select a result containing the requested finding.",
    );
  const executor = sourceFinding.verification.executor ?? {
    provider: "walkdown",
    version: "legacy-v1",
  };
  const route = normalizeTarget(
    sourceFinding.verification.route ?? sourceFinding.route,
  );
  if (executor.provider !== "walkdown") {
    emitVerification(
      {
        schemaVersion: 1,
        fingerprint,
        outcome: "inconclusive",
        executor,
        sourceRunId: selected.result.run.runId,
        route,
        reason: `Verification executor ${executor.provider} is not installed.`,
        finding: sourceFinding,
      },
      options,
    );
    process.exitCode = ExitCode.incomplete;
    return;
  }
  const sourceConfig = selected.result.config.baseline
    ? selected.result.config
    : { ...selected.result.config, baseline: config.baseline };
  const focusedConfig: EffectiveConfig = {
    ...sourceConfig,
    outputDir: config.outputDir,
    maxPages: 2,
    maxDepth: 1,
    exploration: {
      ...sourceConfig.exploration,
      maxActions: Math.max(1, sourceConfig.exploration.maxActions),
    },
  };
  const execution = await performScan(route, focusedConfig);
  const verification = evaluateWalkdownVerification({
    sourceFinding,
    sourceRunId: selected.result.run.runId,
    verificationResult: execution.result,
    appGraph: execution.browser.appGraph,
    executor,
  });
  await writeVerificationResult(dirname(execution.filePath), verification);
  emitVerification(verification, options);
  process.exitCode =
    verification.outcome === "pass"
      ? ExitCode.success
      : verification.outcome === "fail"
        ? ExitCode.findings
        : ExitCode.incomplete;
}

async function regressionCommand(options: RegressionOptions): Promise<void> {
  const config = loadCommandConfig(options);
  const baselinePath = resolveBaselinePath(config, options.baseline);
  const baseline = await readBaseline(baselinePath);
  const execution = await performScan(baseline.target, config, baseline, {
    mode: "full",
    reason:
      "No trustworthy code-to-rule impact map is available; full scan used as the safe fallback.",
  });
  emitRunResult(execution.result, options);
}

async function performScan(
  target: string,
  config: EffectiveConfig,
  baseline?: Baseline,
  regression?: NonNullable<NonNullable<RunResult["comparison"]>["regression"]>,
): Promise<{
  result: RunResult;
  filePath: string;
  browser: BrowserSessionResult;
}> {
  const store = new RunStore(config.outputDir, VERSION);
  let browserResult: BrowserSessionResult | undefined;
  const execution = await executeRun(
    store,
    target,
    config,
    async ({ filePath, signal }) => {
      browserResult = await runBrowserSession({
        target,
        runDirectory: dirname(filePath),
        config,
        signal,
      });
      return "completed";
    },
  );
  if (!browserResult)
    throw new Error("Browser session completed without a result.");
  const assembled = assembleRunResult({
    run: execution.run,
    appGraph: browserResult.appGraph,
    findings: browserResult.findings.findings,
    evidence: browserResult.evidence,
    omissions: browserResult.omissions,
  });
  const result = baseline
    ? compareWithBaseline(assembled, baseline, {
        failOn: config.baseline.failOn,
        regression,
      })
    : assembled;
  await writeRunResult(dirname(execution.filePath), result);
  await writeDerivedReports(dirname(execution.filePath), result);
  return { result, filePath: execution.filePath, browser: browserResult };
}

function emitRunResult(result: RunResult, options: CommonOptions): void {
  const selectedFormat = options.quiet ? "json" : outputFormat(options.format);
  process.stdout.write(
    renderRunResult(result, selectedFormat, {
      color:
        selectedFormat === "human" &&
        process.stdout.isTTY === true &&
        process.env.NO_COLOR === undefined,
      verbose: options.verbose,
    }),
  );
  process.exitCode =
    result.summary.verdict === "pass"
      ? ExitCode.success
      : result.summary.verdict === "fail"
        ? ExitCode.findings
        : ExitCode.incomplete;
}

function emitVerification(
  result: VerificationResult,
  options: CommonOptions,
): void {
  if (options.quiet || simpleOutputFormat(options.format) === "json")
    process.stdout.write(`${JSON.stringify(result)}\n`);
  else
    process.stdout.write(
      `${result.outcome.toUpperCase()} — ${result.fingerprint}\nRoute: ${result.route}\n${result.reason}\n`,
    );
}

function resolveBaselinePath(
  config: EffectiveConfig,
  override?: string,
): string {
  const value = override ?? config.baseline.path;
  return isAbsolute(value) ? value : resolve(config.outputDir, value);
}

const program = new Command();
program
  .name("walkdown")
  .description("Local-first web behavior linter.")
  .version(VERSION);
program.configureOutput({
  writeErr: (message) => process.stderr.write(message),
});
program
  .command("scan <url>")
  .description("Scan a target and compare it with a baseline when present.")
  .option("-c, --config <path>", "Path to walkdown YAML configuration")
  .option("-o, --output-dir <path>", "Directory for local runs")
  .option("--timeout-ms <milliseconds>", "Per-operation timeout")
  .option("--max-pages <count>", "Exploration page budget")
  .option("--baseline <path>", "Baseline path relative to output-dir")
  .option("--skip-baseline", "Do not compare this scan with a baseline")
  .option(
    "--print-config",
    "Print the effective, redacted configuration and exit",
  )
  .option(
    "--format <format>",
    "Output format: human, json, jsonl, markdown, sarif, or agent",
    "human",
  )
  .option("-q, --quiet", "Emit machine-readable JSON only")
  .option("--verbose", "Include full finding detail in human-readable output")
  .action(async (url: string, options: ScanOptions) => scan(url, options));
program
  .command("baseline")
  .description("Create or explicitly update the reviewed baseline.")
  .option("-c, --config <path>", "Path to walkdown YAML configuration")
  .option("-o, --output-dir <path>", "Directory for local runs")
  .option("--from <path>", "Canonical result.json to accept")
  .option("--output <path>", "Baseline path relative to output-dir")
  .option("--format <format>", "Output format: human or json", "human")
  .option("-q, --quiet", "Emit baseline JSON only")
  .action(async (options: BaselineOptions) => baselineCommand(options));
program
  .command("verify <fingerprint>")
  .description("Re-observe the minimal context for one prior finding.")
  .option("-c, --config <path>", "Path to walkdown YAML configuration")
  .option("-o, --output-dir <path>", "Directory for verification runs")
  .option("--from <path>", "Canonical result.json containing the finding")
  .option("--format <format>", "Output format: human or json", "human")
  .option("-q, --quiet", "Emit verification JSON only")
  .action(async (fingerprint: string, options: VerifyOptions) =>
    verifyCommand(fingerprint, options),
  );
program
  .command("regression")
  .description("Run conservative regression checks against the baseline.")
  .option("-c, --config <path>", "Path to walkdown YAML configuration")
  .option("-o, --output-dir <path>", "Directory for local runs")
  .option("--baseline <path>", "Baseline path relative to output-dir")
  .option(
    "--format <format>",
    "Output format: human, json, jsonl, markdown, sarif, or agent",
    "human",
  )
  .option("-q, --quiet", "Emit machine-readable JSON only")
  .option("--verbose", "Include full finding detail in human-readable output")
  .action(async (options: RegressionOptions) => regressionCommand(options));

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof WalkdownError) {
    process.stderr.write(
      `${error.code}: ${error.message}\n${error.suggestion}\n`,
    );
    process.exitCode =
      error.code === "FILESYSTEM_ERROR"
        ? ExitCode.infrastructure
        : ExitCode.invocation;
  } else {
    process.stderr.write(
      `INFRASTRUCTURE_ERROR: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = ExitCode.infrastructure;
  }
}
