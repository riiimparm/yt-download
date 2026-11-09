import { checkpointItems } from "./checkpoints.mjs";
import { chooseFormats, downloadName, ffmpegArgs, outputName } from "./convert-plan.mjs";
import { normalizeUrl } from "./normalize-url.mjs";
import { createRelayFetch, probeRelay, wrapXMLHttpRequest } from "./relay-client.mjs";

const PYODIDE_VERSION = "314.0.7";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const vendor = new URL("./vendor/", import.meta.url);

const form = document.querySelector("#form");
const urlInput = document.querySelector("#url");
const runButton = document.querySelector("#run");
const formatInputs = form.querySelectorAll('input[name="format"]');
const progress = document.querySelector("#progress");
const bar = document.querySelector("#bar");
const checkpoints = document.querySelector("#checkpoints");
const saveRow = document.querySelector("#save-row");
const saveLink = document.querySelector("#save");
const saveName = document.querySelector("#save-name");

let runtimePromise = null;
let saveUrl = null;
let busy = false;
let relayReady = null;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const raw = urlInput.value.trim();
  if (!raw || busy) return;
  const format = form.elements.format.value === "mp3" ? "mp3" : "mp4";
  run(normalizeUrl(raw), format);
});

globalThis.reportLog = (line) => {
  console.log(line);
};

globalThis.reportProgress = (status, done, total) => {
  console.log(status, done, total);
};

function setBusy(value) {
  busy = value;
  runButton.disabled = value;
  urlInput.disabled = value;
  for (const input of formatInputs) input.disabled = value;
  progress.hidden = !value;
  if (value) bar.getAnimations?.().forEach((animation) => animation.play());
}

function showSteps(status) {
  checkpoints.replaceChildren();
  for (const item of checkpointItems(status)) {
    const line = document.createElement("li");
    line.dataset.state = item.state;
    line.textContent = `${item.step} ${item.state === "pass" ? "pass" : "失敗"}`;
    checkpoints.append(line);
  }
}

function resetSave() {
  if (saveUrl) URL.revokeObjectURL(saveUrl);
  saveUrl = null;
  saveLink.removeAttribute("href");
  saveLink.download = "";
  saveName.textContent = "";
  saveRow.hidden = true;
}

function offerSave(bytes, filename, type) {
  const blob = new Blob([bytes], { type });
  saveUrl = URL.createObjectURL(blob);
  saveLink.href = saveUrl;
  saveLink.download = filename;
  saveName.textContent = filename;
  saveRow.hidden = false;
}

function ensureRelay() {
  if (!relayReady) {
    relayReady = (async () => {
      const nativeFetch = globalThis.fetch.bind(globalThis);
      const on = await probeRelay(nativeFetch);
      if (!on) return false;
      const origin = location.origin;
      globalThis.fetch = createRelayFetch(nativeFetch, origin);
      if (typeof globalThis.XMLHttpRequest === "function") {
        globalThis.XMLHttpRequest = wrapXMLHttpRequest(globalThis.XMLHttpRequest, origin);
      }
      return true;
    })();
  }
  return relayReady;
}

ensureRelay();

function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = startRuntime().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

async function startRuntime() {
  await ensureRelay();
  await loadScript(`${PYODIDE_BASE}pyodide.js`);
  const pyodide = await globalThis.loadPyodide({
    indexURL: PYODIDE_BASE,
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
  });
  await pyodide.loadPackage("requests");
  await pyodide.loadPackage("micropip");
  const micropip = pyodide.pyimport("micropip");
  await micropip.install("yt-dlp==2026.10.26");
  await pyodide.runPythonAsync(RUNTIME_SOURCE);
  const ffmpegModule = await import(new URL("ffmpeg/index.js", vendor).href);
  const ffmpeg = new ffmpegModule.FFmpeg();
  ffmpeg.on("log", ({ message }) => console.log(message));
  const coreBase = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm/";
  await ffmpeg.load({
    coreURL: await blobUrl(`${coreBase}ffmpeg-core.js`, "text/javascript"),
    wasmURL: await blobUrl(`${coreBase}ffmpeg-core.wasm`, "application/wasm"),
  });
  return { pyodide, ffmpeg };
}

