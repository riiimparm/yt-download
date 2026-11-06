const PYODIDE_VERSION = "314.0.7";
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const SAMPLE_URL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm";

const form = document.querySelector("#form");
const urlInput = document.querySelector("#url");
const runButton = document.querySelector("#run");
const sampleButton = document.querySelector("#sample");
const statusEl = document.querySelector("#status");
const progressWrap = document.querySelector("#progress");
const bar = document.querySelector("#bar");
const progressText = document.querySelector("#progress-text");
const errorEl = document.querySelector("#error");
const resultEl = document.querySelector("#result");
const saveButton = document.querySelector("#save");
const logEl = document.querySelector("#log");

let pyodidePromise = null;
let saveUrl = null;
let busy = false;

sampleButton.addEventListener("click", () => {
  urlInput.value = SAMPLE_URL;
  urlInput.focus();
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();
  if (!url || busy) return;
  run(url);
});

saveButton.addEventListener("click", () => {
  if (!saveUrl) return;
  const link = document.createElement("a");
  link.href = saveUrl;
  link.download = saveButton.dataset.filename || "download";
  document.body.appendChild(link);
  link.click();
  link.remove();
});

function setBusy(value) {
  busy = value;
  runButton.disabled = value;
  sampleButton.disabled = value;
  urlInput.disabled = value;
  runButton.textContent = value ? "実行中" : "実行";
}

function setStatus(text) {
  statusEl.textContent = text;
}

function appendLog(line) {
  const text = String(line ?? "").trimEnd();
  if (!text) return;
  logEl.textContent += (logEl.textContent ? "\n" : "") + text;
  logEl.scrollTop = logEl.scrollHeight;
}

function hideError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

function showError(summary, detail) {
  const cors = /Failed to fetch|CORS|Access-Control|net::ERR_FAILED/i.test(`${summary}\n${detail || ""}`);
  const head = cors
    ? "ブラウザが通信を拒否しました。相手が Access-Control-Allow-Origin を返していないため、このページからは応答を読めません。yt-dlp は起動していますが、その URL の中身は取得できません。"
    : "yt-dlp が完了しませんでした。";
  errorEl.hidden = false;
  errorEl.textContent = detail ? `${head}\n${summary}` : `${head}\n${summary}`;
}

function resetResult() {
  resultEl.hidden = true;
  if (saveUrl) {
    URL.revokeObjectURL(saveUrl);
    saveUrl = null;
  }
  saveButton.dataset.filename = "";
  document.querySelector("#extra-files").hidden = true;
}

function setProgress(done, total) {
  progressWrap.hidden = false;
  const known = Number(total) > 0;
  if (!known) {
    bar.classList.add("indeterminate");
    bar.style.width = "";
    progressText.textContent = "通信中です。バイト数は応答が届いてから分かります。";
    return;
  }
  bar.classList.remove("indeterminate");
  const ratio = Math.max(0, Math.min(1, Number(done) / Number(total)));
  bar.style.width = `${Math.round(ratio * 100)}%`;
  progressText.textContent = `${formatBytes(done)} / ${formatBytes(total)}`;
}

function formatBytes(value) {
  const n = Number(value) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

globalThis.reportLog = (line) => {
  appendLog(line);
};

globalThis.reportProgress = (status, done, total) => {
  if (status === "downloading" || status === "finished") {
    setStatus(status === "finished" ? "ダウンロードが完了しました。" : "ダウンロードしています。");
    setProgress(done, total);
  }
};

async function loadRuntime() {
  if (!pyodidePromise) {
    pyodidePromise = startRuntime().catch((error) => {
      pyodidePromise = null;
      throw error;
    });
  }
  return pyodidePromise;
}

async function startRuntime() {
  setStatus("Pyodide を読み込んでいます。");
  appendLog(`Pyodide ${PYODIDE_VERSION} を読み込みます。`);
  await loadScript(`${PYODIDE_BASE}pyodide.js`);
  const pyodide = await globalThis.loadPyodide({
    indexURL: PYODIDE_BASE,
    stdout: (line) => appendLog(line),
    stderr: (line) => appendLog(line),
  });
  setStatus("requests を読み込んでいます。");
  await pyodide.loadPackage("requests");
  setStatus("yt-dlp をインストールしています。");
  appendLog("micropip で yt-dlp をインストールします。");
  await pyodide.loadPackage("micropip");
  const micropip = pyodide.pyimport("micropip");
  await micropip.install("yt-dlp==2026.10.26");
  await pyodide.runPythonAsync(RUNTIME_SOURCE);
  const version = pyodide.runPython("import yt_dlp; yt_dlp.version.__version__");
  appendLog(`yt-dlp ${version} を読み込みました。`);
  return pyodide;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`スクリプトを読み込めません: ${src}`));
    document.head.appendChild(script);
  });
}

