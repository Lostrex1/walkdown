#!/usr/bin/env node
import process from "node:process";
import {
  type ConfigOverrides,
  ExitCode,
  executeRun,
  loadConfig,
  normalizeTarget,
  RunStore,
  WalkdownError,
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
function outputFormat(value: string | undefined): "human" | "json" {
  if (value === undefined || value === "human" || value === "json") {
    return value ?? "human";
  }
  throw new WalkdownError(
    "INVALID_ARGUMENT",
    `Unsupported output format: ${value}`,
    "Use --format human or --format json.",
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
  const result = await executeRun(
    store,
    target,
    config,
    async () => "completed",
  );
  if (format === "json" || options.quiet)
    process.stdout.write(`${JSON.stringify(result.run)}\n`);
  else {
    process.stdout.write(
      `Walkdown run ${result.run.runId}: ${result.run.status}\nTarget: ${result.run.target}\nResult: ${store.relativePath(result.filePath)}\n`,
    );
  }
  process.exitCode =
    result.run.status === "cancelled" ? ExitCode.incomplete : ExitCode.success;
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
  .option("--format <format>", "Output format: human or json", "human")
  .option("-q, --quiet", "Emit machine-readable JSON only")
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
