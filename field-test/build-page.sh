#!/bin/sh
# Builds the field-test Mini App into page/dist (static files for GitHub Pages).
set -e
cd "$(dirname "$0")"
rm -rf page/dist && mkdir -p page/dist
npx esbuild page/scanner.js --bundle --format=esm --target=es2020,safari15 --minify --outfile=page/dist/scanner.js
cp page/index.html page/dist/
cp node_modules/zxing-wasm/dist/reader/zxing_reader.wasm page/dist/
ls -la page/dist
