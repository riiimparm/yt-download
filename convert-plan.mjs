export function chooseFormats(formats, target) {
  const list = Array.isArray(formats) ? formats : [];
  const hasVideo = (format) => format.vcodec && format.vcodec !== "none";
  const hasAudio = (format) => format.acodec && format.acodec !== "none";
  const progressive = list.filter((format) => hasVideo(format) && hasAudio(format));
  const videos = list.filter((format) => hasVideo(format) && !hasAudio(format));
  const audios = list.filter((format) => hasAudio(format) && !hasVideo(format));
  const byPicture = (a, b) =>
    (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0) || (b.filesize || 0) - (a.filesize || 0);
  const byAudio = (a, b) =>
    (b.abr || 0) - (a.abr || 0) || (b.tbr || 0) - (a.tbr || 0) || (b.filesize || 0) - (a.filesize || 0);

  if (target === "mp3") {
    const pool = audios.length ? audios : progressive;
    const best = [...pool].sort(byAudio)[0];
    if (best) return [choice(best, audios.length ? "audio" : "av")];
    const only = [...list].filter((format) => !hasVideo(format) && !hasAudio(format)).sort(byAudio)[0];
    return only ? [choice(only, "av")] : [];
  }

  if (progressive.length) {
    const best = [...progressive].sort((a, b) => mp4First(a, b) || byPicture(a, b))[0];
    return [choice(best, "av")];
  }
  if (videos.length && audios.length) {
    return [
      choice([...videos].sort(byPicture)[0], "video"),
      choice([...audios].sort(byAudio)[0], "audio"),
    ];
  }
  if (list.length === 1 && !hasVideo(list[0]) && !hasAudio(list[0])) return [choice(list[0], "av")];
  return [];
}

export function ffmpegArgs(files, target, mode = "auto") {
  if (target === "mp3") {
    return ["-i", files[0].name, "-vn", "-c:a", "libmp3lame", "-q:a", "2", outputName(target)];
  }
  const transcode = mode === "transcode" || !canCopy(files);
  if (!transcode) {
    return ["-i", files[0].name, "-c", "copy", "-movflags", "+faststart", outputName(target)];
  }
  if (files.length >= 2) {
    const video = files.find((file) => file.kind === "video") ?? files[0];
    const audio = files.find((file) => file.kind === "audio") ?? files[1];
    return [
      "-i", video.name,
      "-i", audio.name,
      "-map", "0:v:0",
      "-map", "1:a:0",
      ...transcodeCodecs(),
      "-movflags", "+faststart",
      "-shortest",
      outputName(target),
    ];
  }
  return ["-i", files[0].name, ...transcodeCodecs(), "-movflags", "+faststart", outputName(target)];
}

export function outputName(target) {
  return target === "mp3" ? "out.mp3" : "out.mp4";
}

export function downloadName(id, target) {
  const base = String(id || "download").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
  return `${base || "download"}.${target === "mp3" ? "mp3" : "mp4"}`;
}

function choice(format, kind) {
  return {
    formatId: format.format_id || "",
    kind,
    ext: format.ext || "",
  };
}

function mp4First(a, b) {
  return Number(b.ext === "mp4") - Number(a.ext === "mp4");
}

function canCopy(files) {
  return files.length === 1 && files[0].kind === "av" && files[0].ext === "mp4";
}

function transcodeCodecs() {
  return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k"];
}
