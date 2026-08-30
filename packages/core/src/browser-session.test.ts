import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, runBrowserSession } from "./index.js";

const directories: string[] = [];
const servers: ReturnType<typeof createServer>[] = [];

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

async function startFixture(): Promise<string> {
  const server = createServer((request, response) => {
    if (request.url === "/download") {
      response.writeHead(200, {
        "content-disposition": "attachment; filename=fixture.txt",
        "content-type": "text/plain",
      });
      response.end("fixture");
      return;
    }
    if (request.url === "/popup") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        "<!doctype html><title>Popup fixture</title><main>popup</main>",
      );
      return;
    }
    if (request.url === "/missing") {
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("unavailable");
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><title>Runtime fixture</title><main>ready</main><script>
      console.error("token=should-not-persist");
      fetch("/missing");
      setTimeout(() => {
        alert("fixture dialog");
        window.open("/popup");
        const download = document.createElement("a");
        download.href = "/download";
        download.download = "fixture.txt";
        download.click();
        throw new Error("fixture error");
      }, 0);
    </script>`);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Fixture did not bind to TCP");
  return `http://127.0.0.1:${address.port}/`;
}

async function startExplorerFixture(): Promise<string> {
  const server = createServer((request, response) => {
    const title = request.url === "/safe" ? "Safe route" : "Explorer root";
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><title>${title}</title><main>
      <a href="/safe?utm_source=test#fragment">Safe route</a>
      <a href="https://example.com/external">External route</a>
      <a href="/admin/delete">Delete account</a>
      <a href="/download" download>Download export</a>
      <button>Publish project</button>
      <button type="button">Neutral control</button>
      <form><input name="email"><input type="file"><button type="submit">Send</button></form>
      ${request.url === "/safe" ? '<a href="/deep">Deep route</a>' : ""}
    </main>`);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Fixture did not bind to TCP");
  return `http://127.0.0.1:${address.port}/`;
}

async function startChecksFixture(): Promise<string> {
  const server = createServer((request, response) => {
    if (request.url === "/broken") {
      response.writeHead(503, { "content-type": "text/html" });
      response.end(
        "<!doctype html><title>Broken</title><main>unavailable</main>",
      );
      return;
    }
    if (request.url === "/api/error") {
      response.writeHead(503, { "content-type": "application/json" });
      response.end('{"error":"unavailable"}');
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<!doctype html><title>Checks fixture</title><main>
      <a>No target</a>
      <a href="">Empty</a>
      <a href="#">Hash</a>
      <a href="javascript:void(0)">No action</a>
      <a href="/broken">Broken route</a>
      <a href="mailto:hello@example.com">Email</a>
      <a href="tel:+34123456789">Call</a>
      <a href="/report.csv" download>Download</a>
    </main><script>
      console.error("fixture console error");
      fetch("/api/error");
      setTimeout(() => { throw new Error("fixture page error"); }, 0);
    </script>`);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Fixture did not bind to TCP");
  return `http://127.0.0.1:${address.port}/`;
}

describe("BrowserSession", () => {
  it("captures ordered runtime observations and reproducible evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "walkdown-browser-"));
    directories.push(directory);
    const target = await startFixture();
    const config = loadConfig({
      cwd: directory,
      cli: {
        outputDir: directory,
        browser: { settleMs: 250, screenshot: true, trace: true },
      },
    });
    const result = await runBrowserSession({
      target,
      runDirectory: directory,
      config,
      signal: new AbortController().signal,
    });
    expect(result.pageState).toMatchObject({
      url: target,
      title: "Runtime fixture",
    });
    expect(
      result.observations.map((observation) => observation.sequence),
    ).toEqual(result.observations.map((_observation, index) => index + 1));
    expect(result.observations.map((observation) => observation.kind)).toEqual(
      expect.arrayContaining([
        "navigation",
        "console",
        "page-error",
        "response",
        "dialog",
        "popup",
        "download",
      ]),
    );
    expect(JSON.stringify(result.observations)).not.toContain(
      "should-not-persist",
    );
    await expect(
      readFile(join(directory, "artifacts", "initial.png")),
    ).resolves.toBeInstanceOf(Buffer);
    await expect(
      readFile(join(directory, "artifacts", "trace.zip")),
    ).resolves.toBeInstanceOf(Buffer);
    const manifest = JSON.parse(
      await readFile(join(directory, "artifacts", "manifest.json"), "utf8"),
    );
    expect(manifest.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "screenshot",
          path: "artifacts/initial.png",
        }),
        expect.objectContaining({ type: "trace", path: "artifacts/trace.zip" }),
      ]),
    );
  }, 20_000);

  it("returns a typed navigation failure for an unavailable target", async () => {
    const directory = await mkdtemp(join(tmpdir(), "walkdown-browser-"));
    directories.push(directory);
    const config = loadConfig({
      cwd: directory,
      cli: { outputDir: directory, timeoutMs: 500 },
    });
    await expect(
      runBrowserSession({
        target: "http://127.0.0.1:1/",
        runDirectory: directory,
        config,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "NAVIGATION_FAILED" });
  }, 20_000);

  it("builds a deterministic graph without activating unsafe controls", async () => {
    const directory = await mkdtemp(join(tmpdir(), "walkdown-explorer-"));
    directories.push(directory);
    const target = await startExplorerFixture();
    const config = loadConfig({
      cwd: directory,
      cli: {
        outputDir: directory,
        maxDepth: 1,
        exploration: { maxActions: 20, crawlTimeoutMs: 10_000 },
      },
    });
    await runBrowserSession({
      target,
      runDirectory: directory,
      config,
      signal: new AbortController().signal,
    });
    const graph = JSON.parse(
      await readFile(join(directory, "artifacts", "app-graph.json"), "utf8"),
    );
    expect(graph.routes.map((route: { url: string }) => route.url)).toEqual([
      `${target}`,
      `${target}safe`,
    ]);
    const rootActions = graph.routes[0].actions;
    expect(rootActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          destination: `${target}safe`,
          risk: "safe",
          outcome: "queued",
        }),
        expect.objectContaining({ risk: "external", outcome: "skipped" }),
        expect.objectContaining({ risk: "destructive", outcome: "skipped" }),
        expect.objectContaining({
          element: expect.objectContaining({ name: "Neutral control" }),
          risk: "unknown",
          outcome: "skipped",
        }),
      ]),
    );
    expect(
      graph.routes.map((route: { url: string }) => route.url),
    ).not.toContain(`${target}admin/delete`);
    expect(graph.coverage).toMatchObject({
      status: "incomplete",
      stopReasons: expect.arrayContaining(["max-depth"]),
    });
    expect(rootActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "download", outcome: "skipped" }),
        expect.objectContaining({ kind: "upload", outcome: "skipped" }),
      ]),
    );
    const secondDirectory = await mkdtemp(join(tmpdir(), "walkdown-explorer-"));
    directories.push(secondDirectory);
    await runBrowserSession({
      target,
      runDirectory: secondDirectory,
      config,
      signal: new AbortController().signal,
    });
    const repeatedGraph = JSON.parse(
      await readFile(
        join(secondDirectory, "artifacts", "app-graph.json"),
        "utf8",
      ),
    );
    expect(repeatedGraph).toEqual(graph);
  }, 20_000);

  it("evaluates navigation and runtime checks from captured evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "walkdown-checks-"));
    directories.push(directory);
    const target = await startChecksFixture();
    const config = loadConfig({
      cwd: directory,
      cli: {
        outputDir: directory,
        browser: { settleMs: 200 },
        exploration: { maxActions: 20, crawlTimeoutMs: 10_000 },
      },
    });
    const result = await runBrowserSession({
      target,
      runDirectory: directory,
      config,
      signal: new AbortController().signal,
    });

    expect(result.findings.findings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining([
        "navigation.placeholder-link",
        "navigation.broken-internal-link",
        "runtime.page-error",
        "runtime.console-error",
        "runtime.failed-request",
      ]),
    );
    expect(JSON.stringify(result.findings)).not.toContain("mailto:");
    expect(JSON.stringify(result.findings)).not.toContain("tel:");
    expect(JSON.stringify(result.findings)).not.toContain("report.csv");
    const persisted = JSON.parse(
      await readFile(join(directory, "artifacts", "findings.json"), "utf8"),
    );
    expect(persisted).toEqual(result.findings);
    const manifest = JSON.parse(
      await readFile(join(directory, "artifacts", "manifest.json"), "utf8"),
    );
    expect(manifest.evidence).toContainEqual(
      expect.objectContaining({
        type: "findings",
        path: "artifacts/findings.json",
      }),
    );
  }, 20_000);
});
