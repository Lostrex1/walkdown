import { mkdtemp, rm } from "node:fs/promises";
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

describe("behavior checks", () => {
  it("classifies effects, uncertainty, responsive geometry, keyboard, and modal focus", async () => {
    const directory = await mkdtemp(join(tmpdir(), "walkdown-behavior-"));
    directories.push(directory);
    const target = await startBehaviorFixture();
    const config = loadConfig({
      cwd: directory,
      cli: {
        outputDir: directory,
        maxDepth: 1,
        viewports: [
          { name: "desktop", width: 1000, height: 700 },
          { name: "mobile", width: 390, height: 700 },
        ],
        browser: { settleMs: 100 },
        exploration: { maxActions: 100, crawlTimeoutMs: 15_000 },
        checks: {
          interaction: {
            allowButtonClicks: true,
            effectTimeoutMs: 150,
            stabilityMs: 50,
            layoutSettleMs: 50,
            maxControlsPerPage: 40,
            keyboardMaxSteps: 50,
          },
        },
      },
    });

    const result = await runBrowserSession({
      target,
      runDirectory: directory,
      config,
      signal: new AbortController().signal,
    });

    expect(attempt(result, "Dead control")).toMatchObject({ outcome: "fail" });
    expect(attempt(result, "Polling no-op")).toMatchObject({
      outcome: "fail",
      effects: [],
    });
    expect(attempt(result, "Unstable")).toMatchObject({
      outcome: "inconclusive",
    });
    expect(attempt(result, "Covered control")).toMatchObject({
      outcome: "inconclusive",
    });

    expect(effectKinds(result, "DOM effect")).toContain("dom-mutation");
    expect(effectKinds(result, "Request effect")).toContain("request");
    expect(effectKinds(result, "Navigate effect")).toContain("navigation");
    expect(effectKinds(result, "Dialog effect")).toContain("dialog");
    expect(effectKinds(result, "Download effect")).toContain("download");
    expect(effectKinds(result, "Popup effect")).toContain("popup");
    expect(effectKinds(result, "Focus effect")).toContain("focus");
    expect(effectKinds(result, "Feedback effect")).toContain(
      "accessible-feedback",
    );

    const ruleIds = result.findings.findings.map((finding) => finding.ruleId);
    expect(ruleIds).toEqual(
      expect.arrayContaining([
        "interaction.dead-control",
        "interaction.pseudo-control",
        "responsive.horizontal-overflow",
        "interaction.obstructed-control",
        "accessibility.missing-name",
        "accessibility.keyboard-focus",
        "accessibility.modal-focus",
      ]),
    );
    const deadControlNames = result.findings.findings
      .filter((finding) => finding.ruleId === "interaction.dead-control")
      .flatMap((finding) => finding.samples)
      .map((sample) =>
        typeof sample.data.element === "object" && sample.data.element !== null
          ? (sample.data.element as { name?: string }).name
          : undefined,
      );
    expect(deadControlNames).not.toContain("Covered control");
    expect(deadControlNames.some((name) => name?.startsWith("Unstable"))).toBe(
      false,
    );
    expect(
      result.observations.some(
        (observation) =>
          observation.kind === "layout-check" &&
          observation.data.issue === "outside-viewport",
      ),
    ).toBe(true);
    expect(
      JSON.stringify(
        result.findings.findings.filter(
          (finding) => finding.ruleId === "responsive.horizontal-overflow",
        ),
      ),
    ).toContain("overflow");
    expect(
      JSON.stringify(
        result.findings.findings.filter(
          (finding) => finding.ruleId === "accessibility.missing-name",
        ),
      ),
    ).not.toContain("Settings");
    const layoutViewports = result.observations
      .filter((observation) => observation.kind === "layout-check")
      .map((observation) =>
        typeof observation.data.viewport === "object" &&
        observation.data.viewport !== null
          ? (observation.data.viewport as { name?: string }).name
          : undefined,
      );
    expect(layoutViewports).toContain("mobile");
    expect(
      result.findings.findings
        .filter((finding) => finding.ruleId === "accessibility.modal-focus")
        .some((finding) => JSON.stringify(finding).includes("Open bad modal")),
    ).toBe(true);
    expect(
      result.findings.findings
        .filter((finding) => finding.ruleId === "accessibility.modal-focus")
        .some((finding) => JSON.stringify(finding).includes("Open good modal")),
    ).toBe(false);
  }, 60_000);
});

function attempt(
  result: Awaited<ReturnType<typeof runBrowserSession>>,
  name: string,
) {
  return result.behavior.attempts.find((candidate) =>
    candidate.element.name.startsWith(name),
  );
}

function effectKinds(
  result: Awaited<ReturnType<typeof runBrowserSession>>,
  name: string,
): string[] {
  return attempt(result, name)?.effects.map((effect) => effect.kind) ?? [];
}

