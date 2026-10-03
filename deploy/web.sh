#!/usr/bin/env bash
# Builds web/ with the production profile (web/.env.production + .env.production.local, both
# gitignored, on this laptop) into a scratch dir and uploads it. nginx serves it immediately.
#
# No request ever sees a half-written site:
#  1. permissions are fixed BEFORE upload (the old post-upload chmod left a window where nginx could
#     not read freshly written 0600 files: that was the 500 on /app during a deploy);
#  2. the hashed assets go up first, without deleting anything, so the old index.html keeps working;
#  3. index.html is swapped last; rsync writes it to a temp file and renames it, which is atomic;
#  4. assets no index references any more are pruned only after a day (cached tabs keep loading).
# The html dir is a bind mount into the releash-web container, so a symlink swap of the dir itself
# would not be seen by nginx; per-file atomic renames are.
source "$(dirname "$0")/common.sh"
OUT="$(mktemp -d)"; trap 'rm -rf "$OUT"' EXIT
cd "$REPO/web"
npx tsc -b && npx vite build --mode production --outDir "$OUT" --emptyOutDir
grep -rqs 46630 "$OUT" || { echo "build lacks chain 46630" >&2; exit 1; }
grep -rqs releash-api.robbyn.xyz "$OUT" || { echo "build lacks backend URL" >&2; exit 1; }
# (config.ts keeps 127.0.0.1 fallbacks as literals, so their presence alone is not a failure.)
chmod -R a+rX "$OUT"
ssh_vps "mkdir -p $REMOTE/web/html/assets && chmod a+rx $REMOTE/web/html $REMOTE/web/html/assets"
rsync_vps -p "$OUT/assets/" "$VPS:$REMOTE/web/html/assets/"
rsync_vps -p --exclude assets "$OUT/" "$VPS:$REMOTE/web/html/"
# Prune: only files this build does not ship, and only once they are a day old.
KEEP="$(cd "$OUT/assets" && ls | tr '\n' ' ')"
ssh_vps "cd $REMOTE/web/html/assets && for f in \$(find . -maxdepth 1 -type f -mtime +1 -printf '%f '); do case ' $KEEP ' in *\" \$f \"*) ;; *) rm -f -- \"\$f\" ;; esac; done"
echo "web deployed: https://releash.robbyn.xyz"
