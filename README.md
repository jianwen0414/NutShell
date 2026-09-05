# NutShell

**Autonomous news verification and options hedging on Base mainnet.**

---

## Project description

NutShell is an autonomous agent that reads public crypto newswires, checks what
it reads against Base mainnet itself, has three independent AI models score the
claim, and — only when the evidence and the models agree — buys a real
protective put option on Thetanuts' OptionBook.

Every premium is paid out of simulated vault yield, never out of principal, and
every decision is traceable from the headline that triggered it to the
transaction that settled it under a single correlation id.

Six stages, one id:

| | Stage | What happens |
|---|---|---|
| 01 | **Detect** | Eight public RSS newswires on a 60-second timer. Keyword triage drops commentary, price rallies and anything naming no hedgeable asset — every rejection carries its reason. |
| 02 | **Investigate** | Before any model is asked, the claim is measured against Base mainnet: balance deltas, transfer activity, contract state, DEX depth, oracle divergence, peg stability, protocol TVL. |
| 03 | **Analyze** | Three models on the Gonka decentralised inference network score the claim *against that evidence*, in parallel. Each returns a score, a stance, its reasoning and an auditable request id. |
| 04 | **Challenge** | Consensus is computed. When the panel disagrees, a synthesis round runs. Agreement is measured, not assumed, and carries its own threshold. |
| 05 | **Decide** | Truth and agreement are checked against the policy matrix, then size is bound by whichever of five caps bites first — reserve, daily cap, per-trade ceiling, book depth, or the tier. |
| 06 | **Protect** | A real protective put is bought on Base mainnet, and an attestation ties the trade to the exact reasoning that caused it. |

---

## Problem statement

**News breaks in seconds. Price oracles update in minutes. Portfolios are
defenceless in between.**

When a bridge is drained or a protocol halts, the information exists publicly
long before it reaches the price. A holder who is asleep, or simply not
watching, absorbs the full move.

The obvious defence — holding protective puts continuously — costs more than
the position earns. Rolling short-dated ETH puts runs to several percent of
notional per year against a yield of a few percent, so permanent protection is
negative-carry by construction. Nobody does it, and they are right not to.

That makes protection an *event-driven* problem, which moves the difficulty
somewhere harder: **an event-driven hedger is only as good as its trigger.** A
trigger that fires on rumour wastes premium on every false alarm; one that
waits for confirmation buys protection after the drop it was meant to prevent.

So the real problem is not execution. It is deciding, quickly and without a
human, whether a claim is true enough to spend money on — and being able to
prove afterwards why it did.

NutShell's answer has two halves:

- **Measure before believing.** Stage 02 reads the chain before the models are
  asked, so a plausible-sounding claim about an event that is not happening is
  scored against what is actually true. Measured: the same scripted bridge-exploit
  claim scores **23.5** with chain evidence and **58** without it.
- **Spend only on agreement.** A high truth score alone does not buy anything.
  Two readings of one event can share a truth score of 91 while agreement falls
  from 86% to 31% — and the second buys nothing. Once a put is bought the
  premium is gone (measured early-exit recovery on this venue: **0%**), so the
  only place the system can save money is *before* it spends.

---

## Blockchain technology used

| Layer | Technology | Role |
|---|---|---|
| **Network** | **Base** (Coinbase L2, OP Stack), chain id **8453** | All execution, settlement and on-chain reads. Mainnet only. |
| **Options venue** | **Thetanuts Finance** OptionBook + `@thetanuts-finance/thetanuts-client` | Signed-quote RFQ order book for vanilla European options. Filling an order deploys a fresh option contract and pulls premium in USDC. |
| **Collateral** | **USDC** (native Base) | Premiums. Exact per-trade approvals, never `MaxUint256`. |
| **Underlying** | **WETH** and Chainlink-priced synthetics | ETH options settle against WETH; BTC/SOL/XRP/BNB/AVAX are cash-settled against their Chainlink feeds. |
| **Oracles** | **Chainlink** price feeds on Base | Strike settlement, and stage 02's oracle-divergence and peg-stability checks. |
| **Chain reads** | **ethers v6** against a Base archive node | Stage 02 evidence: `eth_getBalance` at historical blocks, `eth_getLogs`, `eth_call`. |
| **DEX data** | **Uniswap v3** and **Aerodrome** pools on Base | Independent price and liquidity-depth measurement, cross-checked against Chainlink. |
| **Inference** | **Gonka** decentralised inference network | The three-model verification panel. Every call returns a request id whose shard resolves on Gonka's own chain API. |