async function startBehaviorFixture(): Promise<string> {
  let unstableRequest = 0;
  const server = createServer((request, response) => {
    if (request.url === "/effect" || request.url === "/analytics") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.url === "/download") {
      response.writeHead(200, {
        "content-disposition": "attachment; filename=fixture.txt",
        "content-type": "text/plain",
      });
      response.end("fixture");
      return;
    }
    if (request.url === "/popup" || request.url === "/next") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        "<!doctype html><title>Effect target</title><main>done</main>",
      );
      return;
    }
    if (request.url === "/unstable") {
      unstableRequest += 1;
      response.writeHead(200, { "content-type": "text/html" });
      response.end(`<!doctype html><title>Unstable</title><main>
        <button type="button">Unstable ${unstableRequest}</button>
      </main>`);
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(fixtureHtml());
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Fixture did not bind to TCP");
  return `http://127.0.0.1:${address.port}/`;
}

function fixtureHtml(): string {
  return `<!doctype html>
  <title>Behavior fixture</title>
  <style>
    body { margin: 0; font-family: sans-serif; }
    main { padding: 16px; }
    button, a, input { margin: 4px; }
    #overflow { width: 900px; height: 4px; }
    #covered-wrap { position: relative; display: inline-block; }
    #cover { position: absolute; inset: 0; z-index: 2; background: rgba(0,0,0,.1); }
    #pseudo { cursor: pointer; display: inline-block; padding: 4px; }
    #outside { position: absolute; left: -600px; top: 20px; }
    #polling { animation: pulse 50ms infinite alternate; }
    @keyframes pulse { from { opacity: .95; } to { opacity: 1; } }
    #bad-modal { display: none; position: fixed; inset: 80px; background: white; z-index: 5; }
  </style>
  <main>
    <a href="/unstable">Unstable route</a>
    <button type="button" id="dead">Dead control</button>
    <button type="button" id="dom">DOM effect</button>
    <button type="button" id="request">Request effect</button>
    <button type="button" id="navigate">Navigate effect</button>
    <button type="button" id="dialog">Dialog effect</button>
    <button type="button" id="download">Download effect</button>
    <button type="button" id="popup">Popup effect</button>
    <button type="button" id="focus">Focus effect</button>
    <input id="focus-target" aria-label="Focus target">
    <button type="button" id="feedback">Feedback effect</button>
    <div role="status" id="status"></div>
    <button type="button" id="polling">Polling no-op</button>
    <div data-walkdown-dynamic id="clock"></div>
    <div id="pseudo" onclick="this.dataset.clicked='true'">Pseudo control</div>
    <button type="button" id="unnamed"><svg width="12" height="12"></svg></button>
    <button type="button" id="named-icon"><img alt="Settings" width="12" height="12"></button>
    <span id="covered-wrap"><button type="button" id="covered">Covered control</button><span id="cover"></span></span>
    <button type="button" id="outside">Outside control</button>
    <button type="button" id="trap">Keyboard trap</button>
    <button type="button" id="after-trap">After trap</button>
    <button type="button" id="open-good" aria-haspopup="dialog" aria-controls="good-modal">Open good modal</button>
    <dialog id="good-modal" aria-modal="true"><button type="button" id="good-close">Close good modal</button><button type="button">Secondary modal action</button></dialog>
    <button type="button" id="open-bad" aria-haspopup="dialog" aria-controls="bad-modal">Open bad modal</button>
    <div id="bad-modal" role="dialog" aria-modal="true"><button type="button">Bad modal action</button></div>
    <div id="overflow"></div>
  </main>
  <script>
    const byId = (id) => document.getElementById(id);
    byId('dom').addEventListener('click', () => document.body.append(document.createElement('section')));
    byId('request').addEventListener('click', () => fetch('/effect'));
    byId('navigate').addEventListener('click', () => location.href = '/next');
    byId('dialog').addEventListener('click', () => alert('effect'));
    byId('download').addEventListener('click', () => {
      const link = document.createElement('a'); link.href = '/download'; link.download = 'fixture.txt'; link.click();
    });
    byId('popup').addEventListener('click', () => window.open('/popup'));
    byId('focus').addEventListener('click', () => byId('focus-target').focus());
    byId('feedback').addEventListener('click', () => byId('status').textContent = 'Saved');
    setInterval(() => { byId('clock').textContent = new Date().toISOString(); fetch('/analytics'); }, 20);
    byId('trap').addEventListener('keydown', (event) => {
      if (event.key === 'Tab') { event.preventDefault(); byId('trap').focus(); }
    });
    const good = byId('good-modal'); const openGood = byId('open-good');
    openGood.addEventListener('click', () => { good.showModal(); byId('good-close').focus(); });
    good.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); good.close(); openGood.focus(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...good.querySelectorAll('button')];
      const index = controls.indexOf(document.activeElement);
      event.preventDefault(); controls[(index + 1) % controls.length].focus();
    });
    const bad = byId('bad-modal');
    byId('open-bad').addEventListener('click', () => { bad.style.display = 'block'; });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && bad.style.display === 'block') bad.style.display = 'none'; });
  </script>`;
}
