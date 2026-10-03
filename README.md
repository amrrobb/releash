# Releash

**Auto-deleverage for stock-backed loans on Robinhood Chain.**
Your agent can always make the loan safer. It can only add debt while you keep proving, with World ID, that you are still there.

- Live app: https://releash.robbyn.xyz · judge demo: https://releash.robbyn.xyz/demo · security: https://releash.robbyn.xyz/security · API: https://releash-api.robbyn.xyz/api/health
- Repo: https://github.com/amrrobb/releash
- Demo video: _n_
- Network: Robinhood Chain testnet (46630). All contracts verified on Blockscout.

## The problem

1. You borrow USDG against tokenized NVDA on Friday and go offline.
2. Stock oracles run 24/5. The Chainlink NVDA/USD feed on Robinhood Chain mainnet went silent for **52 hours** on each of the last three weekends, and **78 hours** over Labor Day (round history in `docs/RESEARCH.md`).
3. Monday opens with a gap. Thin on-chain liquidity turns the liquidation into a fire sale.
4. Nobody de-risked the position in the meantime. The obvious fix, an agent with full control of your loan, is a key you would never hand out, and agent permission systems that simply *expire* freeze the agent at exactly the wrong moment.

## The idea: asymmetric, decaying authority

| | Releash agent |
| --- | --- |
| Reduce risk (repay 10% or 30% of debt by selling collateral) | **Always.** Survives decay, revoke, a stale weekend price. Never needs renewal. |
| Add debt | Only up to an **authority ceiling that halves every half-life** and hits zero after three, unless you renew it with a World ID proof. Revoke stops it instantly. |
| Withdraw, move, or receive funds | **Never.** Borrowed USDG goes to the owner, never the agent. |

When you disappear, your position can only get safer. That is the property no other agent-permission design we found has: they fail *closed* on expiry, and for a leveraged loan, closed means liquidated.

The agent's brain is **Jev** (TypeSafe's decision model, via OpenRouter `/api/alpha/decisions`), asked to choose among exactly the contract's actions: `hold`, `deleverage_10`, `deleverage_30`, `borrow_more`. Claude (Haiku 4.5) is the fallback when Jev is unsure. Jev's probabilities are shown in the feed. A deterministic LTV guard runs before either model, the mandate's rules (for example the weekend LTV limit that triggers the Friday deleverage) can override the model, and **the contract is the last guard**: whatever the model says, an out-of-authority borrow reverts on-chain.

## Demo result (−35% Monday gap)

Foundry e2e (`test/Releash.e2e.t.sol`): both positions hold 100 rNVDA at $180 and reach 8,800 USDG of debt, one through the Releash agent, one by hand.

| | Control (no agent) | Releash |
| --- | --- | --- |
| Friday | nothing | agent deleverages 30% before the close |
| Monday −35% | LTV 75.2% → **liquidated** | survives |
| Collateral left | 60.5 rNVDA | 79.1 rNVDA |
| Equity at the Monday price | $2,680 | $3,712 |

Hosted run on Robinhood testnet (live stack, half-life 120 s, authority 9,500):

