# The cash-settled synthetic path, proven on mainnet

PRD §3.4 calls asset identification "the highest-severity design decision" and
warns that getting it wrong "will look like it is working." The hardest case is
the **zero-address underlying**: SOL, XRP, BNB and AVAX are cash-settled
synthetics with no ERC-20 on Base, so `underlyingToken` is
`0x0000000000000000000000000000000000000000` and the asset is knowable *only*
from `rawApiData.priceFeed`.

Decoding proved that in the read path. This proves it with real money.

## The fill

| Leg | Hash |
|---|---|
| Approve (exact 0.50) | [`0xe23ccc13…1b26`](https://basescan.org/tx/0xe23ccc13321dc69d63d2cec7f5db2aebc147c665178ed2820d3c16aabecc1b26) |
| Fill | [`0xda94b0b8…85a7`](https://basescan.org/tx/0xda94b0b8becfb269daf164a56315cb14648db52e147f607dec70f13562c385a7) |
| Attestation | [`0x68228834…951f`](https://basescan.org/tx/0x68228834c3de1c50001c5524f3df11883ebe267421850b22696bb310b62b951f) |

| | |
|---|---|
| Option contract | [`0xae8BdC753F866Ff31a467A07b5Ed787A1674a5A2`](https://basescan.org/address/0xae8BdC753F866Ff31a467A07b5Ed787A1674a5A2) |
| Instrument | SOL $97 PUT, cash-settled |
| Contracts | 1.839443 |
| Premium | 0.499999 USDC |
| Collateral escrowed | 178.425971 USDC |
| Expiry | 2026-09-02T08:00:00Z |
| Correlation ID | `nsh_1242cd71e9932302` |

## The proof

The quote carried `underlyingToken = 0x0`. The agent identified it as SOL from
the price feed alone. Reading the **deployed option contract** back:

```
option.chainlinkPriceFeed()  →  0x975043adBb80fc32276CbF9Bbcfd4A601a12462D
our registry resolves it     →  SOL
```

That is the same feed the registry keyed on, now confirmed by the contract the
protocol itself deployed. The agent hedged the asset it believed it was hedging.

`calculatePayout()`, read from the contract, matches `(97 − price) × 1.839443`
to the last decimal at every point:

| SOL settles | Contract | Expected |
|---|---|---|
| $70 | 49.664961 | 49.664961 |
| $80 | 31.270531 | 31.270531 |
| $90 | 12.876101 | 12.876101 |
| $97 | 0 | 0 |
| $105 | 0 | 0 |

And escrowed collateral `178.425971 USDC` equals this codebase's
`contracts × strike` exactly.

## What this closes

All six assets are now proven executable, across both underlying conventions:

| Convention | `underlyingToken` | Assets | Proven by |
|---|---|---|---|
| ERC-20 backed | WETH / WBTC | ETH, BTC | ETH fill, 31 Aug |
| **Cash-settled synthetic** | **`0x0`** | **SOL, XRP, BNB, AVAX** | **SOL fill, 1 Sep** |

PROJECT-PLAN §3 enhancement #5 ("multi-asset hedging beyond ETH") is no longer
research — it is a policy-layer decision over a proven execution path.

The fee behaves identically on the synthetic path: `feeCollected` 0.062499 of
premium 0.499999 — 12.5%, inside the quoted price.
