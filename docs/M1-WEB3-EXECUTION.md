# M1 — Web3 / Execution

Owner surface: `lib/thetanuts.ts`, `lib/assets.ts`, `lib/attestation.ts`, plus the
shared foundation `types/index.ts`, `lib/errors.ts`, `lib/decimals.ts`, `lib/config.ts`.

Everything below was measured against the **live Base mainnet book**. Nothing is mocked.

---

## Status

| | |
|---|---|
| Read paths | ✅ live — decode, asset resolution, TTL guard, strike selection |
| Execution | ✅ **filled on mainnet** — see [FIRST-FILL.md](FIRST-FILL.md) |
| Attestation | ✅ **on-chain**, verified by decoding the calldata back |
| Position store | ✅ file-backed, with chain reconstruction for crash recovery |
| Early unwind | ❌ **impossible on this venue** — measured, see below |
| Settlement at expiry | ⚙️ instrumented; measurable after 2026-09-01T08:00Z |
| Graded position | ⚙️ scripted and gated — must be fired 4–5 Sep |
| Tests | ✅ 114 passing |

Stage 4 exit condition is **met**: a protective put exists on Base mainnet,
bought by the agent, with a live BaseScan URL.

`dryRun: true` runs the complete pipeline against the live book and stops before
signing; `--live` is the only difference between a rehearsal and a real trade.

---

## Quick start

```bash
npm install                      # project-local; nothing is installed globally
cp .env.example .env             # THETANUTS_RPC_URL is the only value read paths need

npm run typecheck
npm test                         # 114 tests, no network

npm run probe                    # decode the live book + assert every 🔒 invariant
npm run identify:tokens          # verify token decimals on-chain
npm run build:asset-map          # re-derive the feed→asset map from live strikes
npm run probe:ttl                # 16-minute TTL / clock-skew measurement

npx tsx scripts/dry-run-hedge.ts --asset ETH --budget 3.00
npx tsx scripts/dry-run-hedge.ts --live    # requires a funded burner
```

---

## Measured facts

Collected 2026-08-30, 78 consecutive polls over 16 minutes, plus a separate
probe run. Raw samples: `artifacts/ttl-samples.jsonl` (gitignored).

### Quote TTL — 57.5 s to 117.2 s

| | min | p05 | median | p95 | max |
|---|---|---|---|---|---|
| TTL (s) | **57.47** | 59.83 | 87.05 | 113.56 | **117.18** |

The whole book shares **one** `orderExpiryTimestamp` (1–2 distinct values per
poll, the second only when a poll catches a rollover mid-flight). TTL sawtooths
from ~117 s down to ~57 s on a 60-second cycle.

Consequence: **when the book is inside the dead window, nothing is fillable at
once.** 4 of 78 polls (5.1%) had the entire book below the 60 s floor. The retry
loop absorbs this, but retrying *instantly* re-reads the same dead window — hence
`SELECT_RETRY_DELAY_MS=4000`.

Batch cancellation is confirmed: **50 distinct nonces across ~292 orders**, so the
maker cancels ~6 orders at a time atomically. PRD §3.5 point 4 holds.

### Clock skew — the PRD's §3.6 reading is wrong, and it matters

| Quantity | min | median | max |
|---|---|---|---|
| **Local skew** (`currentTime − Date.now()`) | −0.64 s | **−0.44 s** | −0.18 s |
| PRD §3.6 formula (`lastUpdated − currentTime`) | −2.53 s | +27.05 s | +57.18 s |

`metadata.lastUpdated` is **not** a staleness marker. It is a forward-dated
quote-cycle anchor:

> **`orderExpiryTimestamp === lastUpdated / 1000 + 60`, exactly, in 78 of 78 polls.**

So the PRD's "skew" is really `TTL − 60` — the cycle phase. It sawtooths rather
than drifting, which fully explains the PRD's two samples (+31.1 s, then +11.3 s)
and its "a fixed offset would be stable; this is drift" conclusion. Two samples
cannot distinguish a sawtooth from drift.

Two practical consequences:

1. **Deriving "now" from `lastUpdated`, as PRD §3.6 mandates, would put the clock
   up to 55 s in the future** and make every quote look like it had exactly 60 s
   left. `lib/thetanuts.ts` uses `metadata.currentTime` instead — still the feed's
   clock, never `Date.now()`.
2. **Real clock skew is under a second.** The `MARKET_DATA_STALE` guard runs on
   `currentTime` vs the host clock. The PRD formula is retained on
   `MarketSnapshot.clockSkewSeconds` so the team's numbers stay comparable, and
   `feedAgeSeconds` / `localClockSkewSeconds` carry the corrected readings.

### Per-asset order counts

Median across 78 polls. Total book **289–294 orders** (median 292); **53–59
vanilla puts** (median 56).

