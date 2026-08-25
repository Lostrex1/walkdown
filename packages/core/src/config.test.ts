import { describe, expect, it } from "vitest";
import { loadConfig, normalizeTarget, WalkdownError } from "./index.js";

describe("configuration", () => {
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
});
