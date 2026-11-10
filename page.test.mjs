import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("./style.css", import.meta.url), "utf8");

test("the page is the downloader and not the old explanation", () => {
  assert.match(html, /<title>yt-download<\/title>/);
  assert.match(html, /<h1>yt-download<\/h1>/);
  assert.match(html, /value="mp4"/);
  assert.match(html, /value="mp3"/);
  assert.equal(html.includes("実測した範囲"), false);
  assert.equal(html.includes("WebAssembly 上の Python"), false);
  assert.equal(html.includes("fonts.googleapis.com"), false);
  assert.equal(html.includes("id=\"log\""), false);
});

test("corners stay square and reduced motion stops the bar", () => {
  assert.equal(css.includes("border-radius: 0"), true);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /animation:\s*none/);
});

test("the page block is centered and the title is centered", () => {
  assert.match(css, /display:\s*flex/);
  assert.match(css, /margin:\s*auto/);
  assert.match(css, /max-width:\s*44rem/);
  assert.match(css, /text-align:\s*center/);
});
