import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const directories: string[] = [];
const servers: ReturnType<typeof createServer>[] = [];
const cliPath = resolve("packages/cli/dist/main.js");

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
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
    expect(help.stdout).toContain("baseline");
    expect(help.stdout).toContain("verify");
    expect(help.stdout).toContain("regression");
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
    const runResult = JSON.parse(result.stdout);
    expect(runResult).toMatchObject({
      target: target.replace("#fragment", ""),
      schemaVersion: 1,
      run: { status: "completed" },
      summary: { verdict: "pass" },
    });
    const run = JSON.parse(
      await readFile(
        join(directory, "runs", runResult.run.runId, "run.json"),
        "utf8",
      ),
    );
    expect(run).toMatchObject(runResult.run);
    expect(
      JSON.parse(
        await readFile(
          join(directory, "runs", runResult.run.runId, "result.json"),
          "utf8",
        ),
      ),
    ).toEqual(runResult);
    await expect(
      readFile(
        join(directory, "runs", runResult.run.runId, "report.md"),
        "utf8",
      ),
    ).resolves.toContain("# Walkdown: PASS");
  }, 20_000);

  it("accepts persistent debt, verifies one finding, and runs regression", async () => {
    const directory = await mkdtemp(join(tmpdir(), "walkdown-cli-"));
    directories.push(directory);
    const server = createServer((request, response) => {
      if (request.url === "/error") {
        response.writeHead(503, { "content-type": "text/plain" });
        response.end("unavailable");
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        '<!doctype html><title>Baseline fixture</title><main>ready</main><script>fetch("/error")</script>',
      );
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Fixture did not bind to TCP");
    const target = `http://127.0.0.1:${address.port}/`;
    const first = await execAllowFailure([
      cliPath,
      "scan",
      target,
      "--output-dir",
      directory,
      "--format",
      "json",
    ]);
    expect(first.code).toBe(1);
    const firstResult = JSON.parse(first.stdout);
    const fingerprint = firstResult.findings.find(
      (finding: { ruleId: string }) =>
        finding.ruleId === "runtime.failed-request",
    )?.fingerprint;
    expect(fingerprint).toEqual(expect.any(String));

    const accepted = await execFile(process.execPath, [
      cliPath,
      "baseline",
      "--output-dir",
      directory,
      "--format",
      "json",
    ]);
    expect(JSON.parse(accepted.stdout)).toMatchObject({
      baselineVersion: 1,
      target,
    });

    const repeated = await execFile(
      process.execPath,
      [cliPath, "scan", target, "--output-dir", directory, "--format", "json"],
      { timeout: 20_000 },
    );
    const repeatedResult = JSON.parse(repeated.stdout);
    expect(repeatedResult.summary.verdict).toBe("pass");
    expect(
      repeatedResult.findings.find(
        (finding: { fingerprint: string }) =>
          finding.fingerprint === fingerprint,
      )?.state,
    ).toBe("persistent");

    const verification = await execAllowFailure([
      cliPath,
      "verify",
      fingerprint,
      "--output-dir",
      directory,
      "--format",
      "json",
    ]);
    expect(verification.code).toBe(1);
    expect(JSON.parse(verification.stdout)).toMatchObject({
      fingerprint,
      outcome: "fail",
      executor: { provider: "walkdown" },
    });

    const regression = await execFile(
      process.execPath,
      [cliPath, "regression", "--output-dir", directory, "--format", "json"],
      { timeout: 20_000 },
    );
    expect(JSON.parse(regression.stdout)).toMatchObject({
      summary: { verdict: "pass" },
      comparison: {
        regression: { mode: "full" },
        counts: { persistent: expect.any(Number) },
      },
    });
  }, 30_000);
});

async function execAllowFailure(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const result = await execFile(process.execPath, args, { timeout: 20_000 });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failed.code ?? -1,
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? "",
    };
  }
}
