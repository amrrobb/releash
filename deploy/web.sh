#!/usr/bin/env bash
# Builds web/ with the production profile (web/.env.production + .env.production.local, both
# gitignored, on this laptop) into a scratch dir and uploads it. nginx serves it immediately.
source "$(dirname "$0")/common.sh"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
cd "$REPO/web"
npx tsc -b && npx vite build --mode production --outDir "$OUT" --emptyOutDir
grep -rqs 46630 "$OUT" || { echo "build lacks chain 46630" >&2; exit 1; }
grep -rqs releash-api.robbyn.xyz "$OUT" || { echo "build lacks backend URL" >&2; exit 1; }
# (config.ts keeps 127.0.0.1 fallbacks as literals, so their presence alone is not a failure.)
ssh_vps "mkdir -p $REMOTE/web/html"
rsync_vps --delete "$OUT/" "$VPS:$REMOTE/web/html/"
# mktemp dirs are 0700 and macOS openrsync has no --chmod: make the tree readable by nginx.
ssh_vps "chmod -R a+rX $REMOTE/web/html"
echo "web deployed: https://releash.robbyn.xyz"
