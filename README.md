# NutShell

**Autonomous news verification and options hedging on Base mainnet.**

News breaks in seconds. Price oracles update in minutes. Portfolios sit
defenceless in between, and holding protective puts continuously costs more
than the position earns — so the fix has to be event-driven, and an event-driven
hedger is only as good as its trigger.

NutShell reads the newswires, measures every claim against Base mainnet itself,
scores it with three independent models on the Gonka network, and buys a real
protective put on Thetanuts' OptionBook only when the evidence and the models
agree. Funded from vault yield, never from principal.

Measured on the live book: an ETH put struck at $2,400 against a spot of
$2,443, expiring in ~17 hours, costs **$2.15** — 0.09% of notional, for real
downside protection.

---

## Surfaces

| Route | What it is |
|---|---|
| `/` | **Verify.** Paste any claim, get three named models scoring it live with their Gonka request ids. No wallet, no signup, nothing traded. Carries the gate explorer: drag model agreement under the floor and watch the same truth score stop buying anything. |
| `/dashboard` | **Live agent.** Suspicion timeline over everything read, and the six-stage pipeline as it runs. |
| `/signals` | **Signal intake.** Every headline screened, including the rejections and the reason each was dropped. |
| `/incident/[id]` | **One incident, end to end.** Claim → chain evidence → three verdicts → consensus → decision with its binding cap → fill → attestation, under one correlation id. |
| `/protection` | **Portfolio.** Vault economics, active cover, and every hedge ever bought. |
| `/console` | **Operator.** Arm/pause, execution mode, risk policy, the poller, emergency actions, diagnostics. Token-gated. |

## Running it

```bash
cp .env.example .env      # fill in real values first
npm install
npm run dev               # UI and API on :3000
npm run worker            # agent loop, second terminal
```

```bash
npm run test:all          # 187 tests, no network needed
npm run health            # RPC, book, clock skew, burner balances
npm run diag:kimi         # which Gonka models are healthy right now
npm run verify:chain      # confirm the on-chain links resolve
npm run demo              # one alert through the whole pipeline
```

`npm run dev` seeds a worked history so every surface has content on a cold
start. Every seeded headline goes through the real triage, and no seeded record
fabricates a transaction. Set `DEMO_SEED=false` to start empty.

Set `INGEST_AUTOSTART=true` to have the newswire poller start with the server;
otherwise start it from the console.

## Contracts and network

Base mainnet only, chain id **8453**. The Thetanuts SDK ships no testnet
configuration — there is no testnet path for this protocol.

| | |
|---|---|
| OptionBook | `0x1bDff855d6811728acaDC00989e79143a2bdfDed` |
| Option implementation | `0x7355EB92dfb0503DB558a70c10843618932ab290` |
| USDC (collateral) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| WETH (underlying) | `0x4200000000000000000000000000000000000006` |

## Security model

A policy-bounded burner agent, not a wallet with anyone's keys in it.

- **One action type.** Buy a protective put. No withdraw, no transfer, no
  collateral movement.
- **One contract.** The OptionBook above, allowlisted.
- **Exact approvals** per trade. Never `MaxUint256`.
- **Server-side caps.** A hard ceiling per trade and a daily cap, enforced on
  every path including manual approval.
- **Blast radius** is the premium budget — a few USDC and some gas.
- The private key lives in `.env`, git-ignored, and is never loaded by a
  Next.js route.

This is deliberately not called session keys. There is no session-key primitive
in the Thetanuts SDK; it signs with a raw key from the environment.

## Honest limitations

- **The vault is modelled.** Principal, yield and the premium reserve are
  simulated at a fixed APY. No lending market is connected. The premiums are
  real USDC on Base mainnet and every transaction link resolves on BaseScan.
- **A long put cannot be unwound early on this venue.** Measured against a real
  open position: `close()` reverts unless one address holds both sides,
  `reclaimCollateral()` is seller-only, and no live quote bids for puts.
  Premium recovery on an early exit is **0%**. Abandoning a hedge records the
  decision and sends no transaction, because none is possible.
- **Job state is in memory.** Verification jobs do not survive a restart.
  Positions are written to disk and do.
- **The newswires lag.** RSS carries minutes to hours behind an incident. The
  faster sources people assume exist mostly do not: PeckShield and CertiK
  publish only on X, Forta and CryptoPanic need paid keys, and every Nitter
  instance is gone. Speed on Base comes from reading the chain directly, which
  stage 02 does.

## AI tools used

- **Claude (Anthropic)** — Claude Code, for implementation, review and
  refactoring across the codebase.
- **Gonka Network** — MiniMax, Kimi and DeepSeek, via the GonkaRouter API, as
  the verification layer itself. All AI reasoning in the product runs through
  Gonka; no other inference provider appears anywhere in the verification path.

## Team

M1 — chain execution · M2 — ingestion and verification · M3 — frontend and API
