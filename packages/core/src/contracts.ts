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
  checks: ChecksConfig;
  baseline: BaselinePolicyConfig;
}

export interface BaselinePolicyConfig {
  path: string;
  failOn: Severity[];
}

export interface ExplorationConfig {
  maxActions: number;
  crawlTimeoutMs: number;
  maxQueryVariantsPerPath: number;
  allowExternalNavigation: boolean;
}

export interface BrowserConfig {
  trace: boolean;
  screenshot: boolean;
  settleMs: number;
  maxArtifactBytes: number;
  userAgent?: string;
}

export type Severity = "info" | "warning" | "error" | "blocking";

export const RULE_IDS = [
  "navigation.placeholder-link",
  "navigation.broken-internal-link",
  "runtime.page-error",
  "runtime.console-error",
  "runtime.failed-request",
  "interaction.dead-control",
  "interaction.pseudo-control",
  "responsive.horizontal-overflow",
  "interaction.obstructed-control",
  "accessibility.missing-name",
  "accessibility.keyboard-focus",
  "accessibility.modal-focus",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export interface RuleConfig {
  enabled: boolean;
  severity: Severity;
  ignoreMessagePatterns: string[];
  ignoreUrlPatterns: string[];
}

export interface ChecksConfig {
  placeholders: string[];
  rules: Record<RuleId, RuleConfig>;
  interaction: InteractionProbeConfig;
}

export interface InteractionProbeConfig {
  allowButtonClicks: boolean;
  effectTimeoutMs: number;
  stabilityMs: number;
  layoutSettleMs: number;
  maxControlsPerPage: number;
  keyboardMaxSteps: number;
  dynamicSelectors: string[];
  ignoreRequestPatterns: string[];
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
  | "popup"
  | "interaction-attempt"
  | "layout-check"
  | "accessibility-check";

export interface Observation {
  sequence: number;
  atMs: number;
  kind: ObservationKind;
  data: Record<string, unknown>;
}

export interface EvidenceRef {
  type:
    | "screenshot"
    | "trace"
    | "accessibility"
    | "observations"
    | "app-graph"
    | "findings";
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
  tagName?: string;
  clickHints?: Array<"handler" | "pointer">;
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
  /** Scheduling/result ledger. A safe control is never reported as skipped once probed. */
  outcome:
    | "queued"
    | "skipped"
    | "budget-exhausted"
    | "executed"
    | "inconclusive";
}

export interface RouteNode {
  url: string;
  depth: number;
  title: string;
  stateSignature: string;
  elements: ElementRef[];
  actions: CandidateAction[];
  navigationStatus?:
    | "visited"
    | "http-error"
    | "navigation-failed"
    | "timed-out"
    | "cancelled";
}

export interface CoverageSummary {
  status: "complete" | "incomplete";
  visitedPages: number;
  discoveredPages: number;
  pendingRoutes: string[];
  skippedActions: number;
  stopReasons: string[];
  skippedByPolicy?: number;
  budgetExhausted?: number;
  attemptedActions?: number;
  executedActions?: number;
  inconclusiveActions?: number;
}

export interface AppGraph {
  schemaVersion: typeof SCHEMA_VERSION;
  target: string;
  routes: RouteNode[];
  coverage: CoverageSummary;
}

export interface RuleMetadata {
  id: RuleId;
  title: string;
  description: string;
  defaultSeverity: Severity;
}

export interface RuleContext {
  target: string;
  observations: readonly Observation[];
  appGraph: AppGraph;
  config: ChecksConfig;
}

export interface FindingSample {
  sequence?: number;
  atMs?: number;
  data: Record<string, unknown>;
}

export interface FindingDraft {
  ruleId: RuleId;
  route: string;
  cause: string;
  message: string;
  sample: FindingSample;
}

export interface Rule {
  metadata: RuleMetadata;
  evaluate(context: RuleContext): FindingDraft[];
}

export interface Finding {
  id: string;
  fingerprint: string;
  ruleId: RuleId;
  severity: Severity;
  route: string;
  message: string;
  occurrenceCount: number;
  samples: FindingSample[];
}

export interface FindingsArtifact {
  schemaVersion: typeof SCHEMA_VERSION;
  target: string;
  findings: Finding[];
}

export type FindingState =
  | "new"
  | "persistent"
  | "regressed"
  | "fixed"
  | "ignored"
  | "inconclusive";

export type FindingConfidence = "low" | "medium" | "high";

export interface FindingSource {
  provider: string;
  providerVersion: string;
  nativeId: string;
  adapterVersion: string;
}

export interface PublishedEvidenceRef {
  type: EvidenceRef["type"] | "manifest" | "result";
  path: string;
  status: "available" | "omitted" | "truncated";
  bytes?: number;
  reason?: string;
}

export interface RepairContract {
  objective: string;
  constraints: string[];
  acceptanceCriteria: string[];
}

export interface VerificationRecipe {
  command: string;
  expectedOutcome: string;
  executor?: {
    provider: string;
    version: string;
  };
  route?: string;
  element?: Pick<ElementRef, "role" | "name" | "context">;
  action?: Pick<CandidateAction, "kind" | "risk">;
  assertion?: {
    type: "finding-absent";
    ruleId: string;
    fingerprint: string;
  };
}

export interface Suppression {
  fingerprint: string;
  ruleId: string;
  reason: string;
  author?: string;
  expiresAt?: string;
}

export interface BaselineEntry {
  fingerprint: string;
  fingerprintVersion: number;
  ruleId: string;
  ruleVersion: string;
  severity: Severity;
  route: string;
  source: FindingSource;
  status: "active" | "fixed";
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface Baseline {
  schemaVersion: typeof SCHEMA_VERSION;
  baselineVersion: 1;
  target: string;
  createdAt: string;
  updatedAt: string;
  sourceRunId: string;
  fingerprintVersion: number;
  ruleVersions: Record<string, string>;
  entries: BaselineEntry[];
  suppressions: Suppression[];
}

export interface FixedFindingRef {
  fingerprint: string;
  ruleId: string;
  severity: Severity;
  route: string;
  source: FindingSource;
}

export interface MigrationNotice {
  ruleId: string;
  baselineVersion: string;
  currentVersion: string;
  reason: string;
}

export interface ComparisonResult {
  baselineVersion: 1;
  sourceRunId: string;
  comparedAt: string;
  counts: Record<
    "new" | "persistent" | "fixed" | "regressed" | "ignored" | "inconclusive",
    number
  >;
  fixed: FixedFindingRef[];
  migrations: MigrationNotice[];
  expiredSuppressions: Suppression[];
  policy: {
    failOn: Severity[];
    failures: string[];
  };
  regression?: {
    mode: "focused" | "full";
    reason: string;
  };
}

export interface PublishedFinding {
  id: string;
  fingerprint: string;
  ruleId: string;
  source: FindingSource;
  state: FindingState;
  severity: Severity;
  confidence: FindingConfidence;
  route: string;
  element?: ElementRef;
  action?: CandidateAction;
  message: string;
  occurrenceCount: number;
  facts: string[];
  observations: FindingSample[];
  evidence: PublishedEvidenceRef[];
  inference: string;
  repair: RepairContract;
  expectedOutcome: string;
  verification: VerificationRecipe;
}

export type RunVerdict = "pass" | "fail" | "incomplete";

export interface RunSummary {
  verdict: RunVerdict;
  findingCount: number;
  blockers: number;
  bySeverity: Record<Severity, number>;
}

export interface RunResult {
  schemaVersion: typeof SCHEMA_VERSION;
  run: {
    runId: string;
    startedAt: string;
    finishedAt: string;
    status: Exclude<RunStatus, "running">;
    version: string;
  };
  target: string;
  config: EffectiveConfig;
  coverage: CoverageSummary;
  summary: RunSummary;
  findings: PublishedFinding[];
  evidence: PublishedEvidenceRef[];
  /** Every built-in rule evaluated by this run, including rules with zero findings. */
  ruleManifest?: Record<
    string,
    { version: string; enabled: boolean; outcome: "completed" | "skipped" }
  >;
  comparison?: ComparisonResult;
}

export type VerificationOutcome = "pass" | "fail" | "inconclusive";

export interface VerificationResult {
  schemaVersion: typeof SCHEMA_VERSION;
  fingerprint: string;
  outcome: VerificationOutcome;
  executor: { provider: string; version: string };
  sourceRunId: string;
  verificationRunId?: string;
  route: string;
  reason: string;
  finding?: PublishedFinding;
}

export type InteractionOutcome = "pass" | "fail" | "inconclusive";

export type ObservableEffectKind =
  | "navigation"
  | "dom-mutation"
  | "request"
  | "dialog"
  | "download"
  | "popup"
  | "focus"
  | "accessible-feedback";

export interface ObservableEffect {
  kind: ObservableEffectKind;
  detail?: string;
}

export interface PageStateDigest {
  url: string;
  domHash: string;
  focus: string;
  feedbackHash: string;
  dialogCount: number;
}

export interface InteractionAttempt {
  routeUrl: string;
  viewport: string;
  element: ElementRef;
  outcome: InteractionOutcome;
  effects: ObservableEffect[];
  before?: PageStateDigest;
  after?: PageStateDigest;
  reason: string;
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
