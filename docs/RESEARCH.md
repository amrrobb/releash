# Releash: research notes (Sat 3 Oct 2026, ~12:20 JST)

All facts below were checked against a live RPC/API call or an official doc on this date. Sources inline.

## BLOCKERS FOR HUMAN

1. **Fund the deployer, in a browser.** Address `0x6319d8d5737F93365b7F1922ceAeAfF4704C0e23` (key in `.env.deployer`, gitignored). Balance on 46630 is 0. No faucet works from curl:
   - Official: https://faucet.testnet.chain.robinhood.com/ is behind a Vercel bot challenge (`x-vercel-mitigated: challenge`, HTTP 429 to every curl, including `/api/*`). Open it in a browser, paste the address. It also hands out test stock tokens.
   - Alchemy: https://www.alchemy.com/faucets/robinhood-testnet gives 0.1 ETH / 24 h, no login, but the **receiving wallet needs ≥ 0.001 ETH on Ethereum mainnet** plus mainnet history. A fresh key fails this; use the official faucet, or claim to a personal wallet and send it on.
   - Chainstack MCP faucet (`request_testnet_funds`, `network="robinhood"`, up to 1 ETH) needs a Chainstack API key; none found on disk.
   - 0.1 ETH is far more than needed (gas price 0.01 gwei).