| Beat | Transaction |
| --- | --- |
| World ID renewal accepted (simulated proof) | [`0xaeab75eb…`](https://explorer.testnet.chain.robinhood.com/tx/0xaeab75ebca93f90c2e332c841ece017196dd3db8ee48f4c8c67b251bf9937a2a) |
| Agent levers up within authority (8,000 → 8,820), 3.5 s after the renewal | [`0xb7518757…`](https://explorer.testnet.chain.robinhood.com/tx/0xb7518757c60d9cf785af679ca783f9c8a170021d91db9027a15cef297a532a69) |
| Agent tries 1,500 more → reverted `AuthorityExceeded(10,320, 9,222.9)` | [`0x64c5dd20…`](https://explorer.testnet.chain.robinhood.com/tx/0x64c5dd20238a0b3f59a00a35f43251f953b15088d28c0968ddbf2653f04f0193) |
| Friday close: agent sells collateral, repays 2,646 (30%) | [`0x59cff9af…`](https://explorer.testnet.chain.robinhood.com/tx/0x59cff9af643865259424c031a1242651d9e8a4bbe8f0dc05384d1ab76a74b9a1) |
| Monday −35%: control liquidated (4,400 repaid, 39.49 rNVDA seized); Releash position stays at ~60% LTV | [`0xf12d0251…`](https://explorer.testnet.chain.robinhood.com/tx/0xf12d025130cc1567d76e446d2f1c64217c1e0f3b9bf9877a304275a8a7bd65b8) |
| Owner revokes the agent | [`0xa33cda25…`](https://explorer.testnet.chain.robinhood.com/tx/0xa33cda2544a826ee4d15e6c33ea33b1b8a22ed371dae5f721774f3c31be5d771) |
| After revoke: agent still deleverages | [`0x2d295417…`](https://explorer.testnet.chain.robinhood.com/tx/0x2d29541781fd482920503dd6121ec12d88215f4a5d48be7f514d65b02c59a15b) |
| After revoke: agent borrow → reverted `MandateRevoked` | [`0x9ffd5d4c…`](https://explorer.testnet.chain.robinhood.com/tx/0x9ffd5d4c8c5a1ac1f1088d7f6f2b6d6757e7cb769a02d9036e224356d91bbe4e) |

## Contracts (Robinhood Chain testnet, 46630)

| Contract | Address |
| --- | --- |
| ReleashVault | [`0xD3464DDE25e58D0AAC85a47E587ae1E272a95D50`](https://explorer.testnet.chain.robinhood.com/address/0xD3464DDE25e58D0AAC85a47E587ae1E272a95D50) |
| MockUSDG (6 dec) | [`0x64D9f65c80cc4188026C229EaA01f852C2189C2D`](https://explorer.testnet.chain.robinhood.com/address/0x64D9f65c80cc4188026C229EaA01f852C2189C2D) |
| MockStock rNVDA (18 dec) | [`0xFd36E77E5D3Dc407db4a7d6e1d1D62A87c74EA3d`](https://explorer.testnet.chain.robinhood.com/address/0xFd36E77E5D3Dc407db4a7d6e1d1D62A87c74EA3d) |
| MockPriceFeed (8 dec, Chainlink-shaped) | [`0xC803754D776cc2766e35970d026d28Ac69F02a6d`](https://explorer.testnet.chain.robinhood.com/address/0xC803754D776cc2766e35970d026d28Ac69F02a6d) |
| MockPool (x·y=k, 0.3%) | [`0x78A4e755dc67a72EA9193A7920602ac1CBd051Bb`](https://explorer.testnet.chain.robinhood.com/address/0x78A4e755dc67a72EA9193A7920602ac1CBd051Bb) |

Mainnet integration targets (Robinhood Chain 4663, checked on-chain): Paxos USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, NVDA stock token `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEc`, Chainlink NVDA/USD `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`, Chainlink USDG/USD `0x61B7e5650328764B076A108EFF5fa7282a1B9aD2`. The vault takes the collateral, debt asset, feed and pool as constructor arguments, so the production deployment is a parameter change. Paxos also publishes a testnet USDG on 46630 (`0x7E955252E15c84f5768B83c41a71F9eba181802F`).

## Smart contract design

`src/ReleashVault.sol`, no owner, no admin, no upgradeability.

- **Decay:** `limitAt(base, elapsed)` halves every `halfLife`, interpolates linearly inside a period, and is zero from 3 half-lives (plain halving would take ~30). `halfLife` is immutable: 1 day in production, 120 s in the demo deployment.
- **Renewal:** an EIP-712 `Renewal{owner, agent, issuedAt, deadline}` signed by the World verifier key. Bound to chain and vault through the domain, to the agent, single-use through a strictly increasing `issuedAt`, and voided by `revoke`, `fire` or an agent change through a never-decreasing `renewalFloor`.
- **Agent borrow:** `debt + amount ≤ authorityNow(owner)`, not revoked, LTV ≤ 50% at a fresh price, USDG paid to the owner.
- **Deleverage:** owner or agent, 10% or 30% of debt, reads no authority, decay or revoke state. Caller sets `maxCollateralIn`; the agent is additionally capped at 15% worse than the oracle-fair amount.
- **Liquidation:** above 70% LTV, 50% close factor, 5% bonus, works on a stale price. If collateral cannot cover the bonus, the liquidator is charged only what the collateral is worth.
- ReentrancyGuard on every state-changing function, SafeERC20, checks-effects-interactions, `uint128` amounts, LTV checks by cross-multiplication so rounding never admits a borrow over the limit.

### Tests (`forge test`: 41 passing)

- **Invariants** (`test/Releash.invariant.t.sol`, 128 runs × 64 calls with random time, price, revoke, renew, borrows and deleverages):
  - the agent never ends above the authority it had at that moment;
  - deleverage never reverts for an authority, revoke, decay or stale-price reason;
  - the vault always holds the collateral it owes.

  Both product invariants were checked against deliberately broken contracts: removing the authority check, or making deleverage respect revoke, fails the matching invariant.
- **E2E** (`test/Releash.e2e.t.sol`): the full demo story, asserting the control is liquidated, Releash survives, and Releash keeps >$1,000 more equity.
- **Unit** (`test/ReleashVault.t.sol`): renewal replay across vaults, after fire and rehire, after revoke; decay math (fuzzed monotonicity); slippage ceiling against a manipulated pool; capped seize.
- An independent adversarial review is in `docs/REVIEW-contracts.md`; its two contract defects (A1, A2) and the liquidation overcharge (C2) are fixed with regression tests.

## Trust assumptions and known limits

- **World ID is verified off-chain.** The backend verifies the IDKit proof with the World Developer Portal (v4) and signs the `Renewal`. The hosted demo runs in simulator mode (`WORLD_SIMULATE=1`): the real IDKit v4 flow is implemented but not enabled on that deployment. The vault trusts that key to attest "a unique human bound to this owner proved presence at `issuedAt`". It cannot touch funds. One World ID binds to one owner.
- **World ID is not KYC.** It proves a unique, present human, nothing about jurisdiction.
- **The owner key alone can also restore authority** (`setMandate` with the same agent clears a revoke and can raise the base). Authority needs a World proof *or* the owner's key, never just the agent.
- **An agent can bleed collateral by sandwiching its own deleverage** within the 15% ceiling. Mitigation: the agent software deleverages at most once per 20 s per owner; the owner can `fire` it. A production version would route deleverage through a TWAP or an RFQ.
- **Over a weekend, a pool trading >13% below the frozen oracle blocks the agent's deleverage** (the owner's path still works). The demo keeper updates the oracle before rebalancing the pool.
- Testnet mocks: no interest, vault liquidity is seeded by the deployer, open faucet mints, demo price keeper.

## Architecture

```
web (Vite/React/wagmi) ── IDKit ──► backend ── World v4 verify ──► signs EIP-712 Renewal
        │                                 │
        └── renew(), borrow(), revoke() ──┴──► ReleashVault ◄── agent loop (Jev → Claude → rules)
                                                  ▲                  │ agentBorrow / deleverage
                                  keeper (price, market clock)       └─► log.jsonl → feed
```

## Run it

```bash
forge test                                   # contracts
script/deploy.sh 31337                       # local anvil; 46630 needs --broadcast
cd backend && npm i && WORLD_SIMULATE=1 npm start
cd agent && npm i && npx tsx demo-setup.ts && WATCH=<alice>,<control> npx tsx loop.ts
cd web && pnpm i && pnpm dev                 # /demo, /app, /security
```

Node 22.13+ (built-in SQLite). Env examples in each package.

## What was built during the Buildathon

Everything in this repository was written on 3–4 Oct 2026 during the Arbitrum Open House Online Buildathon; the commit history is the record. Releash continues **Leash** (ETHGlobal Tokyo, Sept 2026), from which it takes the idea of decaying, World-renewed agent authority, the `limitAt` decay curve, and the shape of the IDKit v4 verification code (ported and adapted in `backend/src/world.ts`). Leash's ENS roles, 1inch Aqua and SwapVM integration were dropped; the lending vault, deleverage asymmetry, EIP-712 renewal, invariants, agent and UI are new.
