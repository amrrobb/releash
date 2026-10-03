#!/usr/bin/env bash
# Ships backend/agent source + deployments to the VPS, rebuilds the image, restarts the backend.
# Running agent containers are recreated on the new image too (only if they are already running).
source "$(dirname "$0")/common.sh"
cd "$REPO"
ssh_vps "mkdir -p $REMOTE/src $REMOTE/web/html $REMOTE/data && chown 1000:1000 $REMOTE/data"
# Include-list: only these paths leave the laptop (never .env*, *.keys.json, node_modules).
rsync_vps --delete --relative \
  backend/package.json backend/package-lock.json backend/src \
  agent/package.json agent/package-lock.json agent/src agent/mandates.json \
  agent/loop.ts agent/liquidator.ts agent/keeper.ts agent/demo-setup.ts agent/attempt.ts \
  deployments deploy/Dockerfile "$VPS:$REMOTE/src/"
rsync_vps deploy/docker-compose.yml deploy/nginx.conf "$VPS:$REMOTE/"
ssh_vps "cd $REMOTE && mv -f nginx.conf web/nginx.conf && docker compose build backend && docker compose up -d web backend \
  && running=\$(docker compose --profile agents ps --status running --services | grep -vE '^(web|backend)\$' || true) \
  && if [ -n \"\$running\" ]; then docker compose --profile agents up -d --no-deps \$running; fi \
  && docker compose ps"
