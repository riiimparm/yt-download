// Same-origin relay for yt-dlp. Hosts must match the suffix exactly
// (youtube.com, not evil-youtube.com). Responses are streamed through.

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 1024 * 1024;

export const RELAY_SUFFIXES = Object.freeze([
  "youtube.com",
  "youtu.be",
  "googlevideo.com",
  "ytimg.com",
  "youtubei.googleapis.com",
]);

const REQUEST_HEADERS = new Set([
  "accept",
  "accept-language",
  "content-type",
  "origin",
  "range",
  "referer",
  "user-agent",
  "x-goog-visitor-id",
  "x-youtube-client-name",
  "x-youtube-client-version",
]);

export function checkRelayUrl(input) {
  let url;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(String(input));
  } catch {
    return { ok: false, status: 400, error: "url is not absolute https" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, status: 400, error: "only https urls are allowed" };
  }
  if (url.username || url.password) {
    return { ok: false, status: 400, error: "urls with credentials are not allowed" };
  }
  if (url.port) {
    return { ok: false, status: 400, error: "only the default https port is allowed" };
  }
  const host = normalizeHost(url.hostname);
  if (!host || !hostAllowed(host)) {
    return { ok: false, status: 403, error: "host is not allowed" };
  }
  url.hash = "";
  return { ok: true, url };
}

export function isAllowedRelayUrl(input) {
  return checkRelayUrl(input).ok;
}

export async function handleProxy(request, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "POST") {
    return jsonResponse(405, { error: "method not allowed" }, { allow: "GET, HEAD, POST" });
  }

  // Only this page may use the relay. "none" is a typed URL or a bookmark,
  // "same-site" is another host in the zone, "cross-site" is anyone else.
  // ponytail: a missing header passes, for clients that send none. Anything
  // outside a browser can set the header anyway, so rate limiting or Access
  // is the answer if the relay ever needs a real gate.
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") {
    return jsonResponse(403, { error: "the relay only answers its own page" });
  }

  const incoming = new URL(request.url);
  const raw = incoming.searchParams.get("url");
  if (!raw) {
    return jsonResponse(400, { error: "url is required" });
  }
  const checked = checkRelayUrl(raw);
  if (!checked.ok) return jsonResponse(checked.status, { error: checked.error });

  let body = null;
  if (method === "POST") {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return jsonResponse(413, { error: "body too large" });
    }
    body = await readLimited(request.body, MAX_BODY_BYTES);
    if (!body) return jsonResponse(413, { error: "body too large" });
  }

  const headers = filterRequestHeaders(request.headers);
  try {
    const result = await fetchFollowing(checked.url, method, headers, body, fetchImpl, 0);
    if (result.error) return result.error;
    return await passUpstream(result.response, method);
  } catch {
    return jsonResponse(502, { error: "upstream fetch failed" });
  }
}

export function withIsolation(response) {
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env) {
    return withIsolation(await dispatch(request, env));
  },
};

async function dispatch(request, env) {
  const { pathname } = new URL(request.url);
  if (pathname === "/proxy") return handleProxy(request);
  if (!env?.ASSETS?.fetch) {
    return new Response("ASSETS binding is missing", {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return env.ASSETS.fetch(request);
}

function normalizeHost(hostname) {
  let host = String(hostname || "").toLowerCase();
  if (host.startsWith("[") || host.includes(":")) return "";
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

function hostAllowed(host) {
  if (!host || host.includes("..")) return false;
  // Letters, digits, hyphen, dot only. URL parsing already punycodes an IDN,
  // so anything left outside this set is not a hostname we want to fetch.
  if (!/^[a-z0-9.-]+$/.test(host)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /^\d+$/.test(host)) return false;
  return RELAY_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function filterRequestHeaders(input) {
  const headers = new Headers();
  for (const [name, value] of input) {
    if (REQUEST_HEADERS.has(name.toLowerCase())) headers.append(name, value);
  }
  return headers;
}

async function fetchFollowing(target, method, headers, body, fetchImpl, hops) {
  if (hops > MAX_REDIRECTS) {
    return { error: jsonResponse(502, { error: "too many redirects" }) };
  }
  const init = { method, headers, redirect: "manual" };
  if (method !== "GET" && method !== "HEAD" && body) init.body = body;
  const response = await fetchImpl(target.href, init);
  if (!isRedirect(response.status)) return { response };

  const location = response.headers.get("location");
  await response.body?.cancel?.();
  if (!location) return { error: jsonResponse(502, { error: "redirect missing location" }) };

  let next;
  try {
    next = new URL(location, target);
  } catch {
    return { error: jsonResponse(502, { error: "bad redirect" }) };
  }
  const checked = checkRelayUrl(next);
  if (!checked.ok) return { error: jsonResponse(403, { error: "redirect host is not allowed" }) };

  let nextMethod = method;
  let nextHeaders = headers;
  let nextBody = body;
  if ((response.status === 301 || response.status === 302 || response.status === 303) && method !== "GET" && method !== "HEAD") {
    nextMethod = "GET";
    nextBody = null;
    nextHeaders = new Headers(headers);
    nextHeaders.delete("content-type");
  }
  return fetchFollowing(checked.url, nextMethod, nextHeaders, nextBody, fetchImpl, hops + 1);
}

async function passUpstream(upstream, method) {
  const headers = relayHeaders();
  const encoding = upstream.headers.get("content-encoding");
  for (const name of ["content-type", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!encoding) {
    const length = upstream.headers.get("content-length");
    if (length) headers.set("content-length", length);
  }
  if (method === "HEAD" || upstream.body == null || upstream.status === 204 || upstream.status === 205 || upstream.status === 304) {
    await upstream.body?.cancel?.();
    return new Response(null, { status: upstream.status, headers });
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

// Relayed bytes keep the upstream content-type, so they must never become a
// document in this origin. nosniff stops the type being guessed, and the
// sandbox directive puts any document made from the response in an opaque
// origin, where it cannot read this origin's cookies or storage. On
// workers.dev the public suffix list did that much; a custom domain under a
// real zone does not.
function relayHeaders() {
  return new Headers({
    "x-yt-relay": "1",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox",
  });
}

function isRedirect(status) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function readLimited(stream, max) {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function jsonResponse(status, payload, extra) {
  const headers = relayHeaders();
  headers.set("content-type", "application/json; charset=utf-8");
  if (extra?.allow) headers.set("allow", extra.allow);
  return new Response(JSON.stringify(payload), { status, headers });
}