| Asset | Orders (min/med/max) | Vanilla puts (min/med/max) |
|---|---|---|
| BTC | 114 / **116** / 118 | 11 / **11** / 11 |
| ETH | 98 / **100** / 101 | 10 / **12** / 12 |
| SOL | 26 / **28** / 29 | 10 / **13** / 13 |
| BNB | 23 / **24** / 24 | 10 / **10** / 12 |
| AVAX | 11 / **12** / 12 | 5 / **5** / 7 |
| XRP | 12 / **12** / 12 | 5 / **5** / 5 |

Book fetch latency: 89–572 ms, median 356 ms.

---

## Three corrections to the PRD, all measurement-driven

### 1. `isCall === false` does **not** mean "vanilla put"

The PRD's selection rule — "maker orders with `isCall: false, isLong: false`" —
matches **four different instruments** on the live book:

| Implementation | Live count | Why it is not a protective put |
|---|---|---|
| `PUT` | 56 | ✅ this is the one we want |
| `PUT_SPREAD` | 21 | caps the protection at the lower strike |
| `PUT_FLY` | 6 | not downside protection at all |
| `PHYSICAL_PUT` | 39 | settles in the underlying, which a USDC burner cannot deliver |

`PHYSICAL_PUT` also carries `isLong: true`, a different direction convention — so
the `isLong` clause is not redundant.

**Fix:** selection additionally requires `implementation === PUT` (`0x7355EB92…`)
and `strikes.length === 1`. Without this the agent buys a spread and calls it
protection. See `isVanillaPut()` in `lib/assets.ts`.

### 2. Premium capacity is bounded far below `availableAmount`

A quote advertising `availableAmount: 10,000 USDC` on a $1.23 put can absorb about
**$5** of premium, not $10,000: the maker's collateral backs
`maxCollateralUsable / strike ≈ 4.1` contracts, and each costs the premium.

Sizing against `availableAmount` builds a transaction the contract rejects. The
executor sizes against `maxPremiumRawFor()`, and `scripts/probe-book.ts` asserts
that local formula against the SDK's own `calculateMaxContracts` for **every live
vanilla put on every run** (currently 56/56 exact).

### 3. Collateral must be a token the burner actually holds

Collateral on the live book: USDC 190, aBasUSDC 63, cbBTC 22, aBasWETH 15. Only
USDC is payable by a USDC-funded burner. All 56 vanilla puts happen to be
USDC-collateralised today, but that is a property of the book, not a guarantee —
so selection filters on an explicit allowlist (`collateralTokens`, default USDC).

This also contains a smaller risk: the SDK chain config declares `cbDOGE` (8dp)
and `cbXRP` (6dp), but neither address answers `decimals()` on Base
(`npm run identify:tokens`). Their scales are therefore unverified. The USDC-only
default means they can never be paid in without an explicit opt-in.

---

## ⚠️ Planning constraint — the graded position cannot be opened a week early

`PROJECT-PLAN.md` §4 says to select an expiry **at least a week out** for the
position judges will inspect. **That is not currently possible with a vanilla put.**

Longest-dated vanilla put on the book: **51.6 hours**. The vanilla PUT calendar is
near-dailies only:

| Expiry | ETH | BTC | SOL | XRP | BNB | AVAX |
|---|---|---|---|---|---|---|
| +3.6 h | 1 | 1 | 2 | 1 | 4 | 1 |
| +27.6 h | 4 | 4 | 9 | 4 | 6 | 4 |
| +51.6 h | 7 | 6 | — | — | — | — |

Everything beyond 7 days (100 orders, out to 1,468 h) is `PHYSICAL_PUT`,
`PHYSICAL_CALL`, `PUT_SPREAD`, `CALL_SPREAD`, `PUT_FLY`, `CALL_FLY`, or `RANGER` —
no cash-settled vanilla puts.

`--min-expiry-hours 168` therefore fails cleanly with `NO_FILLABLE_ORDER` and a
funnel showing `expiryHorizonOk: 0`, rather than silently buying the wrong thing.

**Practical resolution:** open the graded position on **4–5 September** with the
~51 h tenor, so it is still live during judging on 6 September. Opening it earlier
means it expires before anyone looks at it. Re-check the calendar first — new
tenors appear continuously, and the venue may list a weekly vanilla put by then.

---

## Design notes

**Pipeline order is enforced, not documented.** `executeHedge` re-fetches the book
itself and has no parameter through which a caller could pass a stale order. With
a worst-case 57 s quote life, an order held across a verification round is dead.

**Two independent guards on the asset.** The `priceFeed` lookup resolves the
asset; a strike-vs-spot cross-check then rejects anything implausible. A swapped
feed map would put the strike orders of magnitude from spot and the second guard
would catch it. Live deviations are all under 3%; the band is 60%.

