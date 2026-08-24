import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const directories: string[] = [];
const cliPath = resolve("packages/cli/dist/main.js");

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("walkdown CLI", () => {
  it("exposes help and version", async () => {
    const help = await execFile(process.execPath, [cliPath, "--help"]);
    const version = await execFile(process.execPath, [cliPath, "--version"]);
    expect(help.stdout).toContain("scan [options] <url>");
    expect(version.stdout.trim()).toBe("0.1.0");
  });

  it("uses config-file, environment, and CLI precedence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "walkdown-cli-"));
    directories.push(directory);
    const configPath = join(directory, "walkdown.config.yaml");
    await writeFile(configPath, "timeoutMs: 1000\nmaxPages: 3\n", "utf8");
    const result = await execFile(
      process.execPath,
      [
        cliPath,
        "scan",
        "https://example.com/#fragment",
        "--config",
        configPath,
        "--timeout-ms",
        "3000",
        "--print-config",
      ],
      { env: { ...process.env, WALKDOWN_TIMEOUT_MS: "2000" } },
    );
    expect(JSON.parse(result.stdout)).toMatchObject({
      timeoutMs: 3000,
      maxPages: 3,
    });
  });

  it("reports invalid URLs with the stable invocation exit code", async () => {
    await expect(
      execFile(process.execPath, [cliPath, "scan", "file:///tmp/app"]),
    ).rejects.toMatchObject({
      code: 3,
      stderr: expect.stringContaining("INVALID_ARGUMENT"),
    });
  });

  it("writes a normalized, completed run in machine-readable mode", async () => {
    const directory = await mkdtemp(join(tmpdir(), "walkdown-cli-"));
    directories.push(directory);
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<title>Walkdown fixture</title><main>ready</main>");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Fixture did not bind to TCP");
    const target = `http://127.0.0.1:${address.port}/path#fragment`;
    const result = await execFile(
      process.execPath,
      [cliPath, "scan", target, "--output-dir", directory, "--format", "json"],
      { timeout: 20_000 },
    );
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    const run = JSON.parse(result.stdout);
    expect(run).toMatchObject({
      target: target.replace("#fragment", ""),
      status: "completed",
      schemaVersion: 1,
    });
    expect(
      JSON.parse(
        await readFile(join(directory, "runs", run.runId, "run.json"), "utf8"),
      ),
    ).toMatchObject(run);
  });
});
