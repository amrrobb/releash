#!/usr/bin/env bash
# Builds /opt/releash/.env.releash (chmod 600) from repo-root .env.46630 + OPENROUTER_API_KEY from
# agent/.env + WATCH derived from ALICE_PK/CONTROL_PK and the hosted web's demo account
# (VITE_DEMO_PK in web/.env.production.local, the "Alice" the hosted demo strip shows). Prints no secret. Re-run after key changes,
# then `deploy/backend.sh` (or `docker compose up -d --force-recreate backend`) to apply.
source "$(dirname "$0")/common.sh"
umask 077
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
grep -E '^[A-Z_]+=' "$REPO/.env.46630" | grep -vE '^(DEMO_ENABLED|WATCH)=' > "$TMP"
grep -E '^OPENROUTER_API_KEY=' "$REPO/agent/.env" >> "$TMP" || echo "WARN: no OPENROUTER_API_KEY; agent loop will use rules only" >&2
WEB_PK="$(grep -sE '^VITE_DEMO_PK=' "$REPO/web/.env.production.local" | cut -d= -f2- || true)"
WATCH="$(cd "$REPO/agent" && set -a && . "$REPO/.env.46630" && set +a && WEB_PK="$WEB_PK" node -e '
const {privateKeyToAccount:a}=require("viem/accounts");
const w=[process.env.WEB_PK,process.env.ALICE_PK,process.env.CONTROL_PK].filter(Boolean).map(k=>a(k).address);
console.log([...new Set(w)].join(","))')"
echo "WATCH=$WATCH" >> "$TMP"
echo "WATCH=$WATCH"
ssh_vps "mkdir -p $REMOTE/data && chown 1000:1000 $REMOTE/data"
scp -q -i "$SSH_KEY" "$TMP" "$VPS:$REMOTE/.env.releash"
ssh_vps "chmod 600 $REMOTE/.env.releash && echo env keys: \$(cut -d= -f1 $REMOTE/.env.releash | tr '\n' ' ')"