The map itself is triple-sourced: the PRD's six verified feeds, the SDK's chain
config (which adds DOGE and PAXG), and live re-clustering. Loading `lib/assets.ts`
**throws** if the first two disagree, and `npm run build:asset-map` exits non-zero
if live clustering disagrees with either. Currently all three agree, with every
match within 2.26% and each runner-up 30–4,000× further away.

**Decode and selection are pure.** No RPC URL, no provider, no network — so they
are fully testable offline and cannot fail for a config reason mid-trade.

**Sizing is exact-decimal throughout.** No float ever touches a money value.
`mulDecimal('1.628087', '2440', 6)` returns `3972.53228`, not
`3972.5322799999997`.

**Approvals are exact.** `approvalAmountRaw` equals the premium to the wei; the
constant `MaxUint256` appears nowhere in the codebase.

**Errors carry their wire contract.** `AppError` holds the `ErrorCode`, HTTP
status, and retryability from PRD §9.2, so any layer can produce a correct
response without a translation table. `mapSdkError` translates the SDK's own error
codes at the boundary.

**A failed attestation never fails the hedge.** The ladder records each failure and
falls through to `OFFCHAIN_ONLY`, which cannot fail.

---

## Sample dry run (live book, 2026-08-30)

```
ETH $2440 PUT · expires 2026-08-30T08:00:00Z (3.72h out)
  priceFeed        0x71041ddd…  ← the asset discriminator
  underlyingToken  0x42000000…  (NOT used to identify the asset)
  strike deviation 0.71% from spot $2457.37
  delta -0.0957 · iv 0.2637 · quote TTL 85.4s at fetch, 85.4s at build (41ms)

  premium          $3.00 USDC   (raw 3000000)
  contracts        2.441634
  notional cover   $5,957.59    = contracts × strike
  cost of cover    0.050% of notional

  approve exactly  3000000 to 0x1bDff855…   ← not MaxUint256
  fill             0xa4761ec1, 740 bytes, chainId 8453
  → stopped before signing
```

For comparison, the PRD's anchoring number was 0.09% of notional; this fill is
0.050%. Both are real quotes, minutes apart in market terms — the point stands
either way.

---

## 🔴 RESOLVED V6 — there is no early unwind, and recovery is 0%

Static-called against the real open position `0x8d28b640…8240`, for zero gas:

| Path | Result |
|---|---|
| `close()` | **reverts — "Buyer and seller same to close"** |
| `reclaimCollateral()` | reverts — "Only seller can reclaim" |
| `returnExcessCollateral()` | succeeds, returns **0** |
| `transfer(isBuyer, target)` | succeeds — but it is a *gift*, not a sale |
| `split()` | reverts — "Incorrect split fee", and does not exit anyway |

`close()` annihilates a position only when **one address holds both sides**. We
hold the long side alone.

And there is nobody to sell to: **0 of 89 live vanilla PUT quotes carry
`isLong: true`.** The market maker only ever *sells* puts; it never bids for
them. Only the PHYSICAL_* products quote `isLong: true`, and those are a
different instrument. There is no secondary market.

**Measured premium recovery on an early rollback: 0%.** The only exit is expiry.

