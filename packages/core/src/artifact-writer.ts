import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { EvidenceRef, Observation } from "./contracts.js";

const sensitiveValue =
  /((?:token|password|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi;

export function redactText(value: string): string {
  return value.replace(sensitiveValue, "$1[REDACTED]");
}

export class ArtifactWriter {
  public readonly evidence: EvidenceRef[] = [];
  public readonly omissions: string[] = [];

  public constructor(
    private readonly runDirectory: string,
    private readonly maxBytes: number,
  ) {}

  public artifactPath(name: string): string {
    return join(this.runDirectory, "artifacts", name);
  }

  public async ensureDirectory(): Promise<void> {
    await mkdir(dirname(this.artifactPath("placeholder")), { recursive: true });
  }

  public async writeJson(
    name: string,
    type: EvidenceRef["type"],
    value: unknown,
  ): Promise<void> {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    await this.writeText(name, type, redactText(text));
  }

  public async writeText(
    name: string,
    type: EvidenceRef["type"],
    value: string,
  ): Promise<void> {
    const path = this.artifactPath(name);
    const bytes = Buffer.byteLength(value);
    if (bytes > this.maxBytes) {
      this.omissions.push(`${name}: exceeded ${this.maxBytes} byte limit`);
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, value, "utf8");
    this.evidence.push({
      type,
      path: this.relativePath(path),
      bytes,
      truncated: false,
    });
  }

  public async writeBuffer(
    name: string,
    type: EvidenceRef["type"],
    value: Buffer,
  ): Promise<void> {
    const path = this.artifactPath(name);
    if (value.byteLength > this.maxBytes) {
      this.omissions.push(`${name}: exceeded ${this.maxBytes} byte limit`);
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, value);
    this.evidence.push({
      type,
      path: this.relativePath(path),
      bytes: value.byteLength,
      truncated: false,
    });
  }

  public async registerFile(
    name: string,
    type: EvidenceRef["type"],
  ): Promise<void> {
    const path = this.artifactPath(name);
    const details = await stat(path);
    if (details.size > this.maxBytes) {
      await unlink(path);
      this.omissions.push(`${name}: exceeded ${this.maxBytes} byte limit`);
      return;
    }
    this.evidence.push({
      type,
      path: this.relativePath(path),
      bytes: details.size,
      truncated: false,
    });
  }

  public async writeManifest(observations: Observation[]): Promise<void> {
    const path = this.artifactPath("manifest.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      `${JSON.stringify({ evidence: this.evidence, omissions: this.omissions, observationCount: observations.length }, null, 2)}\n`,
      "utf8",
    );
  }

  private relativePath(path: string): string {
    return relative(this.runDirectory, path).replaceAll("\\", "/");
  }
}
