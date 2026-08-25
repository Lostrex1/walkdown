#!/usr/bin/env node
import { dirname } from "node:path";
import process from "node:process";
import {
  assembleRunResult,
  type BrowserSessionResult,
  type ConfigOverrides,
  ExitCode,
  executeRun,
  loadConfig,
  normalizeTarget,
  type OutputFormat,
  RunStore,
  renderRunResult,
  runBrowserSession,
  WalkdownError,
  writeDerivedReports,
  writeRunResult,
} from "@walkdown/core";
import { Command } from "commander";

const VERSION = "0.1.0";
interface ScanOptions {
  config?: string;
  outputDir?: string;
  timeoutMs?: string;
  maxPages?: string;
  printConfig?: boolean;
  format?: string;
  quiet?: boolean;
  verbose?: boolean;
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
async function scan(targetInput: string, options: ScanOptions): Promise<void> {
  const cli: ConfigOverrides = {
    outputDir: options.outputDir,
    timeoutMs: options.timeoutMs
      ? optionInteger(options.timeoutMs, "--timeout-ms")
      : undefined,
    maxPages: options.maxPages
      ? optionInteger(options.maxPages, "--max-pages")
      : undefined,
  };
  const config = loadConfig({ configPath: options.config, cli });
  const target = normalizeTarget(targetInput);
  const format = outputFormat(options.format);
  if (options.printConfig) {
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    return;
  }
  const store = new RunStore(config.outputDir, VERSION);
  let browserResult: BrowserSessionResult | undefined;
  const result = await executeRun(
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
  const runResult = assembleRunResult({
    run: result.run,
    appGraph: browserResult.appGraph,
    findings: browserResult.findings.findings,
    evidence: browserResult.evidence,
    omissions: browserResult.omissions,
  });
  await writeRunResult(dirname(result.filePath), runResult);
  await writeDerivedReports(dirname(result.filePath), runResult);
  const selectedFormat = options.quiet ? "json" : format;
  process.stdout.write(
    renderRunResult(runResult, selectedFormat, {
      color:
        selectedFormat === "human" &&
        process.stdout.isTTY === true &&
        process.env.NO_COLOR === undefined,
      verbose: options.verbose,
    }),
  );
  process.exitCode =
    runResult.summary.verdict === "pass"
      ? ExitCode.success
      : runResult.summary.verdict === "fail"
        ? ExitCode.findings
        : ExitCode.incomplete;
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
  .description("Prepare a local run for a target URL.")
  .option("-c, --config <path>", "Path to walkdown YAML configuration")
  .option("-o, --output-dir <path>", "Directory for local runs")
  .option("--timeout-ms <milliseconds>", "Per-operation timeout")
  .option("--max-pages <count>", "Exploration page budget")
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
