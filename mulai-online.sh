#!/bin/sh
# Menjalankan server game + Cloudflare Tunnel (Mac / Linux)
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js belum terpasang. Install dulu dari https://nodejs.org (versi LTS)."; exit 1; }
command -v cloudflared >/dev/null || { echo "cloudflared belum terpasang. Mac: brew install cloudflared"; exit 1; }
[ -f cloudflare-token.txt ] || { echo "Simpan token tunnel di file cloudflare-token.txt (lihat docs/online-cloudflare.md)"; exit 1; }
[ -d node_modules ] || npm install
npm start &
SERVER=$!
trap 'kill $SERVER' EXIT
cloudflared tunnel --no-autoupdate run --token "$(tr -d ' \r\n' < cloudflare-token.txt)"
