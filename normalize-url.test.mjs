import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUrl } from "./normalize-url.mjs";

const id = "p_TKUmOTxoA";
const single = `https://youtu.be/${id}`;

test("watch URL drops playlist, radio, and other params", () => {
  assert.equal(
    normalizeUrl(
      `https://www.youtube.com/watch?v=${id}&list=RD${id}&start_radio=1&pp=tracking`,
    ),
    single,
  );
});

test("watch URL works with and without www, and on m.youtube.com", () => {
  assert.equal(
    normalizeUrl(`https://youtube.com/watch?v=${id}&list=RD${id}&start_radio=1`),
    single,
  );
  assert.equal(
    normalizeUrl(`https://m.youtube.com/watch?v=${id}&si=sharetoken&feature=share`),
    single,
  );
});

test("youtu.be drops si and keeps the video id", () => {
  assert.equal(normalizeUrl(`https://youtu.be/${id}?si=AbCdEfGhIj`), single);
});

test("shorts URLs become the single video", () => {
  assert.equal(normalizeUrl(`https://www.youtube.com/shorts/${id}`), single);
  assert.equal(normalizeUrl(`https://youtube.com/shorts/${id}?si=abc`), single);
  assert.equal(normalizeUrl(`https://m.youtube.com/shorts/${id}/`), single);
});

test("a plain seconds timestamp is kept as t", () => {
  assert.equal(
    normalizeUrl(`https://www.youtube.com/watch?v=${id}&t=90&list=RD${id}`),
    `${single}?t=90`,
  );
  assert.equal(normalizeUrl(`https://youtu.be/${id}?si=abc&t=12s`), `${single}?t=12`);
  assert.equal(
    normalizeUrl(`https://m.youtube.com/shorts/${id}?start=15&feature=share`),
    `${single}?t=15`,
  );
});

test("a non-numeric timestamp is dropped", () => {
  assert.equal(
    normalizeUrl(`https://www.youtube.com/watch?v=${id}&t=1m30s&list=RD${id}&start_radio=1`),
    single,
  );
  assert.equal(normalizeUrl(`https://youtu.be/${id}?t=1h2m3s&si=abc`), single);
});

test("a plain start is used when t is not a plain number of seconds", () => {
  assert.equal(
    normalizeUrl(`https://www.youtube.com/watch?v=${id}&t=1m30s&start=90&list=PLxxxx`),
    `${single}?t=90`,
  );
});

test("non-YouTube URLs pass through unchanged", () => {
  const samples = [
    "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm",
    "https://archive.org/details/BigBuckBunny_328",
    "https://www.youtube.com/@somechannel",
    "not a url",
  ];
  for (const sample of samples) {
    assert.equal(normalizeUrl(sample), sample);
  }
});
