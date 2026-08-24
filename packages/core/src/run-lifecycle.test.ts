import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeRun, loadConfig, RunStore } from "./index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("executeRun", () => {
  it("persists cancelled after SIGINT without leaving a partial run", async () => {
    const directory = await mkdtemp(join(tmpdir(), "walkdown-"));
    directories.push(directory);
    const store = new RunStore(directory, "test");
    const config = loadConfig({
      cwd: directory,
      cli: { outputDir: directory },
    });
    const signals = new EventEmitter();
    const result = await executeRun(
      store,
      "http://localhost:3000/",
      config,
      async ({ signal }) => {
        const aborted = new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve()),
        );
        signals.emit("SIGINT");
        await aborted;
        return "completed";
      },
      signals,
    );

    expect(result.run.status).toBe("cancelled");
    expect(JSON.parse(await readFile(result.filePath, "utf8"))).toMatchObject({
      status: "cancelled",
      finishedAt: expect.any(String),
    });
  });

  it("persists incomplete before rethrowing an operational failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "walkdown-"));
    directories.push(directory);
    const store = new RunStore(directory, "test");
    const config = loadConfig({
      cwd: directory,
      cli: { outputDir: directory },
    });

    await expect(
      executeRun(store, "http://localhost:3000/", config, async () => {
        throw new Error("operation failed");
      }),
    ).rejects.toThrow("operation failed");

    const runsDirectory = join(directory, "runs");
    const entries = await (await import("node:fs/promises")).readdir(
      runsDirectory,
    );
    const runDirectory = entries.at(0);
    expect(runDirectory).toBeDefined();
    const saved = JSON.parse(
      await readFile(
        join(runsDirectory, runDirectory ?? "", "run.json"),
        "utf8",
      ),
    );
    expect(saved.status).toBe("incomplete");
  });
});
