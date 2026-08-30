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
    run: {
        runId: string;
        status: string;
        version: string;
    };
    target: string;
    coverage: {
        status: string;
        visitedPages: number;
        discoveredPages: number;
        skippedActions: number;
        stopReasons: string[];
        skippedByPolicy?: number;
        budgetExhausted?: number;
        attemptedActions?: number;
        executedActions?: number;
        inconclusiveActions?: number;
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
        policy: {
            failures: string[];
        };
    };
    evidence: Array<{
        type: string;
        path: string;
        status: string;
    }>;
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
export declare function runCommand(command: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<ProcessResult>;
export declare function waitForHealth(url: string, options: HealthWaitOptions): Promise<void>;
export declare function redactUrl(value: string): string;
export declare function isUntrustedFork(event: unknown): boolean;
export declare function renderActionSummary(result: ActionResult): string;
export declare function selectArtifactFiles(outputDirectory: string, runDirectory: string, options: {
    uploadEvidence: boolean;
    screenshots: boolean;
    trace: boolean;
}): Promise<string[]>;
