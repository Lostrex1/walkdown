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
  browser: BrowserConfig;
  exploration: ExplorationConfig;
}

export interface ExplorationConfig {
  maxActions: number;
  crawlTimeoutMs: number;
  maxQueryVariantsPerPath: number;
  allowExternalNavigation: boolean;
}

export interface BrowserConfig {
  trace: boolean;
  settleMs: number;
  maxArtifactBytes: number;
  userAgent?: string;
}

export type ObservationKind =
  | "navigation"
  | "url-change"
  | "console"
  | "page-error"
  | "request-failed"
  | "response"
  | "dialog"
  | "download"
  | "popup";

export interface Observation {
  sequence: number;
  atMs: number;
  kind: ObservationKind;
  data: Record<string, unknown>;
}

export interface EvidenceRef {
  type: "screenshot" | "trace" | "accessibility" | "observations" | "app-graph";
  path: string;
  bytes: number;
  truncated: boolean;
}

export interface PageState {
  url: string;
  title: string;
  accessibilityPath?: string;
}

export type ActionRisk =
  | "safe"
  | "reversible"
  | "side-effect"
  | "destructive"
  | "external"
  | "unknown";

export interface ElementRef {
  id: string;
  role: string;
  name: string;
  text?: string;
  attributes: Record<string, string>;
  context: string;
  visible: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
}

export interface CandidateAction {
  id: string;
  routeUrl: string;
  element: ElementRef;
  kind:
    | "navigate"
    | "click"
    | "submit"
    | "input"
    | "select"
    | "upload"
    | "download"
    | "unknown";
  risk: ActionRisk;
  reason: string;
  destination?: string;
  outcome: "queued" | "skipped" | "budget-exhausted";
}

export interface RouteNode {
  url: string;
  depth: number;
  title: string;
  stateSignature: string;
  elements: ElementRef[];
  actions: CandidateAction[];
}

export interface CoverageSummary {
  status: "complete" | "incomplete";
  visitedPages: number;
  discoveredPages: number;
  pendingRoutes: string[];
  skippedActions: number;
  stopReasons: string[];
}

export interface AppGraph {
  schemaVersion: typeof SCHEMA_VERSION;
  target: string;
  routes: RouteNode[];
  coverage: CoverageSummary;
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
