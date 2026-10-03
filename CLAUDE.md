# CLAUDE.md — Releash (Arbitrum Open House, Robinhood Chain)

Read first: `docs/SPEC.md` (frozen interface + behaviour), `docs/PLAN.md` (hour gates, cut list), `docs/RESEARCH.md` (chain/RPC/faucet facts). `docs/HANDOFF.md` is the original brief, truncated at section 1.
If you were spawned from a session in `monad-metropolis/`: **ignore that project's CLAUDE.md** (Monad, Dynamic, Envio, "no crypto vocabulary" do NOT apply here).

## What this is
Auto-deleverage agent for USDG loans backed by tokenized stock (rNVDA) on Robinhood Chain testnet (46630). The agent's authority to ADD debt decays (halves every half-life) unless the human renews with World ID. Its authority to REDUCE risk (deleverage) never decays and survives revoke. The contract is the final guard; the LLM only picks from a fixed action menu.

Deadline: Sun 4 Oct 2026, submit by 15:00 JST. Judging: smart contract quality first, then PMF, innovation, real problem. USDG integration is a bonus.

## Non-negotiables
1. Deleverage must never revert because of authority state (decayed, revoked, never verified). There is an invariant test for this; keep it green.
2. Agent borrow must never bring debt above `authorityNow(owner)`. Invariant test too.
3. No owner/admin function can move a user's collateral or debt. Admin only exists on mocks (price keeper, mint).
4. Testnet only. Mock assets. Real mainnet addresses appear only in README as integration targets.
5. Never claim World ID is KYC. It proves a unique, present human.
6. Disclose trust assumptions in README: the backend signer attests the World proof; Leash code reused (continued project).

## Stack
- Contracts: Foundry, solc 0.8.28, OZ v5.1 (submodules). `forge fmt` before commit. One test file per contract + `Releash.invariant.t.sol` + `Releash.e2e.t.sol`.
- Backend (`backend/`): Node 20+, TypeScript via tsx, viem, IDKit verify (port from `~/Documents/Web3/ETHGlobal/ETHGlobalTokyo/leash/backend/src/world.js`), EIP-712 signer.
- Agent (`agent/`): Node + viem, OpenRouter (Jev if the slug exists, Claude fallback). Output is one of {hold, deleverage10, deleverage30, borrow}. Always log viem `err.details`.
- Keeper (`agent/keeper.ts`): price + fake market clock for the demo.
- Web (`web/`): Vite + React + TS + viem/wagmi, injected wallet. Identity comes from the connected wallet (anyone can play the user).
- Addresses: `deployments/46630.json` only. Never hardcode an address elsewhere.

## Rules
- Commit small, conventional messages (`contracts: …`, `agent: …`). Never squash. Commit before any mutation check that restores from git.
- Run tests with `rtk proxy forge test`, write raw output to a file, read the summary line. RTK's exit code is not the command's.
- pre-push hook runs `forge test`; never bypass.
- Throwaway keys: persist to a gitignored file BEFORE funding.
- Read return values that depend on the block from events, never from a simulation.
- Never commit `.env*` (only `.env.example`).
- No AI attribution lines in commits.
