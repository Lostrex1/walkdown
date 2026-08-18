export const SCHEMA_VERSION = 1;

export const ExitCode = {
  success: 0,
  findings: 1,
  incomplete: 2,
  invocation: 3,
  infrastructure: 4,
} as const;

export type RunStatus = "running" | "completed" | "cancelled" | "incomplete";

export interface Viewport {
  name: string;
  width: number;
  height: number;
}

export interface EffectiveConfig {
  schemaVersion: typeof SCHEMA_VERSION;
  outputDir: string;
  timeoutMs: number;
  maxPages: number;
  maxDepth: number;
  include: string[];
  exclude: string[];
  allowedOrigins: string[];
  viewports: Viewport[];
}

export interface Run {
  schemaVersion: typeof SCHEMA_VERSION;
  runId: string;
  target: string;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  version: string;
  config: EffectiveConfig;
}
