import assert from "node:assert/strict";
import test from "node:test";
import worker, { checkRelayUrl, handleProxy, isAllowedRelayUrl, withJavaScriptType } from "./index.mjs";

const VIDEO = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

function proxyRequest(target, init = {}) {
  const url = new URL("https://worker.test/proxy");
  if (target !== undefined) url.searchParams.set("url", target);
  return new Request(url, init);
}

function jsonFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
  return { calls, fetchImpl };
}

test("suffix match allows YouTube hosts and rejects lookalikes", () => {
  const allowed = [
    "https://youtube.com/watch?v=jNQXAC9IVRw",
    "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    "https://WWW.YouTube.com/watch?v=jNQXAC9IVRw",
    "https://www.youtube.com./watch?v=jNQXAC9IVRw",
    "https://m.youtube.com/watch?v=jNQXAC9IVRw",
    "https://music.youtube.com/",
    "https://youtu.be/jNQXAC9IVRw",
    "https://rr1---sn-abc.googlevideo.com/videoplayback?id=1",
    "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg",
    "https://s.ytimg.com/yts/jsbin/player.js",
    "https://youtubei.googleapis.com/youtubei/v1/player",
  ];
  for (const url of allowed) {
    assert.equal(isAllowedRelayUrl(url), true, url);
  }

  const rejected = [
    "http://www.youtube.com/watch?v=jNQXAC9IVRw",
    "https://evil-youtube.com/",
    "https://notyoutube.com/",
    "https://youtube.com.evil.com/",
    "https://www.youtube.com.evil.com/",
    "https://notyoutubei.googleapis.com/",
    "https://youtubei.googleapis.com.evil.com/",
    "https://googleapis.com/youtube/v3/videos",
    "https://evil.com/https://www.youtube.com/",
    "https://evil.com/#@www.youtube.com/",
    "https://user:pass@www.youtube.com/watch",
    "https://www.youtube.com:8443/",
    "https://127.0.0.1/",
    "https://2130706433/",
    "https://[::1]/",
    "https://example.com/",
    "not a url",
    "",
  ];
  for (const url of rejected) {
    assert.equal(isAllowedRelayUrl(url), false, url);
  }
  assert.equal(checkRelayUrl("http://www.youtube.com/").status, 400);
  assert.equal(checkRelayUrl("https://evil-youtube.com/").status, 403);
  assert.equal(checkRelayUrl("https://user:pass@www.youtube.com/").status, 400);
});

test("missing url and disallowed targets do not call upstream", async () => {
  const { calls, fetchImpl } = jsonFetch(() => {
    throw new Error("upstream should not be called");
  });
  const missing = await handleProxy(proxyRequest(undefined), { fetchImpl });
  assert.equal(missing.status, 400);
  assert.equal(missing.headers.get("x-yt-relay"), "1");
  assert.deepEqual(await missing.json(), { error: "url is required" });

  const evil = await handleProxy(proxyRequest("https://evil-youtube.com/a"), { fetchImpl });
  assert.equal(evil.status, 403);

  const http = await handleProxy(proxyRequest("http://www.youtube.com/"), { fetchImpl });
  assert.equal(http.status, 400);
  assert.equal(calls.length, 0);
});

test("methods other than GET, HEAD, and POST are rejected", async () => {
  const { calls, fetchImpl } = jsonFetch(() => new Response("no"));
  const response = await handleProxy(proxyRequest(VIDEO, { method: "PUT" }), { fetchImpl });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD, POST");
  assert.equal(calls.length, 0);
});