This contradicts PRD §11 (`unwindPosition(… 'ROLLBACK')`), PRD §18 ("the
rollback path has been executed live … measured premium recovery is recorded"),
and PROJECT-PLAN §5 demo beat 6.

`unwindPosition()` now **refuses** rather than broadcasting a known revert, and
says why. Two honest replacements:

- **`abandonPosition()`** — records the policy decision to stop protecting.
  Sends nothing, because nothing can be sent. Realised PnL is the premium, in
  full, stated plainly.
- **`settlePosition()`** — measures what actually returns at expiry, from the
  burner's balance delta.

### The approved demo reframe: "the agent declines to spend"

`npx tsx scripts/decline-demo.ts` runs it live. Two readings of the same event,
priced against the same live book:

| | Truth | Agreement | Severity | Tier | Committed |
|---|---|---|---|---|---|
| Signal | 91 | 86% | 5 | `HEDGE_FULL` | $3.00 |
| Debunk | 91 | **31%** | 5 | `ESCALATE` | **$0.00** |

The truth score does not move. **Agreement alone flips the decision** — which is
exactly the difference between a consensus system and an averaging one.

The saving is real *only because the gate runs before the money moves*. That is
the whole argument for the AI gate, and it is a stronger beat than the recovery
story it replaces — which could not have been told honestly.

## ⚠️ The graded position must be fired 4–5 September

`scripts/open-graded-position.ts` picks the longest-dated vanilla put that
survives a stated deadline, and **refuses** if none does. Run today it refuses,
correctly:

```
2026-09-01T08:00Z   4 quotes  16.1h out  ✗ expires first
2026-09-02T08:00Z   6 quotes  40.1h out  ✗ expires first
2026-09-03T08:00Z   8 quotes  64.1h out  ✗ expires first
✗ NO ETH vanilla put survives 2026-09-06T23:59Z
```

The vanilla-put tenor has grown from ~52h to ~64h over two days, so firing on
**4–5 Sep** yields a 7–8 Sep expiry that clears judging on the 6th.

```bash
npx tsx scripts/open-graded-position.ts                  # dry run, shows the calendar
npx tsx scripts/open-graded-position.ts --live --confirm
```

## What is still open

| Item | Blocked on | Ready |
|---|---|---|
| Measured settlement (V6, expiry leg) | position expiry, 2026-09-01T08:00Z | `scripts/settle-position.ts` |
| Graded position | the calendar — fire 4–5 Sep | `scripts/open-graded-position.ts` |
| Real Gonka request IDs in attestations | M2's verification layer | the payload field is wired |
| Postgres position store | M2/M3's schema | the file store implements the same resolver contract |

**V4 (minimum fill granularity) is answered:** a $0.50 fill lands cleanly, and
the binding floor is the quote's own premium capacity, not a protocol minimum.

---

## Newly measured on the first fill

**The protocol fee is 12.5% of premium.** `OrderFilled` reported
`feeCollected = 0.062499` on `premiumAmount = 0.499999`. The transfers confirm
the split:

```
0.437500 USDC   burner → market maker                  (maker's net premium)
0.062499 USDC   burner → OptionBook                    (protocol fee)
690.32614 USDC  maker  → OptionBook → option contract  (collateral escrow)
```

The fee sits **inside** the quoted price, not on top of it — we paid exactly
`price × contracts`. But the maker nets 87.5%, and any round trip pays it twice.
The PRD does not mention this fee anywhere.

**The decoder is confirmed against the contract's own arithmetic**, from the
chain rather than from our code:

1. Escrowed collateral `690.32614 USDC` equals this codebase's
   `contracts × strike` exactly.
2. `calculatePayout()` matches `(2380 − price) × 0.290053` at every probed
   settlement price — $2,000 → `110.22014`, $2,200 → `52.20954`, ≥$2,380 → `0`.

**Rounding is one micro-USDC.** Planned 0.500000, on-chain 0.499999, from the
contract's integer division. The executor detects the divergence, warns, and
reports the on-chain figure over its own.

## The broadcast sequence, and why it is ordered that way

1. **Approve the exact premium.** The fill pulls collateral via `transferFrom`,
   so without this it reverts on allowance.
2. **Re-check the quote TTL.** The approval costs a block or two and quotes live
   57–117 s. Aborting here leaves only a spent approval, which is recoverable;
   aborting after the fill is not.
3. **Static-call the fill.** `eth_call` against real contract state proves the
   transaction would succeed for zero gas, turning a would-be revert into a
   clean typed error.
4. **Send it**, then read `OrderFilled` for the authoritative option address,
   premium, and fee.

## Operator scripts

```bash
npm run typecheck && npm test          # 114 tests, no network

npx tsx scripts/health.ts --expect-address 0x…   # gates a live run, exits non-zero on any problem
npx tsx scripts/probe-book.ts                    # decode the book, assert every 🔒 invariant
npx tsx scripts/dry-run-hedge.ts --asset ETH --budget 3.00
npx tsx scripts/decline-demo.ts                  # the AI-gate beat, live, signs nothing
npx tsx scripts/open-graded-position.ts          # the judged position (fire 4–5 Sep)
npx tsx scripts/settle-position.ts               # list; add nsh_… --probe to inspect exits
npx tsx scripts/inspect-tx.ts 0x…                # decode a fill or an attestation from a hash alone
npx tsx scripts/inspect-position.ts 0x…          # probe every exit path, zero gas
npx tsx scripts/import-position.ts 0x… --attestation 0x…   # rebuild a record from chain
```

`inspect-tx.ts` is the verifier a judge could run: given only a transaction
hash it decodes the attestation calldata back to its canonical line and links
it to the fill it attests.

## Safety properties, all enforced in code

- **Exact approvals.** `MaxUint256` appears nowhere in the codebase.
- **Contract allowlist.** The agent may only call the OptionBook; an order
  naming a different book is rejected before signing.
- **Hard ceiling.** `HARD_CEILING_USDC` is applied in the sizing path; no
  request parameter can raise it.
- **One open hedge per asset** (PRD §10.6), enforced against the position store
  and overridable only with an explicit `--allow-duplicate`.
- **Dry run by default.** `--live` requires a signer, and the graded-position
  script additionally requires `--confirm`.
- **A stored quote is always stale.** Records carry `quoteIsStale: true` and
  `raw` flattened to strings; nothing re-signs from disk.
