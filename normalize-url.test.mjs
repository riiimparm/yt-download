import assert from "node:assert/strict";
import test from "node:test";
import { canonicalVideoUrl } from "./normalize-url.mjs";

const id = "p_TKUmOTxoA";
const single = `https://youtu.be/${id}`;

test("watch URL drops playlist, radio, and other params", () => {
  assert.equal(
    canonicalVideoUrl(
      `https://www.youtube.com/watch?v=${id}&list=RD${id}&start_radio=1&pp=tracking`,
    ),
    single,
  );
});

test("watch URL works with and without www, and on m and music", () => {
  assert.equal(
    canonicalVideoUrl(`https://youtube.com/watch?v=${id}&list=RD${id}&start_radio=1`),
    single,
  );
  assert.equal(
    canonicalVideoUrl(`https://m.youtube.com/watch?v=${id}&si=sharetoken&feature=share`),
    single,
  );
  assert.equal(canonicalVideoUrl(`https://music.youtube.com/watch?v=${id}`), single);
});

test("youtu.be drops si and keeps the video id", () => {
  assert.equal(canonicalVideoUrl(`https://youtu.be/${id}?si=AbCdEfGhIj`), single);
});

test("shorts URLs become the single video", () => {
  assert.equal(canonicalVideoUrl(`https://www.youtube.com/shorts/${id}`), single);
  assert.equal(canonicalVideoUrl(`https://youtube.com/shorts/${id}?si=abc`), single);
  assert.equal(canonicalVideoUrl(`https://m.youtube.com/shorts/${id}/`), single);
});

test("the other id paths yt-dlp takes are accepted", () => {
  assert.equal(canonicalVideoUrl(`https://www.youtube.com/live/${id}`), single);
  assert.equal(canonicalVideoUrl(`https://www.youtube.com/embed/${id}`), single);
  assert.equal(canonicalVideoUrl(`https://www.youtube.com/v/${id}`), single);
  assert.equal(canonicalVideoUrl(`https://www.youtube.com/e/${id}`), single);
  assert.equal(canonicalVideoUrl(`https://www.youtube.com/?v=${id}`), single);
  assert.equal(canonicalVideoUrl(`https://www.youtube-nocookie.com/embed/${id}`), single);
  assert.equal(canonicalVideoUrl(`https://www.youtubekids.com/watch?v=${id}`), single);
  assert.equal(canonicalVideoUrl(`https://youtube.googleapis.com/v/${id}`), single);
});

test("http is accepted and the output is always https", () => {
  assert.equal(canonicalVideoUrl(`http://www.youtube.com/watch?v=${id}`), single);
  assert.equal(canonicalVideoUrl(`https://www.youtube.com./watch?v=${id}`), single);
  assert.equal(canonicalVideoUrl(`https://WWW.YouTube.com/watch?v=${id}`), single);
});

test("a plain seconds timestamp is kept as t", () => {
  assert.equal(
    canonicalVideoUrl(`https://www.youtube.com/watch?v=${id}&t=90&list=RD${id}`),
    `${single}?t=90`,
  );
  assert.equal(canonicalVideoUrl(`https://youtu.be/${id}?si=abc&t=12s`), `${single}?t=12`);
  assert.equal(
    canonicalVideoUrl(`https://m.youtube.com/shorts/${id}?start=15&feature=share`),
    `${single}?t=15`,
  );
});

test("a non-numeric timestamp is dropped", () => {
  assert.equal(
    canonicalVideoUrl(`https://www.youtube.com/watch?v=${id}&t=1m30s&list=RD${id}&start_radio=1`),
    single,
  );
  assert.equal(canonicalVideoUrl(`https://youtu.be/${id}?t=1h2m3s&si=abc`), single);
});

test("a plain start is used when t is not a plain number of seconds", () => {
  assert.equal(
    canonicalVideoUrl(`https://www.youtube.com/watch?v=${id}&t=1m30s&start=90&list=PLxxxx`),
    `${single}?t=90`,
  );
});

test("anything that is not a YouTube video URL is rejected", () => {
  const rejected = [
    // Not YouTube.
    "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm",
    "https://archive.org/details/BigBuckBunny_328",
    "https://example.com/",
    "not a url",
    "",
    // Lookalikes.
    `https://youtube.com.evil.com/watch?v=${id}`,
    `https://www.youtube.com.evil.com/watch?v=${id}`,
    `https://evil-youtube.com/watch?v=${id}`,
    `https://notyoutube.com/watch?v=${id}`,
    `https://evil.com/https://www.youtube.com/watch?v=${id}`,
    `https://evil.com/#@www.youtube.com/watch?v=${id}`,
    // YouTube, but not one video.
    "https://www.youtube.com/@somechannel",
    "https://www.youtube.com/playlist?list=PLabcdefghij",
    "https://www.youtube.com/watch?list=PLabcdefghij",
    "https://www.youtube.com/live/live_stream",
    "https://www.youtube.com/embed/videoseries",
    `https://www.youtube.com/watch/${id}`,
    `https://youtu.be/${id}/extra`,
    "https://youtu.be/short",
    `https://www.youtube.com/watch?v=${id}x`,
    // Credentials, ports, other schemes.
    `https://user:pass@youtu.be/${id}`,
    `https://youtu.be:8443/${id}`,
    `ftp://youtu.be/${id}`,
    `javascript:fetch("https://youtu.be/${id}")`,
    // Not a string.
    null,
    undefined,
    42,
  ];
  for (const sample of rejected) {
    assert.equal(canonicalVideoUrl(sample), null, String(sample));
  }
});
