import { isAllowedRelayUrl } from "./worker/index.mjs";

export async function probeRelay(fetchImpl) {
  try {
    const response = await fetchImpl("/proxy", { method: "GET", cache: "no-store" });
    return response.headers.get("x-yt-relay") === "1";
  } catch {
    return false;
  }
}

export function createRelayFetch(nativeFetch, origin) {
  return (input, init) => {
    const target = resolveUrl(input, origin);
    if (!target || !isAllowedRelayUrl(target)) return nativeFetch(input, init);
    const proxy = new URL("/proxy", origin);
    proxy.searchParams.set("url", target.href);
    const method = methodOf(input, init);
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.delete("cookie");
    headers.delete("authorization");
    const body = method === "GET" || method === "HEAD"
      ? undefined
      : (init?.body ?? (input instanceof Request ? input.body : undefined));
    return nativeFetch(proxy, {
      method,
      headers,
      body,
      credentials: "omit",
      cache: "no-store",
      redirect: "follow",
    });
  };
}

export function wrapXMLHttpRequest(Native, origin) {
  function Wrapped() {
    const xhr = new Native();
    const open = xhr.open;
    xhr.open = function (method, url, ...rest) {
      return open.call(this, method, relayUrl(url, origin), ...rest);
    };
    return xhr;
  }
  Wrapped.prototype = Native.prototype;
  return Wrapped;
}

function relayUrl(url, origin) {
  try {
    const target = new URL(url, origin);
    if (!isAllowedRelayUrl(target)) return url;
    const proxy = new URL("/proxy", origin);
    proxy.searchParams.set("url", target.href);
    return proxy.href;
  } catch {
    return url;
  }
}

function resolveUrl(input, origin) {
  try {
    if (typeof input === "string" || input instanceof URL) return new URL(input, origin);
    if (typeof Request !== "undefined" && input instanceof Request) return new URL(input.url);
  } catch {
    return null;
  }
  return null;
}

function methodOf(input, init) {
  const method = init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET");
  return String(method || "GET").toUpperCase();
}
