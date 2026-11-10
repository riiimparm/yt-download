#!/bin/sh
# Copy the files the browser loads into dist/assets.
# Terraform's assets.directory walk does not read .assetsignore, so the
# Worker must not be pointed at the repository root.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
dest="$root/dist/assets"
rm -rf "$dest"
mkdir -p "$dest/worker"
cp "$root/index.html" "$root/app.js" "$root/style.css" "$root/normalize-url.mjs" "$root/relay-client.mjs" "$root/checkpoints.mjs" "$root/convert-plan.mjs" "$dest/"
cp "$root/worker/index.mjs" "$dest/worker/index.mjs"
# JavaScript only. A declaration with the same bytes shares the asset hash
# and can be stored as text/vnd.trolltech.linguist.
if [ -d "$root/vendor/ffmpeg" ]; then
  mkdir -p "$dest/vendor/ffmpeg"
  find "$root/vendor/ffmpeg" -type f \( -name '*.js' -o -name '*.mjs' \) -exec cp {} "$dest/vendor/ffmpeg/" \;
fi
