# M1 ↔ M2/M3 integration

Merged `m1/web3-execution` into `feat/integration` on branch
`feat/integration-m1`. Twelve files conflicted; every one was resolved
deliberately rather than by taking a side.

## How each conflict was resolved

| File | Theirs | Mine | Resolution |
|---|---|---|---|
| `lib/thetanuts.ts` | `export {}` | full | **mine** — the slot was left empty for M1 |
| `lib/assets.ts` | `export {}` | full | **mine** |
| `lib/attestation.ts` | `export {}` | full | **mine** |
| `lib/decimals.ts` | 3 tokens, 34 lines | 9 tokens, 240 lines | **mine** — strict superset, same export names |
| `lib/errors.ts` | different `AppError` | different `AppError` | **merged** — accepts both call shapes |
| `types/index.ts` | PRD §7 + M2 fields | PRD §7 + M1 fields | **union** — both are additive |
| `package.json` | Next app | chain stack | **union** of deps and scripts |
| `tsconfig.json` | Next config | mine | **theirs** — Next needs its own |
| `.env.example` | Gonka/vault/policy | market safety | **union** |
| `.gitignore` | — | — | union, plus `/artifacts/` |
| `fixtures/order.eth-put-2400.json` | short signature | full signature | **mine** |
| `package-lock.json` | — | — | regenerated |

### `lib/decimals.ts` — why mine had to win

Their table carried USDC, WETH and cbBTC. The live book also collateralises in
**aBasUSDC (63 orders), aBasWETH (15) and cbBTC (22)**, and `decimalsFor()`
throws `ASSET_UNRESOLVED` on anything it does not know. Their version would
have refused 78 of 359 live orders. Mine carries all nine tokens, every one
verified on-chain by `npm run identify:tokens`, and exports the same names, so
their `scripts/test-decimals.ts` passes against it unchanged.

### `lib/errors.ts` — both constructor shapes

M1 and M2 wrote the same class with different signatures. Rewriting a dozen
call sites across three people's code is how an integration becomes a bug
hunt, so `AppError` now accepts both:

```ts
new AppError(code, message, { correlationId, details, cause })  // M1
new AppError(code, message, details, correlationId)             // M2
```

`toEnvelope()` takes an optional correlation id so `err.toEnvelope()` and
`err.toEnvelope(jobId)` both work, and `asAppError` is an alias of
`toAppError`.

### `types/index.ts` — a union, not a compromise

Both sides only ever ADDED to PRD §7, so nothing had to be given up. M2 keeps
`AlertSourceInfo`, `alertSourceType()`, `VoteFailure`, and the `chainShardId` /
`chainUrl` fields that make V3 resolvable. M1 adds the decode, execution,
settlement and attestation detail.

Two areas are deliberately **optional** — `HedgePosition.execution` and the M1
additions on `Attestation` — because a fixture, or a position rebuilt from
chain, honestly has none. `executeHedge()` and `attest()` return the narrower
`ExecutedPosition` and `CompleteAttestation`, so their callers get the fields
without a non-null assertion, and `requireExecution()` refuses clearly when a
lifecycle function is handed a planless position.

## What was wired

**`lib/execution-bridge.ts`** — the only place the two halves meet.
`worker/pipeline.ts` depends on two narrow interfaces, `Executor` and
`Attestor`, so it stays testable without a chain. This implements both:

- `ChainExecutor.execute(decision, { dryRun })` calls `executeHedge(…)` and
  then persists the position. It re-checks one-hedge-per-asset and the signing
  key before any live fill.
- `ChainAttestor.attest(verification, decision, position)` builds the evidence
  hash from the actual model verdicts, then calls `attest(…)`. A dry-run fill
  is never attested on-chain: a permanent record of a trade that did not happen
  would be a lie.
- `openHedgesForPolicy()` feeds `PolicyState.openHedges` from the real store,
  so PRD §10.6 binds during the decision, not only at the signing boundary.
- `chainDeps()` returns `{}` when there is no signing key, so a keyless process
  verifies and decides but cannot trade — correct, not degraded.

Wired into `worker/index.ts` and `lib/runtime.ts`.

## Routes now serving real data

| Route | Was | Now |
|---|---|---|
| `/api/health` | `status: "stub"` | live RPC, book depth, clock, burner balances |
| `/api/book/quotes` | one mock order | live decoded book, filterable, `raw` stripped |
| `/api/positions` | one fake position | the real position store |
| `/api/hedge/execute` | returned a fake fill | the full PRD §9.5 guard chain |
| `/api/hedge/[cid]/unwind` | claimed `realisedPnlUsdc: "-0.20"` | the measured truth: recovery is 0% |
| `/position/[cid]` | scripted sample | the real position, or a badged sample |

