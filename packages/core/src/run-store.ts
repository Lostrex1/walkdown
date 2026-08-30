import { randomUUID } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { redactValue } from "./artifact-writer.js";
import type { EffectiveConfig, Run, RunStatus } from "./contracts.js";
import { SCHEMA_VERSION } from "./contracts.js";

export class RunStore {
  public constructor(
    private readonly outputDir: string,
    private readonly version: string,
  ) {}

  public async create(
    target: string,
    config: EffectiveConfig,
  ): Promise<{ run: Run; filePath: string }> {
    const runId = `${new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, "")
      .slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    const directory = join(this.outputDir, "runs", runId);
    const filePath = join(directory, "run.json");
    const run: Run = {
      schemaVersion: SCHEMA_VERSION,
      runId,
      target: redactValue(target),
      startedAt: new Date().toISOString(),
      status: "running",
      version: this.version,
      config: redactValue(config),
    };
    await mkdir(directory, { recursive: true });
    await this.writeAtomic(filePath, run);
    return { run, filePath };
  }

  public async finish(
    filePath: string,
    run: Run,
    status: Exclude<RunStatus, "running">,
  ): Promise<Run> {
    const finished: Run = {
      ...run,
      status,
      finishedAt: new Date().toISOString(),
    };
    await this.writeAtomic(filePath, finished);
    return finished;
  }

  public relativePath(filePath: string): string {
    return relative(this.outputDir, filePath);
  }

  private async writeAtomic(filePath: string, run: Run): Promise<void> {
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(run, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  }
}