test("forwards only the request headers yt-dlp needs", async () => {
  const { calls, fetchImpl } = jsonFetch(() => new Response("ok", { status: 200 }));
  const response = await handleProxy(proxyRequest(VIDEO, {
    headers: {
      accept: "text/html",
      "accept-language": "ja",
      authorization: "Bearer secret",
      cookie: "SID=secret",
      origin: "https://yt-download.riiimparm.workers.dev",
      range: "bytes=0-1",
      referer: "https://yt-download.riiimparm.workers.dev/",
      "user-agent": "yt-dlp",
      "x-goog-visitor-id": "visitor",
      "x-youtube-client-name": "1",
      "x-youtube-client-version": "2.20260708.00.00",
      "x-forwarded-for": "203.0.113.5",
    },
  }), { fetchImpl });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.method, "GET");
  const sent = calls[0].init.headers;
  assert.equal(sent.get("range"), "bytes=0-1");
  assert.equal(sent.get("user-agent"), "yt-dlp");
  assert.equal(sent.get("x-youtube-client-name"), "1");
  assert.equal(sent.get("x-goog-visitor-id"), "visitor");
  assert.equal(sent.get("cookie"), "SOCS=CAI");
  assert.equal(sent.get("authorization"), null);
  assert.equal(sent.get("x-forwarded-for"), null);
  assert.equal(sent.get("origin"), "https://www.youtube.com");
  assert.equal(sent.get("referer"), "https://www.youtube.com/");
});

test("POST forwards a small body and stops when the body is too large", async () => {
  const { calls, fetchImpl } = jsonFetch(async (_url, init) => {
    const text = new TextDecoder().decode(init.body);
    return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
  });
  const response = await handleProxy(proxyRequest("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "SID=secret",
    },
    body: '{"context":{}}',
  }), { fetchImpl });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"context":{}}');
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.get("content-type"), "application/json");
  assert.equal(calls[0].init.headers.get("cookie"), "SOCS=CAI");

  const huge = await handleProxy(proxyRequest(VIDEO, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: new Uint8Array(1024 * 1024 + 1),
  }), { fetchImpl });
  assert.equal(huge.status, 413);
  assert.equal(calls.length, 1);
});

test("streams the upstream body and drops cookies and content-encoding", async () => {
  let controller;
  const stream = new ReadableStream({
    start(started) {
      controller = started;
    },
  });
  const upstream = new Response(stream, {
    status: 206,
    headers: {
      "content-type": "video/mp4",
      "content-range": "bytes 0-3/9",
      "accept-ranges": "bytes",
      "content-encoding": "gzip",
      "content-length": "4",
      "set-cookie": "SID=secret",
    },
  });
  const { fetchImpl } = jsonFetch(() => upstream);
  const pending = handleProxy(proxyRequest(VIDEO), { fetchImpl });
  const raced = await Promise.race([
    pending.then((response) => ({ kind: "done", response })),
    new Promise((resolve) => setTimeout(() => resolve({ kind: "timeout" }), 50)),
  ]);
  assert.equal(raced.kind, "done");
  const response = raced.response;
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.equal(response.headers.get("content-range"), "bytes 0-3/9");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(response.headers.get("content-encoding"), null);
  assert.equal(response.headers.get("content-length"), null);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-yt-relay"), "1");
  controller.enqueue(new Uint8Array([1, 2, 3, 4]));
  controller.close();
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3, 4]));
});

test("follows redirects only when the next host is allowlisted", async () => {
  const { calls, fetchImpl } = jsonFetch((url) => {
    if (String(url).startsWith("https://youtu.be/")) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
      });
    }
    if (String(url).includes("www.youtube.com/watch")) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://rr1---sn-abc.googlevideo.com/videoplayback?id=1" },
      });
    }
    return new Response("media", {
      status: 200,
      headers: { "content-type": "video/mp4", "content-length": "5" },
    });
  });
  const response = await handleProxy(proxyRequest("https://youtu.be/jNQXAC9IVRw"), { fetchImpl });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "media");
  assert.equal(response.headers.get("content-length"), "5");
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, "https://rr1---sn-abc.googlevideo.com/videoplayback?id=1");
});

