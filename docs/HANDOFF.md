# Releash — handoff (TRUNCATED)

> The original handoff was pasted into chat and arrived cut off partway through section 1 ("Never claim … Robinhood stock tokens are exclud,").
> Sections 2–12 were reconstructed in `docs/SPEC.md` and `docs/PLAN.md`. If the full file turns up, diff it against SPEC.md and reconcile.
> Written Sat 3 Oct 2026, 12:00 JST. Submission closes **Sun 4 Oct 2026, 15:59** (HackQuest). Treat it as JST and **submit by 15:00**.

**Summary (ID):** Releash adalah AI agent yang menjaga pinjaman USDG berjaminan saham tokenisasi di Robinhood Chain. Wewenang agent untuk *menambah utang* menyusut setengahnya tiap periode, kecuali user membuktikan dirinya masih hadir dengan World ID. Wewenang untuk *mengurangi risiko* (deleverage) tidak pernah hilang. Otak agent memakai Jev (TypeSafe, lewat OpenRouter) dengan Claude sebagai cadangan, dan kontrak menjadi penjaga terakhir.

## 1. Context and decisions

**Hackathon.** Arbitrum Open House Singapore — Online Buildathon, on HackQuest.
- Prizes: Overall 70k USDC (40k / 20k / 10k), Promising Products 15k (7k / 5k / 3k), Grants 30k (milestone-based).
- Robinhood Chain slot: at least 1 of the 3 Overall prizes is reserved for a Robinhood Chain project.
- Eligibility: deployed on an Arbitrum chain. Robinhood Chain testnet qualifies. Existing projects may be continued.
- Judging: smart contract quality first, then product-market fit, innovation and creativity, real problem solving. Paxos USDG integration gets extra consideration.
- After submission: winners announced 12 Oct. Founder House Singapore 23–25 Oct.

**Origin.** Releash evolves *Leash* (ETHGlobal Tokyo, Sept 2026, did not win).
- Core idea: an agent's permission decays over time unless a verified human keeps showing up (World ID), with the asymmetry "close always, open only while alive".
- Leash targeted 1inch Aqua LP positions with ENS roles and a SwapVM opcode. Releash keeps the core idea and drops ENS and SwapVM.

**Why this direction (market research, 30 Sep 2026)**
- Plain stock-token lending loses: submitted on Robinhood Chain at least 3 times at Open House (RoboLend, RobinLend, ShortStack), never won.
- Agents managing real money win: Tilt Protocol, Bond.Credit, Agama Finance, ReineiraOS. All presented as businesses.
- Guardrails alone are crowded: "agent guardrail + World ID" in at least 6 ETHGlobal projects in 2026. Closest, HumanMandate, works the opposite way (re-verifying raises the limit).
- The gap: nobody combines continuously decaying authority, World ID renewal and risk asymmetry. Other agent-permission systems freeze the agent on expiry, which for a leveraged loan means liquidation. Releash fails safe.

**The problem we sell.**
1. You borrow USDG against tokenized NVDA, then go offline on Friday afternoon.
2. Stock oracles run 24/5 (Chainlink), so prices freeze over the weekend.
3. On Monday the market gaps down. The NVDA/USDG pool holds under $1M of liquidity, so you are liquidated with heavy slippage.
4. Morpho shut its Auto-Deleverage feature in May 2026, so nothing de-risks the position automatically on the main lending rail.

**Pitch line.** "Releash is auto-deleverage for stock-backed loans on Robinhood Chain: your agent can always save the position, but can only add debt while you keep proving you're still there."

**Locked decisions**

| Topic | Decision |
| --- | --- |
| Chain | Robinhood Chain testnet, chain ID 46630 |
| Assets | MockUSDG (6 decimals), MockStock "rNVDA" (18 decimals), MockPriceFeed (8 decimals). Real mainnet addresses go in the README as integration targets. |
| Lending | Own minimal vault (`ReleashVault`). Not Morpho: no verified stock-collateral market found on Robinhood Chain. |
| World ID | IDKit in the frontend → backend verifies the proof → backend signs an EIP-712 grant → the contract checks the signature. Disclose this trust assumption. |
| AI | Jev (TypeSafe's System One) via OpenRouter for decisions. Claude via OpenRouter as fallback, and for parsing the mandate if time allows. One OpenRouter key covers both. |
| ENS, SwapVM | Dropped |
| Collateral | One asset (rNVDA) |
| Deleverage sizes | Discrete: 10% or 30% of debt |
| Demo mode | Half-life 120 s (60 s made the lever-up beat a 9 s window), price keeper, fake market clock, price shock, revoke-to-block |

**Never claim:**
- That World ID is KYC. It proves a unique, present human, not a jurisdiction. Robinhood stock tokens are exclud… *(text lost here)*
