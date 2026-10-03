#!/usr/bin/env bash
# Sends gas money from the deployer to the demo actors on Robinhood testnet (46630).
#   script/fund-actors.sh               DRY RUN: prints balances and the transfers it would send
#   script/fund-actors.sh --broadcast   sends them (gas price 0.01 gwei)
# Keys: DEPLOYER_PK from .env.deployer, actors from .env.46630 (created by script/deploy.sh 46630).
# Env: AMOUNT (default 0.002ether), RPC_URL.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
MODE="${1:---dry-run}"
AMOUNT="${AMOUNT:-0.002ether}"
RPC_URL="${RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
die() { echo "fund-actors.sh: $*" >&2; exit 1; }

[ -f .env.deployer ] || die ".env.deployer missing"
[ -f .env.46630 ] || die ".env.46630 missing: run script/deploy.sh 46630 first"
DEPLOYER_PK="$(sed -n 's/^DEPLOYER_PK=//p' .env.deployer)"
DEPLOYER="$(cast wallet address "$DEPLOYER_PK")"
[ "$(cast chain-id --rpc-url "$RPC_URL")" = "46630" ] || die "RPC is not chain 46630"

echo "deployer $DEPLOYER balance $(cast balance "$DEPLOYER" --rpc-url "$RPC_URL" --ether) ETH; sending $AMOUNT each ($MODE)"
for name in AGENT_PK KEEPER_PK ALICE_PK CONTROL_PK LIQUIDATOR_PK; do
  pk="$(sed -n "s/^$name=//p" .env.46630)"
  [ -n "$pk" ] || die "$name missing in .env.46630"
  to="$(cast wallet address "$pk")"
  bal="$(cast balance "$to" --rpc-url "$RPC_URL" --ether)"
  if [ "$(echo "$to" | tr A-F a-f)" = "$(echo "$DEPLOYER" | tr A-F a-f)" ]; then
    echo "  ${name%_PK}  $to  $bal ETH  (is the deployer, skipped)"; continue
  fi
  if [ "$MODE" = "--broadcast" ]; then
    tx="$(cast send "$to" --value "$AMOUNT" --gas-price 0.01gwei --private-key "$DEPLOYER_PK" --rpc-url "$RPC_URL" --json | jq -r .transactionHash)"
    echo "  ${name%_PK}  $to  sent $AMOUNT  tx $tx  now $(cast balance "$to" --rpc-url "$RPC_URL" --ether) ETH"
  else
    echo "  ${name%_PK}  $to  $bal ETH  -> would send $AMOUNT"
  fi
done
[ "$MODE" = "--broadcast" ] || echo "DRY RUN: nothing sent. Re-run with --broadcast once the deployer is funded."