Settlement on this venue is automatic — an in-the-money option pays out without
a transaction from the holder.

---

## Smart contract addresses

> ### ⚠️ There is no testnet deployment, and there cannot be one.
>
> The submission requirements ask for testnet addresses. NutShell has none,
> because **Thetanuts Finance does not operate a testnet.** The SDK ships no
> testnet configuration, there is no OptionBook on Base Sepolia, and no market
> maker quotes there — so there is nothing to sign a quote against.
>
> Rather than stub the venue out, the agent was pointed at **Base mainnet with
> real USDC**, capped to a few dollars per trade. Every address and transaction
> below is live and independently verifiable on BaseScan.

### Protocol contracts — Base mainnet (8453)

| Contract | Address |
|---|---|
| Thetanuts OptionBook | [`0x1bDff855d6811728acaDC00989e79143a2bdfDed`](https://basescan.org/address/0x1bDff855d6811728acaDC00989e79143a2bdfDed) |
| Vanilla PUT implementation | [`0x7355EB92dfb0503DB558a70c10843618932ab290`](https://basescan.org/address/0x7355EB92dfb0503DB558a70c10843618932ab290) |
| USDC (collateral) | [`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`](https://basescan.org/address/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) |
| WETH (underlying) | [`0x4200000000000000000000000000000000000006`](https://basescan.org/address/0x4200000000000000000000000000000000000006) |

### Agent wallet

| | Address |
|---|---|
| Policy-bounded burner | [`0xB792296bE8202ba2fc5D3276fA184e5B479920E3`](https://basescan.org/address/0xB792296bE8202ba2fc5D3276fA184e5B479920E3) |

### Option contracts the agent actually deployed

Each fill deploys a new option contract. These are ours, on mainnet:

| Asset | Strike | Option contract | Entry transaction |
|---|---|---|---|
| ETH | $2,340 | [`0x96c2c0d1…6422`](https://basescan.org/address/0x96c2c0d1d1ad8ea8483b8294b802352363b16422) | [`0x9c4bb145…8f8c`](https://basescan.org/tx/0x9c4bb145a85740323a14f99cfbbf69c7da18bef1a8fa8f087d2330d095828f8c) |
| BTC | $75,500 | [`0xe21841f4…b109`](https://basescan.org/address/0xe21841f45e5fa844fcaa15d6af5699dce82eb109) | [`0xbbb8b74b…6309`](https://basescan.org/tx/0xbbb8b74b7ab6174e35f7b2bdff2c138abe894a9472d27856aff791c5c0c06309) |
| SOL | $97 | [`0xae8bdc75…a5a2`](https://basescan.org/address/0xae8bdc753f866ff31a467a07b5ed787a1674a5a2) | [`0xda94b0b8…85a7`](https://basescan.org/tx/0xda94b0b8becfb269daf164a56315cb14648db52e147f607dec70f13562c385a7) |
| ETH | $2,380 | [`0x8d28b640…8240`](https://basescan.org/address/0x8d28b6408547cd6057439bb1344eaee8377e8240) | [`0xe2d5fcce…1b2d`](https://basescan.org/tx/0xe2d5fcce87e8895a87e4bc715d6253a4bfb43df46235a728ae6b6a46d62c1b2d) |

The BTC and SOL fills prove the cash-settled synthetic path; the second ETH
position was held to expiry and settled out-of-the-money, recovering 0 against
its premium, which is the honest outcome for insurance that was not needed.

### Chainlink price feeds (Base mainnet)

| Asset | Aggregator |
|---|---|
| ETH / USD | `0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70` |
| BTC / USD | `0x64c911996d3c6ac71f9b455b1e8e7266bcbd848f` |
| SOL / USD | `0x975043adbb80fc32276cbf9bbcfd4a601a12462d` |
| XRP / USD | `0x9f0c1dd78c4cbdf5b9cf923a549a201edc676d34` |
| BNB / USD | `0x4b7836916781caafbb7bd1e5fdd20ed544b453b1` |
| AVAX / USD | `0xe70f2d34fd04046aaec26a198a35dd8f2df5cd92` |

---

## Setup and installation

### Prerequisites

- **Node.js 20+** and npm
- A **Base mainnet RPC** endpoint with archive access (stage 02 reads historical
  balances). Alchemy's free tier works; its `eth_getLogs` range cap of 10 blocks
  is handled.
- A **Gonka API key** for the inference panel
- *Optional:* Supabase Postgres for the durable archive, and a Telegram bot for
  alerts. Both degrade cleanly when absent.

Running the agent against the live venue additionally needs a funded burner
wallet holding a few USDC and a little ETH for gas on Base.

### Install and run

```bash
git clone https://github.com/jianwen0414/NutShell.git
cd NutShell
npm install

cp .env.example .env     # then fill it in — see below
npm run dev              # UI and API on http://localhost:3000
```

One terminal is enough. `startVerification` runs the pipeline inline inside the
Next process, so every job created from the browser is executed by `npm run
dev`.

> `npm run worker` exists for a deployed configuration where the queue lives in
> a database. In local development it constructs its own in-memory store and
> polls a queue the web app never writes to, so **do not run it alongside
> `npm run dev`** — it does nothing and spends a Gonka call at boot.

### Minimum environment

`.env.example` documents every variable with its measured defaults. The
smallest set that boots a working UI:

```bash
GONKA_API_KEY=...            # the three-model verification panel
GONKA_BASE_URL=https://api.gonkarouter.io/v1
THETANUTS_RPC_URL=...        # Base mainnet, archive access
OPERATOR_TOKEN=...           # gates every write endpoint
HARD_CEILING_USDC=3.00       # largest single trade, enforced server-side
```

Add `THETANUTS_PRIVATE_KEY` only to let the agent sign real transactions.
Without it the pipeline runs the whole way and correctly stops at `DECIDED`
rather than pretending to trade.

Useful switches:

```bash
INGEST_AUTOSTART=true        # start the newswire poller with the server
DEMO_SEED=false              # boot with empty surfaces instead of a worked history
```

`npm run dev` seeds a worked history so every surface has content on a cold
start. Every seeded headline goes through the **real** triage, and no seeded
record fabricates a transaction or an explorer link.

### Verify the install

```bash
npm run test:all       # 195 tests, no network needed
npm run health         # RPC, book, clock skew, burner balances, Gonka panel
npm run typecheck
npm run build
```

Diagnostics against the live network:

```bash
npm run probe:evidence   # stage 02 against every scenario, re-verifies the registry
npm run diag:kimi        # which Gonka models are actually answering
npm run verify:chain     # confirm request-id shards resolve on Gonka's chain
npm run probe            # the live Thetanuts order book
```

---

## Surfaces

| Route | What it is |
|---|---|
| `/` | **Verify.** Paste any claim; three named models score it live with their request ids. No wallet, no signup, nothing traded. Carries the gate explorer — drag agreement under the floor and watch the same truth score stop buying anything. |
| `/signals` | **Signal intake.** Every headline screened, rejections included, with the reason each was dropped and what the pipeline decided about the ones that passed. |
| `/dashboard` | **Live agent.** Suspicion timeline over everything read, and the six-stage pipeline as it runs. |
| `/incident/[id]` | **One incident, end to end.** Claim → chain evidence → verdicts → consensus → decision with its binding cap → fill → attestation, under one correlation id. |
| `/protection` | **Portfolio.** Vault economics, active cover, and every hedge ever bought. |
| `/console` | **Operator.** Arm/pause, execution mode, risk policy, the poller, diagnostics. Token-gated. |

---

## Security model

A policy-bounded burner agent, not a wallet with anyone's keys in it.

- **One action type.** Buy a protective put. No withdraw, no transfer, no
  collateral movement.
- **One contract.** The OptionBook above, allowlisted. Nothing else reachable.
- **Exact approvals** per trade, to the cent. Never `MaxUint256`.
- **Server-side caps.** A hard per-trade ceiling and a daily cap, enforced on
  every path — including the manual-approval route, which deliberately skips
  policy sizing and so re-applies the ceiling itself.
- **Operator auth** on every write endpoint, compared in constant time.
- **Blast radius** is the premium budget — a few USDC and some gas.
- The private key lives in `.env`, git-ignored, and is never loaded by a
  Next.js route.

This is deliberately not called session keys. There is no session-key primitive
in the Thetanuts SDK; it signs with a raw key from the environment.

---

## Honest limitations

Measured, not assumed. Each of these is surfaced in the product rather than
hidden.

- **The vault is modelled.** Principal, yield and the premium reserve are
  simulated at a fixed APY; no lending market is connected. The premiums are
  real USDC and every transaction link resolves on BaseScan. The driver sits
  behind an interface that takes a real lending market unchanged.
- **A long put cannot be unwound early on this venue.** Measured against a real
  open position: `close()` reverts unless one address holds both sides,
  `reclaimCollateral()` is seller-only, and no live quote bids for puts.
  Early-exit recovery is **0%**. Abandoning a hedge records the decision and
  sends no transaction, because none is possible.
- **The Gonka panel is 2 of 3.** `moonshotai/Kimi-K2.6` is still listed by the
  router's catalogue but returns `400 unsupported model` on every call. Quorum
  is 2, so runs complete. `/api/health` judges models on outcomes rather than on
  the catalogue, so it reports this rather than trusting the listing.
- **Job state is in memory.** Verification jobs do not survive a restart.
  Records rebuild from Postgres with a `FROM ARCHIVE` badge — except the stage
  02 evidence packet, which no table stores, and the page says so rather than
  rendering an empty chain. Positions are on disk and survive.
- **The newswires lag.** RSS runs minutes to hours behind an incident. The
  faster sources people assume exist mostly do not: PeckShield and CertiK
  publish only on X, Forta and CryptoPanic need paid keys, and every Nitter
  instance is gone. Speed on Base comes from reading the chain directly, which
  is what stage 02 is for.

---

## AI tools used

- **Gonka Network** — MiniMax, Kimi and DeepSeek via the GonkaRouter API, as the
  verification layer itself. All AI reasoning in the product runs through Gonka;
  no other inference provider appears anywhere in the verification path.
- **Claude (Anthropic)** — Claude Code, for implementation, review and
  refactoring across the codebase.

---

## Team

| Member | GitHub | Owned |
|---|---|---|
| Lee Jian Wen | [@jianwen0414](https://github.com/jianwen0414) | **M1 — chain execution.** Thetanuts integration, order selection and decoding, the broadcast path, position store, attestations, settlement. Plus the final UX and information-architecture pass. |
| Ooi Rui Zhe | [@RZRexton](https://github.com/RZRexton) | **M2 — ingestion and verification.** Newswire readers, keyword triage and dedup, the poll loop, stage 02 chain investigation, asset mapping, worker pipeline, backend/frontend integration. |
| Brayden | [@braydencjr](https://github.com/braydencjr) | **M3 — frontend and services.** The original command-center prototype, dashboard surfaces, Supabase persistence, the Telegram alert bot, and the human-in-the-loop manual execution flow. |

---

*Base mainnet (8453) · Thetanuts OptionBook · Gonka decentralised inference*
