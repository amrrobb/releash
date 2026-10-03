# Releash hosting (Contabo VPS, behind Coolify's Traefik)

| | URL | Container |
|---|---|---|
| Web (static Vite build, nginx) | https://releash.robbyn.xyz | `releash-web` |
| Backend (port 8787, chain 46630, `DEMO_ENABLED=1`, `WORLD_SIMULATE=1`) | https://releash-api.robbyn.xyz | `releash-backend` |
| Agent loop / liquidator / keeper tick | none (outbound only) | `releash-loop`, `releash-liquidator`, `releash-keeper` (profile `agents`; `up -d` does not start them, `deploy/agents.sh start` does. Running since 3 Oct 04:01 UTC) |

Everything lives in `/opt/releash` on `root@77.237.243.126`. It is plain `docker compose`, not a Coolify app. The containers join the external `coolify` network, and Coolify's Traefik routes them by label and issues Let's Encrypt certificates. DNS is two Cloudflare A records pointing at `77.237.243.126`. They are DNS-only (not proxied), the same as `leash` and `envoyage`.

```
/opt/releash/
  docker-compose.yml   (from deploy/)
  .env.releash         chmod 600: .env.46630 + OPENROUTER_API_KEY + WATCH. Never in git.
  src/                 rsync'd build context (backend, agent, deployments, deploy/Dockerfile)
  web/html/            built web bundle; web/nginx.conf
  data/                shared volume at /data, owned by uid 1000 (node):
                       log.46630.jsonl, market.46630.json, releash-46630.db
```

The backend and every agent run from one image (`releash-node`, built from `deploy/Dockerfile`), and all of them share `/data`. The agent writes `log.46630.jsonl` and the keeper writes `market.46630.json`. The backend reads both and also serves the demo routes, which drive the keeper and agent code in-process.

All scripts run from the laptop, from any directory. They need `~/.ssh/id_ed25519`.

## Redeploy

```bash
deploy/web.sh        # build web/ with web/.env.production(+.local) into a temp dir, upload. Live at once.
deploy/backend.sh    # rsync source, rebuild the image, restart backend (and any agents already running)
deploy/env.sh        # rebuild /opt/releash/.env.releash from .env.46630 + agent/.env; then deploy/backend.sh
```

`web/.env.production` and `web/.env.production.local` are gitignored and exist only on this laptop, so the web build always runs locally.

## Agents (loop, liquidator, keeper tick)

They send from `AGENT_PK`, `LIQUIDATOR_PK` and `KEEPER_PK`. **Never run them here while the same keys run anywhere else**, because two senders on one key collide on nonces. Stop the laptop processes first.

```bash
deploy/agents.sh start     # docker compose --profile agents up -d loop liquidator keeper
deploy/agents.sh stop      # stops only the three agents; web and backend stay up
deploy/agents.sh status
deploy/agents.sh logs [loop|liquidator|keeper]
```

`WATCH` is the web demo account (`VITE_DEMO_PK`), then Alice, then Control. `deploy/env.sh` derives it from the keys.

Do not use `docker compose --profile agents down`. It also removes web and backend.

## Logs and checks

```bash
ssh -i ~/.ssh/id_ed25519 root@77.237.243.126
cd /opt/releash
docker compose logs -f --tail=100 backend      # or web; agents: --profile agents logs -f loop
docker compose ps
curl -s https://releash-api.robbyn.xyz/api/health   # {"ok":true,"chainId":46630,"vault":"0xD346…",...}
curl -s https://releash-api.robbyn.xyz/api/market
```

Never run `docker compose config` or `docker inspect` on these containers in a shared terminal. Both print every secret in the environment.

## Notes

- **Do not press the hosted demo buttons (Friday close, Monday gap, Agent tries, Reset) while the laptop demo runs with the same keys.** They send from the keeper, agent, Alice and Control keys, and two senders on one key collide on nonces.
- The backend's demo routes (`/api/demo/*`, gated by `x-demo-key`) send from the keeper, Alice and Control keys. The hosted web bundle contains `VITE_DEMO_KEY` and the demo account key. Treat both as public, testnet dust only.
- `market.json` on the VPS is separate from any laptop copy. The hosted "OPEN/WEEKEND" label only follows a Friday close done through the hosted backend or the hosted keeper.
- The keeper container and the backend's demo routes (close, gap, reset) both send from `KEEPER_PK` in separate processes. A demo button pressed during a keeper tick can fail one of them with `nonce too low`. The next tick recovers. If a demo beat must not fail, run `deploy/agents.sh stop` on the keeper only (`docker compose stop keeper`) for the scripted part.
- Logs rotate at 10 MB × 3 per container.
