# Releash — PLAN (hour gates, JST)

Now: Sat 3 Oct 12:30. Hard stop for building: Sun 4 Oct 11:00. Submit by 15:00.

| Gate | By | Done when | If missed |
| --- | --- | --- | --- |
| G0 | Sat 13:00 | CLAUDE.md, SPEC, PLAN, research running, deployer key persisted | — |
| G1 | Sat 17:00 | Contracts + unit + invariant + e2e tests green | Drop MockPool → oracle-price deleverage against vault reserve |
| G2 | Sat 18:30 | Deployed + verified on Robinhood testnet, `deployments/46630.json` | Deploy unverified, verify later |
| G3 | Sat 23:00 | Backend (World renew) + agent loop + keeper running against testnet | Claude-only (drop Jev); World simulator only |
| G4 | Sun 05:00 | Web: position, authority meter, agent feed, demo strip, control position | Drop control position UI, show it in agent log |
| G5 | Sun 09:00 | Hosted (VPS/Coolify), full demo rehearsed twice, README with addresses | Local demo video only |
| G6 | Sun 13:00 | Video recorded, submission filled | — |

Sleep: Sat 23:30 – Sun 04:30 (agents may continue web in background).

## Cut order (first to go)
1. Claude mandate parsing (free-text mandate → params)
2. Relayer for `renew` (user submits from wallet instead)
3. Jev (Claude-only)
4. Fake market clock polish
5. Control position UI (keep it in the script/video)

Never cut: invariant tests, the on-chain "blocked by Releash" beat, deleverage-after-revoke.

## Workstreams
- **Contracts** — lead (me). Critical path.
- **Backend + agent + keeper** — specialist agent after G2 (ABI frozen and deployed).
- **Web** — specialist agent (frontend-design skill) after G2.
- **Review** — security/correctness review agents on contracts at G1.
- **Submission** — hackathon-submission skill at G5.
