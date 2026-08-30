import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import {
  type BaselinePolicyConfig,
  type BrowserConfig,
  type ChecksConfig,
  type EffectiveConfig,
  type ExplorationConfig,
  type InteractionProbeConfig,
  RULE_IDS,
  type RuleConfig,
  type RuleId,
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
    // Binary captures cannot be safely redacted. They are an explicit opt-in.
    trace: z.boolean().default(false),
    screenshot: z.boolean().default(false),
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
const explorationSchema = z
  .object({
    maxActions: z.number().int().nonnegative().max(10_000).default(100),
    crawlTimeoutMs: z.number().int().positive().max(600_000).default(60_000),
    maxQueryVariantsPerPath: z.number().int().positive().max(100).default(3),
    allowExternalNavigation: z.boolean().default(false),
  })
  .strict()
  .default({});

const severitySchema = z.enum(["info", "warning", "error", "blocking"]);
const baseRuleSchema = {
  enabled: z.boolean().default(true),
  severity: severitySchema,
};
const placeholderRuleSchema = z
  .object({
    ...baseRuleSchema,
    severity: severitySchema.default("warning"),
  })
  .strict()
  .default({});
const brokenLinkRuleSchema = z
  .object({
    ...baseRuleSchema,
    severity: severitySchema.default("error"),
    ignoreUrlPatterns: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .default({});
const pageErrorRuleSchema = z
  .object({
    ...baseRuleSchema,
    severity: severitySchema.default("error"),
    ignoreMessagePatterns: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .default({});
const consoleErrorRuleSchema = z
  .object({
    ...baseRuleSchema,
    severity: severitySchema.default("warning"),
    ignoreMessagePatterns: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .default({});
const failedRequestRuleSchema = z
  .object({
    ...baseRuleSchema,
    severity: severitySchema.default("error"),
    ignoreMessagePatterns: z.array(z.string().min(1)).default([]),
    ignoreUrlPatterns: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .default({});
const deadControlRuleSchema = z
  .object({
    ...baseRuleSchema,
    severity: severitySchema.default("error"),
  })
  .strict()
  .default({});
const warningRuleSchema = z
  .object({
    ...baseRuleSchema,
    severity: severitySchema.default("warning"),
  })
  .strict()
  .default({});
const errorRuleSchema = z
  .object({
    ...baseRuleSchema,
    severity: severitySchema.default("error"),
  })
  .strict()
  .default({});
const interactionProbeSchema = z
  .object({
    allowButtonClicks: z.boolean().default(false),
    effectTimeoutMs: z.number().int().positive().max(10_000).default(500),
    stabilityMs: z.number().int().nonnegative().max(5_000).default(100),
    layoutSettleMs: z.number().int().nonnegative().max(10_000).default(100),
    maxControlsPerPage: z.number().int().nonnegative().max(1_000).default(20),
    keyboardMaxSteps: z.number().int().positive().max(1_000).default(50),
    dynamicSelectors: z
      .array(z.string().min(1))
      .default(["[data-walkdown-dynamic]", "[data-walkdown-volatile]"]),
    ignoreRequestPatterns: z
      .array(z.string().min(1))
      .default([
        "*/analytics*",
        "*/collect*",
        "*google-analytics.com*",
        "*/poll*",
        "*/heartbeat*",
      ]),
  })
  .strict()
  .default({});
const checksSchema = z
  .object({
    placeholders: z
      .array(z.string())
      .default(["", "#", "javascript:void(0)", "javascript:;"]),
    rules: z
      .object({
        [RULE_IDS[0]]: placeholderRuleSchema,
        [RULE_IDS[1]]: brokenLinkRuleSchema,
        [RULE_IDS[2]]: pageErrorRuleSchema,
        [RULE_IDS[3]]: consoleErrorRuleSchema,
        [RULE_IDS[4]]: failedRequestRuleSchema,
        [RULE_IDS[5]]: deadControlRuleSchema,
        [RULE_IDS[6]]: warningRuleSchema,
        [RULE_IDS[7]]: errorRuleSchema,
        [RULE_IDS[8]]: errorRuleSchema,
        [RULE_IDS[9]]: warningRuleSchema,
        [RULE_IDS[10]]: warningRuleSchema,
        [RULE_IDS[11]]: errorRuleSchema,
      })
      .strict()
      .default({}),
    interaction: interactionProbeSchema,
  })
  .strict()
  .default({})
  .transform(
    (checks): ChecksConfig => ({
      placeholders: checks.placeholders,
      interaction: checks.interaction,
      rules: Object.fromEntries(
        RULE_IDS.map((id) => [
          id,
          {
            enabled: checks.rules[id].enabled,
            severity: checks.rules[id].severity,
            ignoreMessagePatterns:
              "ignoreMessagePatterns" in checks.rules[id]
                ? checks.rules[id].ignoreMessagePatterns
                : [],
            ignoreUrlPatterns:
              "ignoreUrlPatterns" in checks.rules[id]
                ? checks.rules[id].ignoreUrlPatterns
                : [],
          },
        ]),
      ) as Record<
        (typeof RULE_IDS)[number],
        ChecksConfig["rules"][(typeof RULE_IDS)[number]]
      >,
    }),
  );

const baselineSchema = z
  .object({
    path: z.string().min(1).default("baseline.json"),
    failOn: z.array(severitySchema).min(1).default(["error", "blocking"]),
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
      .default([
        { name: "desktop", width: 1440, height: 900 },
        { name: "mobile", width: 390, height: 844 },
      ]),
    browser: browserSchema,
    exploration: explorationSchema,
    checks: checksSchema,
    baseline: baselineSchema,
  })
  .strict();

export type ConfigOverrides = Partial<
  Omit<EffectiveConfig, "schemaVersion" | "browser" | "exploration" | "checks">
> & {
  browser?: Partial<BrowserConfig>;
  exploration?: Partial<ExplorationConfig>;
  checks?: {
    placeholders?: string[];
    rules?: { [Id in RuleId]?: Partial<RuleConfig> };
    interaction?: Partial<InteractionProbeConfig>;
  };
  baseline?: Partial<BaselinePolicyConfig>;
};

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
  if (!existsSync(candidate)) {
    if (configPath)
      throw new WalkdownError(
        "INVALID_CONFIG",
        `Configuration file does not exist: ${candidate}.`,
        "Correct --config or omit it to use the default configuration.",
      );
    return {};
  }
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

/** Validates the fully expanded config embedded in a public RunResult. */
export function validateEffectiveConfigSnapshot(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new WalkdownError(
      "INVALID_CONFIG",
      "Effective configuration must be an object.",
      "Use a complete configuration generated by Walkdown.",
    );
  const candidate = structuredClone(value) as Record<string, unknown>;
  const checks = candidate.checks as Record<string, unknown> | undefined;
  const rules = checks?.rules as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (
    !rules ||
    Object.keys(rules).length !== RULE_IDS.length ||
    RULE_IDS.some((id) => !(id in rules))
  )
    throw new WalkdownError(
      "INVALID_CONFIG",
      "Effective configuration has an incomplete rule set.",
      "Use a complete configuration generated by Walkdown.",
    );
  const messageRules = new Set<RuleId>([
    "runtime.page-error",
    "runtime.console-error",
    "runtime.failed-request",
  ]);
  const urlRules = new Set<RuleId>([
    "navigation.broken-internal-link",
    "runtime.failed-request",
  ]);
  for (const ruleId of RULE_IDS) {
    const rule = rules[ruleId];
    if (!rule) continue;
    if (!messageRules.has(ruleId)) delete rule.ignoreMessagePatterns;
    if (!urlRules.has(ruleId)) delete rule.ignoreUrlPatterns;
  }
  const parsed = configSchema.safeParse(candidate);
  if (!parsed.success)
    throw new WalkdownError(
      "INVALID_CONFIG",
      `Invalid effective configuration: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
      "Use a complete configuration generated by Walkdown.",
    );
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
  if (url.username || url.password)
    throw new WalkdownError(
      "INVALID_ARGUMENT",
      "Target URLs with embedded credentials are not accepted.",
      "Use a credential-free URL and configure authentication outside the target URL.",
    );
  url.hash = "";
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  )
    url.port = "";
  return url.toString();
}
