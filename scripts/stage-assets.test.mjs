import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("stage-assets copies only the files the page loads", () => {
  execFileSync("sh", ["scripts/stage-assets.sh"], { cwd: root });
  assert.deepEqual(walk(path.join(root, "dist/assets")), [
    "app.js",
    "index.html",
    "normalize-url.mjs",
    "relay-client.mjs",
    "style.css",
    "worker/index.mjs",
  ]);
});

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      for (const child of walk(full)) out.push(path.posix.join(name, child));
    } else {
      out.push(name);
    }
  }
  return out.sort();
}
