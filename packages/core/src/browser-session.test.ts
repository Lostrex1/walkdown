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

describe("BrowserSession", () => {
  it("captures ordered runtime observations and reproducible evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "walkdown-browser-"));
    directories.push(directory);
    const target = await startFixture();
    const config = loadConfig({
      cwd: directory,
      cli: { outputDir: directory, browser: { settleMs: 250 } },
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
});
