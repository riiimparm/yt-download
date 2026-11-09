// Only a YouTube video URL is accepted, and the output is always the canonical
// https://youtu.be/<id> form. Anything else returns null, so a non-YouTube URL
// never reaches yt-dlp or the relay.
//
// The host and path forms are the ones yt-dlp 2026.10.26 accepts in
// YoutubeIE._VALID_URL, minus the third party mirrors it also matches
// (invidious, pwnyoutube, deturl, hooktube, yourepeat, vid.plus, zwearz,
// cleanvideosearch) and minus the bare 11 character id. Those mirrors are not
// YouTube, the relay allowlist does not carry them, and a bare id is not a URL.
// https://github.com/yt-dlp/yt-dlp/blob/2026.10.26/yt_dlp/extractor/youtube/_video.py

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const TRIVIAL_SECONDS = /^(\d+)s?$/;
const HOSTNAME = /^[a-z0-9.-]+$/;

// youtube.com and any subdomain of it: www, m, music, gaming.
const SUFFIX_HOSTS = ["youtube.com", "youtube-nocookie.com", "youtubekids.com"];
const EXACT_HOSTS = new Set(["youtu.be", "youtube.googleapis.com"]);
const ID_SEGMENTS = new Set(["v", "e", "embed", "shorts", "live"]);
// Both are 11 characters and both would pass VIDEO_ID. yt-dlp excludes them
// after /live/ and /shorts/ because they open a stream or a playlist, not a
// video.
const NOT_IDS = new Set(["videoseries", "live_stream"]);

export function canonicalVideoUrl(input) {
  if (typeof input !== "string") return null;
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  const host = youtubeHost(url);
  if (!host) return null;

  const id = videoId(url, host);
  if (!id || NOT_IDS.has(id)) return null;

  const seconds = trivialTimestamp(url);
  if (seconds == null) return `https://youtu.be/${id}`;
  return `https://youtu.be/${id}?t=${seconds}`;
}

function youtubeHost(url) {
  let host = url.hostname.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (!HOSTNAME.test(host) || host.includes("..")) return null;
  if (EXACT_HOSTS.has(host)) return host;
  const suffix = SUFFIX_HOSTS.find((name) => host === name || host.endsWith(`.${name}`));
  return suffix ? host : null;
}

function videoId(url, host) {
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    if (parts.length === 1 && VIDEO_ID.test(parts[0])) return parts[0];
    return null;
  }

  // /v/ID, /e/ID, /embed/ID, /shorts/ID, /live/ID
  if (parts.length === 2 && ID_SEGMENTS.has(parts[0]) && VIDEO_ID.test(parts[1])) {
    return parts[1];
  }
  // /watch?v=ID and /?v=ID
  if (parts.length === 0 || (parts.length === 1 && parts[0] === "watch")) {
    const id = url.searchParams.get("v");
    if (id && VIDEO_ID.test(id)) return id;
  }
  return null;
}

function trivialTimestamp(url) {
  const fromT = trivialSeconds(url.searchParams.get("t"));
  if (fromT != null) return fromT;
  return trivialSeconds(url.searchParams.get("start"));
}

function trivialSeconds(value) {
  if (value == null) return null;
  const match = TRIVIAL_SECONDS.exec(value);
  if (!match) return null;
  return match[1];
}
