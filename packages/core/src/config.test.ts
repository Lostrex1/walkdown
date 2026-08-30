import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadConfig,
  normalizeTarget,
  redactText,
  redactValue,
  WalkdownError,
} from "./index.js";

describe("configuration", () => {
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((path) => rm(path, { recursive: true, force: true })),
    );
  });
  it("applies CLI values after environment values", () => {
    expect(
      loadConfig({
        cwd: ".",
        env: { WALKDOWN_TIMEOUT_MS: "1000" },
        cli: { timeoutMs: 2000 },
      }).timeoutMs,
    ).toBe(2000);
  });
  it("rejects unknown configuration keys", () => {
    expect(() =>
      loadConfig({ cwd: ".", cli: { unexpected: true } as never }),
    ).toThrow(WalkdownError);
  });
  it("loads rule defaults and validates rule-specific filters", () => {
    const config = loadConfig({ cwd: "." });
    expect(config.checks.rules["runtime.console-error"]).toMatchObject({
      enabled: true,
      severity: "warning",
      ignoreMessagePatterns: [],
    });
    expect(config.checks.interaction.allowButtonClicks).toBe(false);
    expect(config.browser.screenshot).toBe(false);
    expect(config.browser.trace).toBe(false);
    expect(config.baseline).toEqual({
      path: "baseline.json",
      failOn: ["error", "blocking"],
    });
    expect(config.viewports.map((viewport) => viewport.name)).toEqual([
      "desktop",
      "mobile",
    ]);
    expect(() =>
      loadConfig({
        cwd: ".",
        cli: {
          checks: {
            rules: {
              "navigation.placeholder-link": {
                ignoreMessagePatterns: ["not-valid-for-this-rule"],
              },
            },
          },
        } as never,
      }),
    ).toThrow("Invalid configuration");
  });
  it("loads the documented example configuration", () => {
    expect(
      loadConfig({
        cwd: process.cwd(),
        configPath: "walkdown.config.example.yaml",
      }).checks.rules["navigation.broken-internal-link"],
    ).toMatchObject({ enabled: true, severity: "error" });
  });
  it("rejects a configuration schema newer than the supported contract", () => {
    expect(() =>
      loadConfig({ cwd: ".", cli: { schemaVersion: 2 } as never }),
    ).toThrow("newer than supported version");
  });
  it("normalizes valid HTTP targets and removes fragments", () => {
    expect(normalizeTarget("https://example.com:443/path#section")).toBe(
      "https://example.com/path",
    );
  });
  it("rejects non-HTTP targets", () => {
    expect(() => normalizeTarget("file:///tmp/app")).toThrow(
      "Unsupported target protocol",
    );
  });
  it("rejects explicit missing config paths and credential-bearing targets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "walkdown-config-"));
    directories.push(directory);
    expect(() =>
      loadConfig({ cwd: directory, configPath: "missing.yaml" }),
    ).toThrow("does not exist");
    expect(() =>
      normalizeTarget("https://user:password@example.test/"),
    ).toThrow("embedded credentials");
  });
  it("redacts URL userinfo, bearer credentials, JWTs, cookies, and nested secret keys", () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature";
    const text = redactText(
      `https://user:password@example.test/?token=leak Authorization: Bearer ${token} cookie=session-value`,
    );
    expect(text).not.toContain("password");
    expect(text).not.toContain("leak");
    expect(text).not.toContain(token);
    expect(text).not.toContain("session-value");
    expect(
      redactValue({ Authorization: "secret", nested: { apiKey: "secret" } }),
    ).toEqual({
      Authorization: "[REDACTED]",
      nested: { apiKey: "[REDACTED]" },
    });
  });
});
