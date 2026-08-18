import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, RunStore } from "./index.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
describe("RunStore", () => {
  it("persists an atomically finalized run", async () => {
    const directory = await mkdtemp(join(tmpdir(), "walkdown-"));
    directories.push(directory);
    const config = loadConfig({
      cwd: directory,
      cli: { outputDir: directory },
    });
    const store = new RunStore(directory, "test");
    const created = await store.create("http://localhost:3000/", config);
    const run = await store.finish(created.filePath, created.run, "completed");
    expect(JSON.parse(await readFile(created.filePath, "utf8"))).toMatchObject({
      runId: run.runId,
      status: "completed",
      schemaVersion: 1,
    });
  });
});
