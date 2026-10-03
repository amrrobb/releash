# Releash

**Auto-deleverage for stock-backed loans on Robinhood Chain.**
Your agent can always make the loan safer. It can only add debt while you keep proving, with World ID, that you are still there.

- Live app: _n_
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

The agent's brain is **Jev** (TypeSafe's decision model, via OpenRouter `/api/alpha/decisions`), asked to choose among exactly the contract's actions: `hold`, `deleverage_10`, `deleverage_30`, `borrow_more`. Claude (Haiku 4.5) is the fallback when Jev is unsure. A deterministic LTV guard runs before either model, and **the contract is the last guard**: whatever the model says, an out-of-authority borrow reverts on-chain.

## Demo result (on-chain, same start, same −35% Monday gap)

| | Control (no agent) | Releash |
| --- | --- | --- |
| Start | 100 rNVDA @ $180, 8,800 USDG debt | 100 rNVDA @ $180, 8,000 USDG debt + agent |
| Friday | nothing | agent deleverages 30% before the close |
| Monday −35% | LTV 75.2% → **liquidated** | LTV 62.1% → survives (agent trims to 59.7%) |
| Equity after | ~$2.7k | ~$3.7k |

Testnet run (real time, half-life 120 s; authority 9,000 → 4,256 at 133 s → 2,100 at 256 s → 0 at 378 s):

| Beat | Transaction |
| --- | --- |
| World ID renewal accepted (simulated proof) | [`0x250ae13e…`](https://explorer.testnet.chain.robinhood.com/tx/0x250ae13ed09efaefa13c57d29dfb6f617418d6d22c8ef1128620ba93d514ec63) |
| Agent borrows within authority (8,000 → 8,775) | [`0x23d2e5a8…`](https://explorer.testnet.chain.robinhood.com/tx/0x23d2e5a8d439114f32b7350d555913df74624030d4c630f08dd7b89391a756d7) |
| Agent borrows past authority → reverted `AuthorityExceeded(9,200, 8,700)` | [`0x282edb72…`](https://explorer.testnet.chain.robinhood.com/tx/0x282edb724b5df63af9af1a508ed4e698d34e51d42acfdaa39a5dc8332008c8fa) |
| Friday: agent deleverages 30% (LTV 48.8% → 40.4%) | [`0xf0351454…`](https://explorer.testnet.chain.robinhood.com/tx/0xf0351454adf59154b77eb6da83d53765f9d773cd58634884e39d128bdc25b58c) |
| Monday −35%: control liquidated (4,400 repaid, 39.49 rNVDA seized) | [`0xfd8f1981…`](https://explorer.testnet.chain.robinhood.com/tx/0xfd8f1981adfa4cc02bb6d7fdaee6fce1e5726dad9171524656a880729e5d68a0) |
| Owner revokes the agent | [`0x3cb0895c…`](https://explorer.testnet.chain.robinhood.com/tx/0x3cb0895cfdb8e81e654c063e904c8ef1c7673bc9856d2136fa8955b19106233f) |
| After revoke: agent still deleverages (552.83 repaid) | [`0x34474317…`](https://explorer.testnet.chain.robinhood.com/tx/0x34474317a2507ef90ec789af3518fe8c7b8f55619751111f016900d8ffd459c8) |
| After revoke: agent borrow → reverted `MandateRevoked` | [`0x2be4e4fa…`](https://explorer.testnet.chain.robinhood.com/tx/0x2be4e4fa35d74f88f47e21da6484f1c34406d17142cf42ca57b901e9326bb69c) |

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

- **World ID is verified off-chain.** The backend verifies the IDKit proof with the World Developer Portal (v4) and signs the `Renewal`. The vault trusts that key to attest "a unique human bound to this owner proved presence at `issuedAt`". It cannot touch funds. One World ID binds to one owner.
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
cd web && pnpm i && pnpm dev                 # ?demo=1 for the demo strip
```

Node 22.13+ (built-in SQLite). Env examples in each package.

## What was built during the Buildathon

Everything in this repository was written on 3–4 Oct 2026 during the Arbitrum Open House Online Buildathon; the commit history is the record. Releash continues **Leash** (ETHGlobal Tokyo, Sept 2026), from which it takes the idea of decaying, World-renewed agent authority, the `limitAt` decay curve, and the shape of the IDKit v4 verification code (ported and adapted in `backend/src/world.ts`). Leash's ENS roles, 1inch Aqua and SwapVM integration were dropped; the lending vault, deleverage asymmetry, EIP-712 renewal, invariants, agent and UI are new.
