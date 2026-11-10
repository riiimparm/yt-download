import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "app.js",
  "checkpoints.mjs",
  "convert-plan.mjs",
  "index.html",
  "normalize-url.mjs",
  "relay-client.mjs",
  "style.css",
  "worker/index.mjs",
];

test("stage-assets copies only the files the page loads", async (t) => {
  const vendor = path.join(root, "vendor/ffmpeg");
  const backup = mkdtempSync(path.join(tmpdir(), "ffmpeg-vendor-"));
  const hadVendor = existsSync(vendor);
  if (hadVendor) cpSync(vendor, path.join(backup, "ffmpeg"), { recursive: true });

  try {
    await t.test("the page files are staged and nothing else is", () => {
      rmSync(vendor, { recursive: true, force: true });
      execFileSync("sh", ["scripts/stage-assets.sh"], { cwd: root });
      const files = walk(path.join(root, "dist/assets"));
      for (const name of required) assert.ok(files.includes(name), name);
      for (const name of files) {
        assert.ok(required.includes(name) || name.startsWith("vendor/"), name);
      }
      assertNoSharedBody(path.join(root, "dist/assets"));
    });

    await t.test("a declaration with the same bytes is not published", () => {
      mkdirSync(vendor, { recursive: true });
      const same = 'export * from "./classes.js";\nexport * from "./types.js";\n';
      writeFileSync(path.join(vendor, "index.js"), same);
      writeFileSync(path.join(vendor, "index.d.ts"), same);
      writeFileSync(path.join(vendor, "index.js.map"), same);
      writeFileSync(path.join(vendor, "worker.js"), "export {}\n");
      execFileSync("sh", ["scripts/stage-assets.sh"], { cwd: root });
      const staged = path.join(root, "dist/assets/vendor/ffmpeg");
      const names = readdirSync(staged).sort();
      assert.deepEqual(names, ["index.js", "worker.js"]);
      assert.equal(readFileSync(path.join(staged, "index.js"), "utf8"), same);
      const published = walk(path.join(root, "dist/assets"));
      assert.equal(published.some((name) => name.endsWith(".d.ts") || name.endsWith(".map")), false);
      assertNoSharedBody(path.join(root, "dist/assets"));
    });

    await t.test("fetch-ffmpeg leaves javascript only", () => {
      execFileSync("sh", ["scripts/fetch-ffmpeg.sh"], { cwd: root, timeout: 60000 });
      const names = readdirSync(vendor).sort();
      assert.ok(names.includes("index.js"));
      assert.ok(names.includes("worker.js"));
      assert.equal(names.some((name) => name.endsWith(".d.ts") || name.endsWith(".d.mts") || name.endsWith(".map")), false);
      for (const name of names) {
        assert.ok(name.endsWith(".js") || name.endsWith(".mjs"), name);
      }
      execFileSync("sh", ["scripts/stage-assets.sh"], { cwd: root });
      const staged = readdirSync(path.join(root, "dist/assets/vendor/ffmpeg")).sort();
      assert.deepEqual(staged, names);
      assertNoSharedBody(path.join(root, "dist/assets"));
    });
  } finally {
    if (hadVendor) {
      rmSync(vendor, { recursive: true, force: true });
      cpSync(path.join(backup, "ffmpeg"), vendor, { recursive: true });
    }
    rmSync(backup, { recursive: true, force: true });
  }
});

function assertNoSharedBody(dir) {
  const byHash = new Map();
  for (const name of walk(dir)) {
    const body = readFileSync(path.join(dir, name));
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 32);
    const ext = path.posix.extname(name);
    const previous = byHash.get(hash);
    if (previous && previous.ext !== ext) {
      assert.fail(`${previous.name} and ${name} share a body`);
    }
    if (!previous) byHash.set(hash, { name, ext });
  }
}

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
