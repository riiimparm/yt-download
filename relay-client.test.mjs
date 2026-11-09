import assert from "node:assert/strict";
import test from "node:test";
import { createRelayFetch, probeRelay, wrapXMLHttpRequest } from "./relay-client.mjs";

const origin = "https://yt.example";

function nativeRecording() {
  const calls = [];
  const fetchImpl = async (input, init) => {
    calls.push({ input, init });
    return new Response("ok", { status: 200, headers: { "x-yt-relay": "1" } });
  };
  return { calls, fetchImpl };
}

test("probe is true only when the relay marks the response", async () => {
  assert.equal(await probeRelay(async () => new Response("missing", { status: 404 })), false);
  assert.equal(await probeRelay(async () => {
    throw new Error("offline");
  }), false);
  assert.equal(await probeRelay(async () => new Response("{}", {
    status: 400,
    headers: { "x-yt-relay": "1" },
  })), true);
});

test("allowlisted URLs are rewritten and other URLs stay direct", async () => {
  const { calls, fetchImpl } = nativeRecording();
  const relayFetch = createRelayFetch(fetchImpl, origin);
  await relayFetch("https://www.youtube.com/watch?v=jNQXAC9IVRw", {
    headers: { cookie: "SID=secret", authorization: "Bearer secret", range: "bytes=0-1" },
  });
  const proxied = new URL(calls[0].input);
  assert.equal(proxied.origin, origin);
  assert.equal(proxied.pathname, "/proxy");
  assert.equal(proxied.searchParams.get("url"), "https://www.youtube.com/watch?v=jNQXAC9IVRw");
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.headers.get("cookie"), null);
  assert.equal(calls[0].init.headers.get("authorization"), null);
  assert.equal(calls[0].init.headers.get("range"), "bytes=0-1");

  await relayFetch("https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm");
  assert.equal(calls[1].input, "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm");
  assert.equal(calls[1].init, undefined);

  await relayFetch(`${origin}/proxy?url=https%3A%2F%2Fwww.youtube.com%2F`);
  assert.equal(calls[2].input, `${origin}/proxy?url=https%3A%2F%2Fwww.youtube.com%2F`);
});

test("POST keeps its body when the URL is rewritten", async () => {
  const { calls, fetchImpl } = nativeRecording();
  const relayFetch = createRelayFetch(fetchImpl, origin);
  await relayFetch("https://www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"context":{}}',
  });
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.body, '{"context":{}}');
  assert.equal(calls[0].init.headers.get("content-type"), "application/json");
});

test("XMLHttpRequest opens the relay URL for allowlisted hosts only", () => {
  class FakeXHR {
    open(method, url) {
      this.method = method;
      this.url = url;
    }
  }
  const Wrapped = wrapXMLHttpRequest(FakeXHR, origin);
  const youtube = new Wrapped();
  youtube.open("GET", "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg");
  assert.equal(youtube.method, "GET");
  assert.equal(
    new URL(youtube.url).searchParams.get("url"),
    "https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg",
  );
  const direct = new Wrapped();
  direct.open("GET", "https://cdn.jsdelivr.net/pyodide/pyodide.js");
  assert.equal(direct.url, "https://cdn.jsdelivr.net/pyodide/pyodide.js");
});
