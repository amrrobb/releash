#!/usr/bin/env bash
# deploy/agents.sh start|stop|status|logs
# start: agent loop + liquidator + keeper tick on the VPS. They send from AGENT_PK, LIQUIDATOR_PK
# and KEEPER_PK: make sure no other machine runs them with the same keys (nonce collisions).
source "$(dirname "$0")/common.sh"
case "${1:-status}" in
  start)  ssh_vps "cd $REMOTE && docker compose --profile agents up -d loop liquidator keeper && docker compose --profile agents ps" ;;
  stop)   ssh_vps "cd $REMOTE && docker compose --profile agents stop loop liquidator keeper" ;;
  status) ssh_vps "cd $REMOTE && docker compose --profile agents ps -a" ;;
  logs)   ssh_vps "cd $REMOTE && docker compose --profile agents logs --tail=${TAIL:-100} ${2:-loop liquidator keeper}" ;;
  *) echo "usage: $0 start|stop|status|logs [service]" >&2; exit 1 ;;
esac