async function run(url) {
  setBusy(true);
  hideError();
  resetResult();
  progressWrap.hidden = true;
  bar.classList.remove("indeterminate");
  bar.style.width = "0%";
  appendLog(`--- ${url}`);
  try {
    const pyodide = await loadRuntime();
    setStatus("yt-dlp で情報を抽出しています。");
    setProgress(0, 0);
    pyodide.globals.set("TARGET_URL", url);
    const raw = await pyodide.runPythonAsync("run_download(TARGET_URL)");
    const info = toPlain(raw);
    if (!info || !info.path || !info.size) {
      throw new Error("保存できるファイルが返りませんでした。");
    }
    const bytes = pyodide.FS.readFile(info.path);
    if (!bytes || bytes.byteLength !== info.size) {
      throw new Error(`読み出したサイズが一致しません（${bytes ? bytes.byteLength : 0} / ${info.size}）。`);
    }
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    saveUrl = URL.createObjectURL(blob);
    saveButton.dataset.filename = info.filename;
    document.querySelector("#meta-title").textContent = info.title || "（なし）";
    document.querySelector("#meta-extractor").textContent = info.extractor || "（なし）";
    document.querySelector("#meta-file").textContent = info.filename;
    document.querySelector("#meta-size").textContent = formatBytes(info.size);
    const extra = document.querySelector("#extra-files");
    if (info.file_count > 1) {
      extra.hidden = false;
      extra.textContent = `${info.file_count} 個のファイルができました。いちばん大きい ${info.filename} だけ保存できます。結合はできません。`;
    } else {
      extra.hidden = true;
    }
    resultEl.hidden = false;
    progressWrap.hidden = false;
    setProgress(info.size, info.size);
    setStatus("ファイルをメモリに読みました。保存ボタンで書き出せます。");
    appendLog(`保存可能: ${info.filename} (${info.size} bytes)`);
  } catch (error) {
    const detail = errorText(error);
    appendLog(detail);
    const summary = shortError(detail);
    showError(summary, detail);
    setStatus("失敗しました。ファイルは保存できません。");
    progressWrap.hidden = true;
  } finally {
    setBusy(false);
  }
}

function toPlain(value) {
  if (value && typeof value.toJs === "function") {
    return value.toJs({ dict_converter: Object.fromEntries });
  }
  return value;
}

function errorText(error) {
  if (!error) return "不明なエラー";
  if (typeof error === "string") return error;
  return error.message || String(error);
}

function shortError(text) {
  const lines = String(text).split("\n").map((line) => line.trim()).filter(Boolean);
  const picked = [...lines].reverse().find((line) =>
    line.includes("ERROR:") || line.startsWith("DownloadError") || line.startsWith("ExtractorError") || line.includes("Failed to fetch")
  );
  return picked || lines.at(-1) || text;
}

const RUNTIME_SOURCE = `
import os
import yt_dlp
from js import reportLog, reportProgress

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

def _progress(data):
    status = data.get("status") or ""
    done = int(data.get("downloaded_bytes") or 0)
    total = int(data.get("total_bytes") or data.get("total_bytes_estimate") or 0)
    reportProgress(status, done, total)

def run_download(url):
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)
    for name in os.listdir(DOWNLOAD_DIR):
        path = os.path.join(DOWNLOAD_DIR, name)
        if os.path.isfile(path):
            os.remove(path)

    options = {
        "quiet": True,
        "no_warnings": False,
        "noprogress": True,
        "noplaylist": True,
        "restrictfilenames": True,
        "outtmpl": DOWNLOAD_DIR + "/%(id)s.%(ext)s",
        "nopart": True,
        "continuedl": False,
        "overwrites": True,
        "retries": 0,
        "fragment_retries": 0,
        "extractor_retries": 0,
        "socket_timeout": 45,
        "logger": _Log(),
        "progress_hooks": [_progress],
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True) or {}

    files = []
    for name in os.listdir(DOWNLOAD_DIR):
        path = os.path.join(DOWNLOAD_DIR, name)
        if os.path.isfile(path) and os.path.getsize(path) > 0 and not name.endswith(".part"):
            files.append(path)
    if not files:
        kind = info.get("_type") or "video"
        if kind in ("playlist", "multi_video"):
            raise yt_dlp.utils.DownloadError("プレイリストは未対応です。単体の URL を指定してください。")
        raise yt_dlp.utils.DownloadError("抽出は終わりましたが、保存できるファイルがありません。")
    files.sort(key=os.path.getsize, reverse=True)
    path = files[0]
    return {
        "path": path,
        "filename": os.path.basename(path),
        "size": os.path.getsize(path),
        "title": info.get("title") or "",
        "extractor": info.get("extractor") or "",
        "id": str(info.get("id") or ""),
        "ext": info.get("ext") or "",
        "file_count": len(files),
    }
`;
