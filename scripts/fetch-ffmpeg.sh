#!/bin/sh
# Download the ffmpeg.wasm wrapper the page serves from its own origin.
# The core wasm stays on jsDelivr. It is about 31 MiB, and Workers assets
# reject a file larger than 25 MiB.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL "https://registry.npmjs.org/@ffmpeg/ffmpeg/-/ffmpeg-0.12.15.tgz" -o "$tmp/ffmpeg.tgz"
mkdir -p "$tmp/ffmpeg"
tar -xzf "$tmp/ffmpeg.tgz" -C "$tmp/ffmpeg" package/dist/esm
rm -rf "$root/vendor"
mkdir -p "$root/vendor"
cp -a "$tmp/ffmpeg/package/dist/esm" "$root/vendor/ffmpeg"
# index.js and index.d.ts are the same 58 bytes. The provider uploads one
# hash and sets Content-Type from the path it keeps. .d.ts is a .ts file,
# and that type is text/vnd.trolltech.linguist, so the module import fails.
find "$root/vendor/ffmpeg" -type f ! -name '*.js' ! -name '*.mjs' -delete
test -f "$root/vendor/ffmpeg/index.js"
test -f "$root/vendor/ffmpeg/worker.js"
test ! -e "$root/vendor/ffmpeg/index.d.ts"
