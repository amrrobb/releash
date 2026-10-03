#!/usr/bin/env bash
# deploy/watchdog.sh: one-shot health probe of the hosted stack. Prints the backend health JSON, the
# deployer (keeper) balance, the agent log's age, container states, and ends with __PROBE_OK__ only
# if every check passed. Silence or a missing terminator means the probe did NOT run: treat as down.
# Env: MAX_LOG_AGE (s, default 900: unchanged holds are logged every 5 min), MIN_DEPLOYER_ETH (0.001).
source "$(dirname "$0")/common.sh"
cd "$REPO"
RPC="${RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
MAX_LOG_AGE="${MAX_LOG_AGE:-900}"
MIN_ETH="${MIN_DEPLOYER_ETH:-0.001}"
fail=0
bad() { echo "FAIL: $*"; fail=1; }

# Run the HTTP and file checks on the VPS itself: no dependency on the laptop's DNS.
REMOTE_OUT="$(ssh_vps "cd $REMOTE && \
  echo HEALTH \$(curl -s -m 10 --resolve releash-api.robbyn.xyz:443:127.0.0.1 https://releash-api.robbyn.xyz/api/health) && \
  echo WEB \$(curl -s -o /dev/null -m 10 -w '%{http_code}' --resolve releash.robbyn.xyz:443:127.0.0.1 https://releash.robbyn.xyz/) && \
  echo LOGAGE \$(( \$(date +%s) - \$(stat -c %Y data/log.46630.jsonl) )) && \
  for c in releash-web releash-backend releash-loop releash-liquidator releash-keeper; do \
    echo CONTAINER \$c \$(docker inspect -f '{{.State.Status}} restart={{.HostConfig.RestartPolicy.Name}} started={{.State.StartedAt}}' \$c 2>/dev/null || echo missing); done; \
  echo REMOTE_DONE")" || bad "ssh to the VPS failed"
echo "$REMOTE_OUT" | grep -q '^REMOTE_DONE$' || bad "remote checks did not complete"

health="$(echo "$REMOTE_OUT" | sed -n 's/^HEALTH //p')"
echo "health: $health"
echo "$health" | grep -q '"ok":true' || bad "backend /api/health not ok"
web="$(echo "$REMOTE_OUT" | sed -n 's/^WEB //p')"
echo "web: HTTP $web"; [ "$web" = "200" ] || bad "web returned $web"
age="$(echo "$REMOTE_OUT" | sed -n 's/^LOGAGE //p')"
echo "agent log age: ${age}s"; [ -n "$age" ] && [ "$age" -le "$MAX_LOG_AGE" ] || bad "agent log older than ${MAX_LOG_AGE}s"
while read -r _ name status restart started; do
  echo "container: $name $status $restart $started"
  [ "$status" = "running" ] || bad "$name is $status"
  [ "$restart" = "restart=unless-stopped" ] || bad "$name has $restart"
done < <(echo "$REMOTE_OUT" | grep '^CONTAINER ')

DEPLOYER="$(jq -r .keeper deployments/46630.json)"
bal="$(cast balance "$DEPLOYER" --rpc-url "$RPC" --ether 2>/dev/null)" || bad "balance read failed"
echo "deployer $DEPLOYER: ${bal} ETH"
awk -v b="${bal:-0}" -v m="$MIN_ETH" 'BEGIN{exit !(b>=m)}' || bad "deployer below ${MIN_ETH} ETH"

[ "$fail" = 0 ] && echo "__PROBE_OK__" || { echo "__PROBE_FAILED__"; exit 1; }
