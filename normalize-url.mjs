const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const TRIVIAL_SECONDS = /^(\d+)s?$/;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

export function normalizeUrl(input) {
  if (typeof input !== "string") return input;
  let url;
  try {
    url = new URL(input);
  } catch {
    return input;
  }

  const id = videoId(url);
  if (!id) return input;

  const seconds = trivialTimestamp(url);
  if (seconds == null) return `https://youtu.be/${id}`;
  return `https://youtu.be/${id}?t=${seconds}`;
}

function videoId(url) {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    if (parts.length === 1 && VIDEO_ID.test(parts[0])) return parts[0];
    return null;
  }
  if (!YOUTUBE_HOSTS.has(host)) return null;

  if (parts[0] === "shorts" && parts.length === 2 && VIDEO_ID.test(parts[1])) {
    return parts[1];
  }
  if (parts.length === 1 && parts[0] === "watch") {
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