2. **OpenRouter credit is ~$0.96.** The only key found (see §3) shows `total_credits 13`, `total_usage 12.04`. Jev costs almost nothing (one decision = $0.0000186), but Claude fallback calls will drain $0.96 fast. Top up, or keep Claude to a few calls.
3. **Jev is not a chat model.** The handoff's "Jev decides, Claude fallback, one key" is right on the key, wrong on the API: Jev only answers on `POST /api/alpha/decisions`, not `/chat/completions` (see §3). The agent code must be written for that shape.
4. **Deadline is later than the handoff assumed, keep the 15:00 JST target anyway.** HackQuest stores `submissionClose` as `2026-10-04T15:59:00.000Z` (UTC) = **Mon 5 Oct 00:59 JST**. The handoff read "15:59" as JST. Submitting by Sun 15:00 JST leaves ~10 h of slack, do not plan to use it.
5. **A video is mandatory.** HackQuest blocks submission of a BUIDL without at least one video ("Video Required", "Has At Least One Video"); YouTube link. No max length is stated on this hackathon's page.
6. **World ID staging token** must be (re)opened in the Developer Portal for the demo window if using the simulator (Leash's note: "Staging proofs verify only inside a window opened on the portal"). Leash's `.env` has `WORLD_APP_ID, WORLD_RP_ID, WORLD_RP_SIGNING_KEY, WORLD_VERIFY_URL, WORLD_STAGING_TOKEN, WORLD_CREDENTIALS` and can be reused if the app is still the right one.

## 1. Robinhood Chain testnet

| Fact | Value | Source |
| --- | --- | --- |
| Chain ID | **46630** (`eth_chainId` → `0xb626`, live) | curl to public RPC; https://docs.robinhood.com/chain/connecting |
| Public RPC | `https://rpc.testnet.chain.robinhood.com` | same |
| Alchemy RPC | `https://robinhood-testnet.g.alchemy.com/v2/{API_KEY}` (ws: `wss://…`) | same |
| Sequencer | `https://sequencer.testnet.chain.robinhood.com`, feed `wss://feed.testnet.chain.robinhood.com` | same |
| Explorer | https://explorer.testnet.chain.robinhood.com (**Blockscout**; `/api/v2/stats` and `/api?module=…` both answer) | live curl |
| Gas token | ETH | https://docs.robinhood.com/chain/ |
| Gas price | `eth_gasPrice` = 0.01 gwei (Blockscout: slow 0.01 / avg 0.02) | live |
| Block time | ~0.14 s: 50 blocks in 7 s wall time (127905982 → 127906032); Blockscout `average_block_time` 141 ms. Arbitrum-style, blocks are cheap, `block.timestamp` has 1 s resolution. | live |
| Settles to | Ethereum Sepolia | https://www.datawallet.com/crypto/get-robinhood-chain-testnet-tokens |
| Mainnet (for README) | chain 4663, `https://rpc.mainnet.chain.robinhood.com`, https://robinhoodchain.blockscout.com | docs connecting page; `cast chain-id` live |

**Verify (Blockscout, no API key):**

```bash
forge verify-contract <ADDR> src/ReleashVault.sol:ReleashVault \
  --chain-id 46630 \
  --rpc-url https://rpc.testnet.chain.robinhood.com \
  --verifier blockscout \
  --verifier-url https://explorer.testnet.chain.robinhood.com/api/
# or at deploy time: forge script ... --broadcast --verify --verifier blockscout --verifier-url <same>
```

Robinhood's own doc shows exactly this form for mainnet (`--chain-id 4663 --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/`), https://docs.robinhood.com/chain/deploy-smart-contracts. Testnet URL is the testnet explorer's `/api/` (confirmed it serves the Etherscan-compatible API). Not yet exercised end to end (no funded key).

**Fork-ability:** the public RPC is **not an archive node**. State at head−10,000 blocks (~25 min) reads fine; head−25,000 (~1 h) returns `historical state … is not available`. So `anvil --fork-url` works only from a recent block, and a fork session older than ~30–60 min will start failing on uncached reads. For tests use mocks (the plan already does) or fork at latest and keep sessions short; never pin `--fork-block-number` to an old block.

**Faucets:** see Blockers #1.

### Integration targets (for README)

Mainnet (4663), every address verified with `cast call` against `https://rpc.mainnet.chain.robinhood.com` today:

| Asset | Address | On-chain check | Source |
| --- | --- | --- | --- |
| USDG (Paxos, token) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | symbol USDG, 6 decimals, supply 700.4M | https://docs.paxos.com/guides/stablecoin/usdg/mainnet ; https://docs.robinhood.com/chain/contracts |
| USDG OFT (LayerZero) | `0x0d54755f5106BfdB43f7a35f5D49a23F940628d1` | not checked | https://docs.paxos.com/guides/stablecoin/usdg/mainnet |
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | symbol WETH | https://docs.robinhood.com/chain/contracts |
| NVDA stock token | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEc` | name "NVIDIA • Robinhood Token", NVDA, 18 decimals | address from https://insumermodel.substack.com/p/verify-tokenized-stock-holdings-on ; the official list at https://docs.robinhood.com/chain/contracts renders client-side, so the on-chain name is the confirmation |
| Chainlink NVDA/USD | `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15` | description "RHNVDA / USD", 8 dec, answer 234.99711907, heartbeat 86400, market hours `us_equities_24/5` | https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json (data behind https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood) |
| Chainlink TSLA/USD | `0x4A1166a659A55625345e9515b32adECea5547C38` | 8 dec, 24/5 | same |
| Chainlink USDG/USD | `0x61B7e5650328764B076A108EFF5fa7282a1B9aD2` | "USDG / USD", 1.00005000 | same |
| Chainlink ETH/USD | `0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9` | 8 dec | same |
| syrupUSDG/USDG rate | `0xDd194C66aDcb422F188a04434e4824D70c151cF0` | 18 dec | same |

**Pitch evidence, live today:** the NVDA/USD feed's `updatedAt` is 1790960839, about **10.2 hours before** the read (Sat 3 Oct, US market closed). The weekend price freeze in the problem statement is directly observable on mainnet. Re-read it at recording time for the video.

Testnet (46630):

| Asset | Address | Notes | Source |
| --- | --- | --- | --- |
| **USDG (Paxos, real testnet token)** | `0x7E955252E15c84f5768B83c41a71F9eba181802F` | "Global Dollar", USDG, 6 decimals, supply 57.3M, verified on Blockscout | https://docs.paxos.com/guides/stablecoin/usdg/testnet |
| USDG supply control | `0x4549bb98c667aAb626627C118102c28065E8f54C` | has code | same |
| Faucet stock tokens | TSLA `0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E`, AMZN `0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02`, PLTR `0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0`, AMD `0x71178BAc73cBeb415514eB542a8995b82669778d` | same creator `0x2DD5b0Ea…e5Da`, same proxy impl, identical supply, 225k–291k holders each, i.e. the official faucet's tokens. 18 decimals. | Blockscout search + `/api/v2/addresses` |
| NVDA on testnet | **no official one.** Many community "NVDA" tokens exist (e.g. `0x2C00…37BA`, 1,008 holders, other creator). | | Blockscout search |
| Chainlink feeds on testnet | **none listed** (`feeds-robinhood-testnet.json` etc. 404) | | Chainlink directory |

Decision input: the plan's MockUSDG could be swapped for the **real testnet USDG** if the deployer can obtain some (Paxos faucet https://faucet.paxos.com/ is the documented source; whether it lists Robinhood testnet could not be confirmed without a browser). That is the strongest way to earn the "extra consideration for Paxos USDG" line in the judging criteria. If it cannot be obtained in time, keep MockUSDG and list the real testnet address as the integration target. A rNVDA mock remains necessary (no official testnet NVDA, no testnet feeds).

## 2. Deployer key

- Generated with `cast wallet new`, written straight to `/Users/ammar.robb/Documents/Web3/hackathons/arbitrum-openhose/.env.deployer` (mode 600, `DEPLOYER_PK=` / `DEPLOYER_ADDRESS=`) before any other use. `git check-ignore` confirms `.gitignore:1:.env*` covers it.
- **Address: `0x6319d8d5737F93365b7F1922ceAeAfF4704C0e23`**
- **Funded: no** (balance 0 on 46630). See Blockers #1.

## 3. OpenRouter: Jev and Claude

Model list: `GET https://openrouter.ai/api/v1/models` (466 models today).

**Jev exists, but in two forms:**

| Slug | What it is | Endpoint |
| --- | --- | --- |
| `typesafe/jev-1.13` (alias **`~typesafe/jev-latest`**) | Jev itself, TypeSafe's first System One model. A **decision model, not an LLM**: you send `state` + typed `questions` (`choice`, `noul` = yes/no probability, `score`), it returns probabilities and confidence. No text, no reasoning. 32k context. Input $0.042 / M tokens, output free. Not in `/api/v1/models`. | **`POST https://openrouter.ai/api/alpha/decisions`** (also `POST /api/v1/systemone` for the TypeSafe SDK) |
| `typesafe/jev-router` | A router that uses Jev to pick another model per request. Our test call was answered by `openai/gpt-6-luna`, **so calling this is not "using Jev" in any demo-claimable sense.** | `/api/v1/chat/completions` |

Calling `~typesafe/jev-latest` on chat/completions returns: `"is a decisions model and cannot be used with the chat/completions endpoint. Use the /api/alpha/decisions endpoint instead."`

Live test with a Releash-shaped question (worked, 0.5 s, $0.0000186):

```json
POST /api/alpha/decisions
{"model":"~typesafe/jev-latest",
 "state":{"health_factor":1.08,"liquidation_threshold":1.0,"market":"closed (weekend)","nvda_move_24h":"-9%","borrow_authority_remaining":"12%"},
 "questions":{"action":{"type":"choice","instructions":"What should the loan agent do now?",
   "criteria":{"hold":"Position is safe; do nothing.","deleverage_10":"Repay 10% of debt; moderate risk.",
               "deleverage_30":"Repay 30% of debt; liquidation is close.","borrow_more":"Position is very safe and user wants leverage."}}}}
→ {"model":"typesafe/jev-1.13-20260917","provider":"TypeSafe",
   "answers":{"action":{"type":"choice","choice":"deleverage_30","confidence":0.44,
     "probabilities":{"deleverage_30":0.59,"deleverage_10":0.28,"hold":0.13,"borrow_more":0}}},
   "usage":{"input_tokens":443,"cost":0.000018606}}
```

This fits Releash well: a `choice` over {hold, deleverage_10, deleverage_30, borrow_more} maps 1:1 to the contract's discrete actions, and the probabilities/confidence are a natural "low confidence → fall back to Claude / do the safe thing" gate. Sources: https://openrouter.ai/docs/guides/community/jev , https://openrouter.ai/docs/guides/community/jev-tutorial , cookbook "Gate Agent Tool Calls with Jev" linked from the hub.

**Claude slugs (chat/completions):** `anthropic/claude-sonnet-5.5` ($2 / $10 per M), `anthropic/claude-haiku-4.5` ($1 / $5), `anthropic/claude-opus-5.5`; aliases `~anthropic/claude-sonnet-latest`, `~anthropic/claude-haiku-latest`. Haiku 4.5 is the newest Haiku listed.

**Key on disk: yes.** `/Users/ammar.robb/Documents/Web3/HungerNads/monorepo/.env` (`OPENROUTER_API_KEY`). Valid (`/api/v1/key` OK, not free tier); **~$0.96 credit left** (`/api/v1/credits`: 13 total, 12.04 used). No other `.env` under `~/Documents/Web3` (maxdepth 4) contains `OPENROUTER` or `sk-or-`.

## 4. HackQuest: Arbitrum Open House Singapore, Online Buildathon

Source: https://www.hackquest.io/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon (raw page data).

- **Deadline:** `submissionClose: 2026-10-04T15:59:00.000Z` → **Sun 4 Oct 15:59 UTC = Mon 5 Oct 00:59 JST.** Registration closes one minute earlier (15:58 UTC). Rewards `2026-10-12T06:00Z`.
- **Tracks:** Overall 70k USDC (40/20/10k; ≥1 of 3 reserved for Robinhood Chain, ≥1 for Arbitrum), Promising Products 15k (7/5/3k; "frontier territory such as AI agents and new financial primitives"), Grants up to 30k (milestone-based, discretionary). Prizes are "subject to development-tied milestones" (T&C).
- **Judging:** must be deployed on an Arbitrum chain (Robinhood Chain testnet listed as a supported network). Smart contract quality; product-market fit; innovation and creativity; real problem solving. "Extra consideration is given to projects integrating Paxos' USDG stablecoin."
- **Existing projects:** allowed ("Bring an existing project or start from scratch"). If the repo predates the event, you must explain which code was produced during the Buildathon; structured commits help. Stealth repos can invite `github.com/engineering-AF`.
- **Submission form, all mandatory:**
  1. Link to frontend/UI/website or demo.
  2. Core contract addresses, one per line, format `Robinhood Chain: 0x… — label`.
  3. Factory/pool contracts (or `N/A`).
  4. Token contract addresses (or `N/A`) → list MockUSDG, rNVDA (and real USDG if used).
  5. Which parts of the code were produced during the Buildathon.
  6. Sponsor tech used (checkboxes include "Robinhood Chain", "Paxos/USDG", "OpenZeppelin", "Alchemy").
  7. Contract Address field.
  8. Profile: email, Telegram, GitHub, Twitter mandatory; LinkedIn optional.
- **Video:** HackQuest requires at least one video on the BUIDL to submit (Pitch Video and/or Demo Video, YouTube link). **No maximum length stated** for this hackathon. A project in several hackathons needs a separate version per hackathon with the video re-uploaded.
- **Pitch deck:** not a required field.

## 5. World ID (IDKit v4): confirm vs Leash

Leash (`ETHGlobalTokyo/leash/backend/src/world.js`, `config.js`, `docs/WORLD-DEBRIEF.md`) used: `@worldcoin/idkit-core ^4.3.0`; server-signed `rp_context` (`rp_id`, nonce, created/expires, signature); IDKit result forwarded **untouched** to `POST {verifyUrl}/{rp_id}` with `verifyUrl = https://developer.worldcoin.org/api/v4/verify`; header `x-staging-verification-token` only on staging proofs; simulator only completes a single `proof_of_human` request with `allow_legacy_proofs: false`.

Status today:
- **Still current.** `@worldcoin/idkit-core` latest on npm is **4.3.0** (published 19 Sep 2026), same as Leash.
- **Verify endpoint unchanged:** `POST https://developer.world.org/api/v4/verify/{rp_id}`; docs list `developer.worldcoin.org` as the legacy domain and `staging-developer.worldcoin.org` as staging. All three answer live today (dummy payload → `400 validation_error "At least one response item is required"`). Docs: "Forward the complete IDKit result without remapping response identifiers". The **v2** endpoint is only for apps not migrated to 4.0, so do not use v2. Source: https://docs.world.org/world-id/reference/api
- Change to make: default `WORLD_VERIFY_URL` to `https://developer.world.org/api/v4/verify` (the old domain still works).
- **Simulator for demos:** works per Leash's debrief (2 weeks ago), with these constraints: single `proof_of_human` request, no legacy; staging token window must be open; the simulator returns the **same nullifier for every identity**, so "a second human is refused" cannot be shown live. Not re-tested end to end today (needs the portal session).
- Releash-specific: the handoff design (backend verifies, then signs an EIP-712 grant the contract checks) needs no on-chain World verifier, so the absence of a World ID router on Robinhood Chain is not a problem. Disclose the backend signer as a trust assumption (already in the handoff).
