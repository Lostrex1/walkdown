import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const ncc = resolve("node_modules/@vercel/ncc/dist/ncc/cli.js");
const result = spawnSync(
  process.execPath,
  [
    ncc,
    "build",
    "packages/action/src/index.ts",
    "-o",
    "packages/action/dist",
    "--minify",
    "--license",
    "licenses.txt",
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);

const licenses = resolve("packages/action/dist/licenses.txt");
const normalized = readFileSync(licenses, "utf8")
  .replace(/[ \t]+$/gm, "")
  .replace(/\r\n/g, "\n");
writeFileSync(licenses, normalized, "utf8");
