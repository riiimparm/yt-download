import assert from "node:assert/strict";
import test from "node:test";
import { chooseFormats, downloadName, ffmpegArgs } from "./convert-plan.mjs";

const webm = {
  format_id: "0",
  ext: "webm",
  vcodec: "vp9",
  acodec: "opus",
  height: 240,
  abr: 80,
  tbr: 400,
  filesize: 554058,
};
const video = { format_id: "248", ext: "webm", vcodec: "vp9", acodec: "none", height: 1080, tbr: 2000, filesize: 9 };
const audio = { format_id: "140", ext: "m4a", vcodec: "none", acodec: "mp4a.40.2", abr: 128, tbr: 130, filesize: 3 };
const lowMp4 = { format_id: "18", ext: "mp4", vcodec: "avc1", acodec: "mp4a.40.2", height: 360, abr: 96, tbr: 500, filesize: 8 };
const highWebm = { format_id: "99", ext: "webm", vcodec: "vp9", acodec: "opus", height: 720, abr: 160, tbr: 1500, filesize: 20 };

test("mp3 prefers the audio-only format", () => {
  assert.deepEqual(chooseFormats([video, audio, lowMp4], "mp3"), [
    { formatId: "140", kind: "audio", ext: "m4a" },
  ]);
});

test("mp3 uses a combined file when that is all there is", () => {
  assert.deepEqual(chooseFormats([webm], "mp3"), [
    { formatId: "0", kind: "av", ext: "webm" },
  ]);
});

test("mp4 keeps one combined file and prefers an mp4 container", () => {
  assert.deepEqual(chooseFormats([highWebm, lowMp4], "mp4"), [
    { formatId: "18", kind: "av", ext: "mp4" },
  ]);
});

test("mp4 pairs a video-only file with an audio-only file", () => {
  assert.deepEqual(chooseFormats([audio, video], "mp4"), [
    { formatId: "248", kind: "video", ext: "webm" },
    { formatId: "140", kind: "audio", ext: "m4a" },
  ]);
});

test("mp4 is not planned from video with no audio", () => {
  assert.deepEqual(chooseFormats([video], "mp4"), []);
});

test("ffmpeg args encode mp3 with lame and mp4 with x264", () => {
  assert.deepEqual(ffmpegArgs([{ name: "av.webm", kind: "av", ext: "webm" }], "mp3"), [
    "-i", "av.webm", "-vn", "-c:a", "libmp3lame", "-q:a", "2", "out.mp3",
  ]);
  assert.ok(ffmpegArgs([{ name: "av.webm", kind: "av", ext: "webm" }], "mp4").includes("libx264"));
  assert.deepEqual(ffmpegArgs([{ name: "av.mp4", kind: "av", ext: "mp4" }], "mp4"), [
    "-i", "av.mp4", "-c", "copy", "-movflags", "+faststart", "out.mp4",
  ]);
  const merged = ffmpegArgs([
    { name: "video.webm", kind: "video", ext: "webm" },
    { name: "audio.m4a", kind: "audio", ext: "m4a" },
  ], "mp4");
  assert.equal(merged.includes("libx264"), true);
  assert.equal(merged.includes("0:v:0"), true);
  assert.equal(merged.includes("1:a:0"), true);
});

test("a failed copy can be asked to transcode", () => {
  const args = ffmpegArgs([{ name: "av.mp4", kind: "av", ext: "mp4" }], "mp4", "transcode");
  assert.equal(args.includes("copy"), false);
  assert.equal(args.includes("libx264"), true);
});

test("download names stay inside a safe basename", () => {
  assert.equal(downloadName("flower", "mp3"), "flower.mp3");
  assert.equal(downloadName("a/b c", "mp4"), "a_b_c.mp4");
  assert.equal(downloadName("", "mp4"), "download.mp4");
});