test("a redirect to a non-allowlisted host is not fetched", async () => {
  const { calls, fetchImpl } = jsonFetch(() => new Response(null, {
    status: 302,
    headers: { location: "https://evil.example/collect" },
  }));
  const protocolRelative = await handleProxy(proxyRequest(VIDEO), { fetchImpl });
  assert.equal(protocolRelative.status, 403);
  assert.equal(protocolRelative.headers.get("x-yt-redirect-host"), "evil.example");
  assert.deepEqual(await protocolRelative.json(), { error: "redirect host is not allowed", host: "evil.example" });
  assert.equal(calls.length, 1);

  const { calls: calls2, fetchImpl: fetch2 } = jsonFetch(() => new Response(null, {
    status: 302,
    headers: { location: "//evil.example/collect" },
  }));
  const response = await handleProxy(proxyRequest(VIDEO), { fetchImpl: fetch2 });
  assert.equal(response.status, 403);
  assert.equal(calls2.length, 1);

  const { calls: calls3, fetchImpl: fetch3 } = jsonFetch(() => new Response(null, {
    status: 302,
    headers: { location: "http://www.youtube.com/watch?v=jNQXAC9IVRw" },
  }));
  const insecure = await handleProxy(proxyRequest(VIDEO), { fetchImpl: fetch3 });
  assert.equal(insecure.status, 403);
  assert.equal(insecure.headers.get("x-yt-redirect-host"), "www.youtube.com");
  assert.equal(calls3.length, 1);
});

test("a redirect to the Google consent host is followed and the host is not an entry url", async () => {
  assert.equal(isAllowedRelayUrl("https://consent.google.com/m?continue=https://www.youtube.com/"), false);
  assert.equal(isAllowedRelayUrl("https://www.google.com/sorry/index"), false);

  const { calls, fetchImpl } = jsonFetch((url, _init, n) => {
    if (n === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://consent.google.com/m?continue=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DjNQXAC9IVRw" },
      });
    }
    return new Response("watch", { status: 200, headers: { "content-type": "text/html" } });
  });
  const response = await handleProxy(proxyRequest(VIDEO), { fetchImpl });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "watch");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://consent.google.com/m?continue=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DjNQXAC9IVRw");
  assert.equal(calls[1].init.headers.get("cookie"), "SOCS=CAI");
  assert.equal(calls[1].init.headers.get("origin"), "https://www.youtube.com");

  const { calls: sorryCalls, fetchImpl: sorryFetch } = jsonFetch(() => new Response(null, {
    status: 302,
    headers: { location: "https://www.google.com/sorry/index?continue=https%3A%2F%2Fwww.youtube.com%2F" },
  }));
  const sorry = await handleProxy(proxyRequest(VIDEO), { fetchImpl: sorryFetch });
  assert.equal(sorry.status, 403);
  assert.equal(sorry.headers.get("x-yt-redirect-host"), "www.google.com");
  assert.equal(sorryCalls.length, 1);
});

test("POST redirects that change method drop the body", async () => {
  const { calls, fetchImpl } = jsonFetch((_url, _init, n) => {
    if (n === 1) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://www.youtube.com/youtubei/v1/player?prettyPrint=false" },
      });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
  await handleProxy(proxyRequest("https://youtu.be/jNQXAC9IVRw", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"context":{}}',
  }), { fetchImpl });
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[1].init.method, "GET");
  assert.equal(calls[1].init.body, undefined);
  assert.equal(calls[1].init.headers.get("content-type"), null);
});

test("307 keeps the POST body", async () => {
  const { calls, fetchImpl } = jsonFetch((_url, _init, n) => {
    if (n === 1) {
      return new Response(null, {
        status: 307,
        headers: { location: "https://www.youtube.com/youtubei/v1/next" },
      });
    }
    return new Response("ok");
  });
  await handleProxy(proxyRequest("https://www.youtube.com/youtubei/v1/next", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"context":{}}',
  }), { fetchImpl });
  assert.equal(calls[1].init.method, "POST");
  assert.equal(new TextDecoder().decode(calls[1].init.body), '{"context":{}}');
  assert.equal(calls[1].init.headers.get("content-type"), "application/json");
});

test("redirect loops stop", async () => {
  const { calls, fetchImpl } = jsonFetch(() => new Response(null, {
    status: 302,
    headers: { location: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
  }));
  const response = await handleProxy(proxyRequest(VIDEO), { fetchImpl });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "too many redirects" });
  assert.equal(calls.length, 6);
});

