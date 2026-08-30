import { chmod, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type { EvidenceRef, Observation } from "./contracts.js";

const sensitiveKey =
  /(?:token|password|secret|api[_-]?key|access[_-]?key|authorization|cookie|session|credential)/i;
const sensitiveValue =
  /((?:token|password|secret|api[_-]?key|access[_-]?key|authorization|cookie|session)\s*[=:]\s*)[^\s,;]+/gi;
const bearerValue = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const jwtValue = /\beyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){2}\b/g;
const urlValue = /https?:\/\/[^\s"'<>]+/gi;

export function redactText(value: string): string {
  return value
    .replace(urlValue, redactUrl)
    .replace(bearerValue, "Bearer [REDACTED]")
    .replace(jwtValue, "[REDACTED]")
    .replace(sensitiveValue, "$1[REDACTED]");
}

/** Redact before any public or persisted JSON serialization. */
export function redactValue<T>(value: T): T {
  if (typeof value === "string") return redactText(value) as T;
  if (Array.isArray(value)) return value.map(redactValue) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        sensitiveKey.test(key) ? "[REDACTED]" : redactValue(nested),
      ]),
    ) as T;
  return value;
}

function redactUrl(candidate: string): string {
  try {
    const url = new URL(candidate);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()])
      if (sensitiveKey.test(key)) url.searchParams.set(key, "[REDACTED]");
    return url.toString();
  } catch {
    return candidate;
  }
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
    const redacted = redactText(value);
    const bytes = Buffer.byteLength(redacted);
    if (bytes > this.maxBytes) {
      this.omissions.push(`${name}: exceeded ${this.maxBytes} byte limit`);
      return;
    }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, redacted, { encoding: "utf8", mode: 0o600 });
    await chmod(path, 0o600).catch(() => undefined);
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
    await writeFile(path, value, { mode: 0o600 });
    await chmod(path, 0o600).catch(() => undefined);
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
      `${JSON.stringify(redactValue({ evidence: this.evidence, omissions: this.omissions, observationCount: observations.length }), null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await chmod(path, 0o600).catch(() => undefined);
  }

  private relativePath(path: string): string {
    return relative(this.runDirectory, path).replaceAll("\\", "/");
  }
}
