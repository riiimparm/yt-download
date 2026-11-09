#!/bin/sh
# Copy the files the browser loads into dist/assets.
# Terraform's assets.directory walk does not read .assetsignore, so the
# Worker must not be pointed at the repository root.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
dest="$root/dist/assets"
rm -rf "$dest"
mkdir -p "$dest/worker"
cp "$root/index.html" "$root/app.js" "$root/style.css" "$root/normalize-url.mjs" "$root/relay-client.mjs" "$dest/"
cp "$root/worker/index.mjs" "$dest/worker/index.mjs"