test("upstream failures become 502", async () => {
  const response = await handleProxy(proxyRequest(VIDEO), {
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(response.status, 502);
});

test("HEAD does not send a body", async () => {
  const { calls, fetchImpl } = jsonFetch(() => new Response(null, { status: 200 }));
  const response = await handleProxy(proxyRequest(VIDEO, { method: "HEAD" }), { fetchImpl });
  assert.equal(response.status, 200);
  assert.equal(calls[0].init.method, "HEAD");
  assert.equal(calls[0].init.body, undefined);
  assert.equal(await response.text(), "");
});

test("the worker serves /proxy itself and everything else from assets", async () => {
  const seen = [];
  const env = {
    ASSETS: {
      async fetch(request) {
        seen.push(new URL(request.url).pathname);
        return new Response("page", { status: 200 });
      },
    },
  };
  const page = await worker.fetch(new Request("https://worker.test/"), env);
  assert.equal(await page.text(), "page");
  assert.deepEqual(seen, ["/"]);
  assertIsolated(page);

  const relay = await worker.fetch(new Request("https://worker.test/proxy"), env);
  assert.equal(relay.status, 400);
  assert.equal(relay.headers.get("x-yt-relay"), "1");
  assert.deepEqual(seen, ["/"]);
  assertIsolated(relay);

  const missing = await worker.fetch(new Request("https://worker.test/"), {});
  assert.equal(missing.status, 500);
  assertIsolated(missing);
});

test("javascript assets are served as javascript", async () => {
  const body = 'export * from "./classes.js";\nexport * from "./types.js";\n';
  const env = {
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname;
        const type = pathname.endsWith(".css") ? "text/css" : "text/vnd.trolltech.linguist";
        const status = pathname.endsWith("missing.js") ? 404 : 200;
        return new Response(body, { status, headers: { "content-type": type, "cache-control": "public" } });
      },
    },
  };
  const js = await worker.fetch(new Request("https://worker.test/vendor/ffmpeg/index.js"), env);
  assert.equal(js.headers.get("content-type"), "text/javascript");
  assert.equal(js.headers.get("cache-control"), "public");
  assert.equal(await js.text(), body);
  assertIsolated(js);

  const mjs = await worker.fetch(new Request("https://worker.test/vendor/ffmpeg/empty.mjs"), env);
  assert.equal(mjs.headers.get("content-type"), "text/javascript");

  const css = await worker.fetch(new Request("https://worker.test/style.css"), env);
  assert.equal(css.headers.get("content-type"), "text/css");

  const missing = await worker.fetch(new Request("https://worker.test/missing.js"), env);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("content-type"), "text/vnd.trolltech.linguist");

  const already = withJavaScriptType(
    "https://worker.test/app.js",
    new Response("x", { status: 200, headers: { "content-type": "text/javascript; charset=utf-8" } }),
  );
  assert.equal(already.headers.get("content-type"), "text/javascript; charset=utf-8");
});

function assertIsolated(response) {
  assert.equal(response.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(response.headers.get("cross-origin-embedder-policy"), "require-corp");
}

test("the relay answers only its own page", async () => {
  const { calls, fetchImpl } = jsonFetch(() => new Response("media", {
    status: 200,
    headers: { "content-type": "video/mp4" },
  }));
  for (const site of ["cross-site", "same-site", "none"]) {
    const response = await handleProxy(
      proxyRequest(VIDEO, { headers: { "sec-fetch-site": site } }),
      { fetchImpl },
    );
    assert.equal(response.status, 403, site);
    assert.deepEqual(await response.json(), { error: "the relay only answers its own page" });
  }
  assert.equal(calls.length, 0);

  const same = await handleProxy(
    proxyRequest(VIDEO, { headers: { "sec-fetch-site": "same-origin" } }),
    { fetchImpl },
  );
  assert.equal(same.status, 200);
  assert.equal(calls.length, 1);
});

test("relay responses never become a document in this origin", async () => {
  const { fetchImpl } = jsonFetch(() => new Response("<script>alert(1)</script>", {
    status: 200,
    headers: { "content-type": "text/html" },
  }));
  const html = await handleProxy(proxyRequest(VIDEO), { fetchImpl });
  assert.equal(html.headers.get("content-type"), "text/html");
  assertNotADocument(html);

  const error = await handleProxy(proxyRequest("https://example.com/"), { fetchImpl });
  assert.equal(error.status, 403);
  assertNotADocument(error);
});

function assertNotADocument(response) {
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-security-policy"), "sandbox");
  assert.equal(response.headers.get("cache-control"), "no-store");
}
