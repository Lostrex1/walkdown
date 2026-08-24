import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import {
  type BrowserConfig,
  type EffectiveConfig,
  SCHEMA_VERSION,
} from "./contracts.js";
import { WalkdownError } from "./errors.js";

const viewportSchema = z
  .object({
    name: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
const browserSchema = z
  .object({
    trace: z.boolean().default(true),
    settleMs: z.number().int().nonnegative().max(10_000).default(100),
    maxArtifactBytes: z
      .number()
      .int()
      .positive()
      .max(100_000_000)
      .default(10_000_000),
    userAgent: z.string().min(1).optional(),
  })
  .strict()
  .default({});

const configSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
    outputDir: z.string().min(1).default(".walkdown"),
    timeoutMs: z.number().int().positive().max(300_000).default(30_000),
    maxPages: z.number().int().positive().max(1_000).default(25),
    maxDepth: z.number().int().nonnegative().max(20).default(3),
    include: z.array(z.string().min(1)).default([]),
    exclude: z.array(z.string().min(1)).default([]),
    allowedOrigins: z.array(z.string().url()).default([]),
    viewports: z
      .array(viewportSchema)
      .min(1)
      .default([{ name: "desktop", width: 1440, height: 900 }]),
    browser: browserSchema,
  })
  .strict();

export type ConfigOverrides = Partial<
  Omit<EffectiveConfig, "schemaVersion" | "browser">
> & { browser?: Partial<BrowserConfig> };

function parseInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new WalkdownError(
      "INVALID_CONFIG",
      `${name} must be an integer.`,
      `Set ${name} to a positive integer.`,
    );
  }
  return parsed;
}

function readConfig(
  configPath: string | undefined,
  cwd: string,
): Record<string, unknown> {
  const candidate = configPath
    ? resolve(cwd, configPath)
    : resolve(cwd, "walkdown.config.yaml");
  if (!existsSync(candidate)) return {};
  try {
    const value: unknown = parse(readFileSync(candidate, "utf8"));
    if (value === null || value === undefined) return {};
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new WalkdownError(
        "INVALID_CONFIG",
        "Configuration root must be an object.",
        "Use a YAML mapping at the root of the config file.",
      );
    }
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof WalkdownError) throw error;
    throw new WalkdownError(
      "INVALID_CONFIG",
      `Cannot read configuration at ${candidate}.`,
      "Fix the YAML syntax and try again.",
      error,
    );
  }
}

export function loadConfig(
  options: {
    cwd?: string;
    configPath?: string;
    env?: NodeJS.ProcessEnv;
    cli?: ConfigOverrides;
  } = {},
): EffectiveConfig {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const fileConfig = readConfig(options.configPath, cwd);
  const envConfig: Record<string, unknown> = {};
  if (env.WALKDOWN_OUTPUT_DIR !== undefined)
    envConfig.outputDir = env.WALKDOWN_OUTPUT_DIR;
  const timeoutMs = parseInteger(
    env.WALKDOWN_TIMEOUT_MS,
    "WALKDOWN_TIMEOUT_MS",
  );
  if (timeoutMs !== undefined) envConfig.timeoutMs = timeoutMs;
  const maxPages = parseInteger(env.WALKDOWN_MAX_PAGES, "WALKDOWN_MAX_PAGES");
  if (maxPages !== undefined) envConfig.maxPages = maxPages;
  const cliConfig = Object.fromEntries(
    Object.entries(options.cli ?? {}).filter(
      ([, value]) => value !== undefined,
    ),
  );
  const candidate: Record<string, unknown> = {
    ...fileConfig,
    ...envConfig,
    ...cliConfig,
  };
  if (
    typeof candidate.schemaVersion === "number" &&
    candidate.schemaVersion > SCHEMA_VERSION
  ) {
    throw new WalkdownError(
      "UNSUPPORTED_SCHEMA_VERSION",
      `Configuration schemaVersion ${candidate.schemaVersion} is newer than supported version ${SCHEMA_VERSION}.`,
      "Upgrade Walkdown or use a compatible configuration.",
    );
  }
  const parsed = configSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new WalkdownError(
      "INVALID_CONFIG",
      `Invalid configuration: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      "Remove unknown keys and correct the reported values.",
    );
  }
  return parsed.data;
}

export function normalizeTarget(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new WalkdownError(
      "INVALID_ARGUMENT",
      `Invalid target URL: ${value}`,
      "Pass an absolute HTTP or HTTPS URL.",
      error,
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WalkdownError(
      "INVALID_ARGUMENT",
      `Unsupported target protocol: ${url.protocol}`,
      "Use an HTTP or HTTPS URL.",
    );
  }
  url.hash = "";
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  )
    url.port = "";
  return url.toString();
}
