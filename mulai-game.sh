#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js belum terpasang. Install dulu dari https://nodejs.org (versi LTS)."; exit 1; }
[ -d node_modules ] || npm install
npm start