### The fabricated recovery is gone

The old unwind route returned `realisedPnlUsdc: "-0.20"`, implying most of the
premium came back. Measured on mainnet, **early recovery on this venue is 0%**:
`close()` reverts unless one address holds both sides, `reclaimCollateral()` is
seller-only, and 0 of the live vanilla PUT quotes bid for puts. The route now
records the honest outcome and states plainly that no transaction was sent and
why.

## The bigint hazard, closed

`DecodedOrder.raw` holds the untouched SDK object, whose fields are `bigint`.
`JSON.stringify` on an order **throws** — verified, not assumed:

```
JSON.stringify(DecodedOrder):       THROWS — Do not know how to serialize a BigInt
JSON.stringify(toJsonSafe(order)):  OK
```

Every route that returns an order or a position now strips `raw` (a browser has
no use for a signing payload) and passes the rest through `toJsonSafe()`. The
hazard is documented on the field itself in `types/index.ts`.

## Verified after integration

| Check | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| M1 vitest suite | **115 passed** |
| M2 `test:decimals` against M1's module | passed |
| M2 `test:consensus` / `test:policy` / `test:vault` | passed |
| M2 `test:worker` (pipeline) | **17 passed** |
| `next build` | clean, 20 routes |
| `/api/health` live | `status: "ok"`, 398 orders, 79 vanilla puts |
| `/api/book/quotes?asset=ETH` | live decoded orders, no bigint throw |
| `/api/positions` | the real SOL and ETH positions |
| Every page (`/`, `/dashboard`, `/control`, `/portfolio`, `/configuration`) | HTTP 200 |
| `/position/<real cid>` | real fill, BaseScan links, NSHv1 attestation line |

### The money route's guards, each tested live

| Guard | Result |
|---|---|
| Missing `Idempotency-Key` | `400 VALIDATION_FAILED` |
| Unauthenticated + `dryRun: false` | **dryRun forced true**, `entryTxHash: "0x"`, nothing spent |
| `sizeUsdc: "100.00"` | capped to **3** by `HARD_CEILING_USDC` |
| Idempotency replay | same response, `Idempotent-Replay: true` |
| `asset: "DOGECOIN"` | `ASSET_UNRESOLVED`, lists the supported set |
| `sizeUsdc: "0.01"` | `SIZE_BELOW_MINIMUM` |
| Unwind without operator token | `401 UNAUTHORIZED` |

## Two config gaps — not integration bugs

`.env` currently carries only `THETANUTS_RPC_URL` and `THETANUTS_PRIVATE_KEY`.

1. **`GONKA_API_KEY` is unset.** The pipeline wiring is correct and fails
   exactly as designed — a verify job ends `FAILED` with `GONKA_UNAVAILABLE`
   and the message "GONKA_API_KEY is not set". There is deliberately no
   non-Gonka fallback (PRD §16).
2. **`OPERATOR_TOKEN` is unset.** Every operator route therefore returns 401,
   including the operator panel. Verified against a temporary token that the
   authenticated paths work correctly.

Both are values only the team can supply. Copy `.env.example` and fill them in.

## Notes for whoever runs this next

- **Trading belongs in the worker.** `npm run worker` logs whether it holds a
  signing key at boot. In `next dev` the routes can also sign because the key
  is in the same `.env`, which is what lets the operator panel drive a real
  fill locally — but on Vercel that key must not exist (PRD §5.1).
- **`scripts/decline-demo.ts` still carries a transcribed copy of the PRD
  §10.4 policy matrix.** It is marked as a stand-in and should call
  `lib/policy.ts` instead. It is a demo script, not a path the pipeline uses.
- **The position store is file-backed** (`artifacts/positions/`, gitignored).
  It implements the same resolver contract the `positions` table will, so
  swapping to Postgres is a driver change. `installFileResolver()` runs at
  worker boot.
- **Alchemy's free tier caps `eth_getLogs` at 10 blocks.** Anything scanning
  history must page in 10-block windows. Point reads are unaffected, which is
  why the execution path uses only those.
- **M1 scripts now use `lib/env.ts`'s `loadEnv()`**, not `dotenv/config`, so
  there is one env-loading mechanism across the repo.