async function blobUrl(url, type) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch failed: ${response.status} ${url}`);
  const blob = new Blob([await response.arrayBuffer()], { type });
  return URL.createObjectURL(blob);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.crossOrigin = "anonymous";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`script failed: ${src}`));
    document.head.appendChild(script);
  });
}

async function run(url, format) {
  const status = {};
  setBusy(true);
  resetSave();
  showSteps(status);
  try {
    let runtime;
    try {
      runtime = await loadRuntime();
      status.読み込み = "pass";
      showSteps(status);
    } catch (error) {
      fail(status, "読み込み", error);
      return;
    }

    let extracted;
    try {
      extracted = await extract(runtime.pyodide, url);
      if (!extracted.formats.length) throw new Error("no formats");
      status.情報取得 = "pass";
      showSteps(status);
    } catch (error) {
      fail(status, "情報取得", error);
      return;
    }

    let media;
    try {
      const chosen = chooseFormats(extracted.formats, format);
      if (!chosen.length) throw new Error("no matching format");
      media = await fetchMedia(runtime.pyodide, url, chosen);
      status.ダウンロード = "pass";
      showSteps(status);
    } catch (error) {
      fail(status, "ダウンロード", error);
      return;
    }

    try {
      const bytes = await convert(runtime.ffmpeg, media, format);
      status.変換 = "pass";
      showSteps(status);
      offerSave(
        bytes,
        downloadName(extracted.id || extracted.title, format),
        format === "mp3" ? "audio/mpeg" : "video/mp4",
      );
    } catch (error) {
      fail(status, "変換", error);
    }
  } finally {
    setBusy(false);
  }
}

function fail(status, step, error) {
  status[step] = "fail";
  showSteps(status);
  console.error(error);
}

async function extract(pyodide, url) {
  pyodide.globals.set("TARGET_URL", url);
  return toPlain(await pyodide.runPythonAsync("run_extract(TARGET_URL)"));
}

async function fetchMedia(pyodide, url, chosen) {
  pyodide.globals.set("TARGET_URL", url);
  pyodide.globals.set("TARGET_SPEC", JSON.stringify(chosen.map((item) => ({
    format_id: item.formatId,
    kind: item.kind,
  }))));
  const fetched = toPlain(await pyodide.runPythonAsync("run_fetch(TARGET_URL, TARGET_SPEC)"));
  return (fetched.files || []).map((file) => {
    const read = pyodide.FS.readFile(file.path);
    return {
      name: `${file.kind}.${file.ext || "bin"}`,
      kind: file.kind,
      ext: file.ext || "",
      bytes: new Uint8Array(read),
    };
  });
}

async function convert(ffmpeg, files, format) {
  for (const file of files) await ffmpeg.writeFile(file.name, file.bytes);
  let code = await ffmpeg.exec(ffmpegArgs(files, format), 300000);
  if (code !== 0 && ffmpegArgs(files, format).includes("copy")) {
    code = await ffmpeg.exec(ffmpegArgs(files, format, "transcode"), 300000);
  }
  if (code !== 0) throw new Error(`ffmpeg exit ${code}`);
  const data = await ffmpeg.readFile(outputName(format));
  const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
  return new Uint8Array(bytes);
}

function toPlain(value) {
  if (value && typeof value.toJs === "function") {
    return value.toJs({ dict_converter: Object.fromEntries });
  }
  return value;
}

const RUNTIME_SOURCE = `
import json
import os
import yt_dlp
from js import reportLog

DOWNLOAD_DIR = "/downloads"

class _Log:
    def debug(self, msg):
        text = str(msg)
        if text.startswith("[debug] "):
            return
        reportLog(text)

    def info(self, msg):
        reportLog(str(msg))

    def warning(self, msg):
        reportLog("warning: " + str(msg))

    def error(self, msg):
        reportLog("error: " + str(msg))

def _options(outtmpl, format_id):
    options = {
        "quiet": True,
        "no_warnings": False,
        "noprogress": True,
        "noplaylist": True,
        "restrictfilenames": True,
        "outtmpl": outtmpl,
        "nopart": True,
        "continuedl": False,
        "overwrites": True,
        "retries": 0,
        "fragment_retries": 0,
        "extractor_retries": 0,
        "socket_timeout": 45,
        "logger": _Log(),
    }
    if format_id:
        options["format"] = format_id
    return options

def _formats(info):
    found = info.get("formats") or []
    if found:
        return found
    if info.get("url"):
        return [info]
    return []

def run_extract(url):
    with yt_dlp.YoutubeDL(_options(DOWNLOAD_DIR + "/%(id)s.%(ext)s", "")) as ydl:
        info = ydl.extract_info(url, download=False) or {}
    kind = info.get("_type") or "video"
    if kind in ("playlist", "multi_video"):
        raise yt_dlp.utils.DownloadError("playlist")
    formats = []
    for item in _formats(info):
        formats.append({
            "format_id": str(item.get("format_id") or ""),
            "ext": item.get("ext") or "",
            "vcodec": item.get("vcodec") or "none",
            "acodec": item.get("acodec") or "none",
            "height": int(item.get("height") or 0),
            "abr": float(item.get("abr") or 0),
            "tbr": float(item.get("tbr") or 0),
            "filesize": int(item.get("filesize") or item.get("filesize_approx") or 0),
        })
    return {
        "id": str(info.get("id") or ""),
        "title": info.get("title") or "",
        "formats": formats,
    }

def run_fetch(url, spec_json):
    spec = json.loads(spec_json)
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    for name in os.listdir(DOWNLOAD_DIR):
        path = os.path.join(DOWNLOAD_DIR, name)
        if os.path.isfile(path):
            os.remove(path)
    files = []
    for item in spec:
        kind = str(item.get("kind") or "file")
        outtmpl = DOWNLOAD_DIR + "/" + kind + ".%(ext)s"
        with yt_dlp.YoutubeDL(_options(outtmpl, str(item.get("format_id") or ""))) as ydl:
            ydl.download([url])
        matches = []
        for name in os.listdir(DOWNLOAD_DIR):
            if not name.startswith(kind + ".") or name.endswith(".part"):
                continue
            path = os.path.join(DOWNLOAD_DIR, name)
            if os.path.isfile(path) and os.path.getsize(path) > 0:
                matches.append(path)
        if not matches:
            raise yt_dlp.utils.DownloadError("empty file")
        path = matches[0]
        files.append({
            "path": path,
            "kind": kind,
            "ext": os.path.splitext(path)[1].lstrip("."),
            "size": os.path.getsize(path),
        })
    return {"files": files}
`;
