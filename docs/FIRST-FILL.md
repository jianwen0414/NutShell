# First real fill — Base mainnet

Stage 4 exit condition **met**. A protective put exists on Base mainnet, bought
by the agent, with an on-chain attestation linking it to its correlation ID.

## Transactions

| Leg | Hash | Gas | Fee |
|---|---|---|---|
| Approve (exact 0.50 USDC) | [`0x416c41a6…49bd`](https://basescan.org/tx/0x416c41a63aafa0f8fd0c92d28692daab10a1139bb7f908e0b59ae85e859149bd) | 55,437 | 0.00000033 ETH |
| Fill | [`0xe2d5fcce…1b2d`](https://basescan.org/tx/0xe2d5fcce87e8895a87e4bc715d6253a4bfb43df46235a728ae6b6a46d62c1b2d) | 646,036 | 0.00000388 ETH |
| Attestation (SELF_TX) | [`0x934bb8bc…35f2`](https://basescan.org/tx/0x934bb8bcd17ac83e9e46f05e0ad0756d35a7e9a38d5170831b3dec75656635f2) | 28,720 | 0.00000017 ETH |

Total gas for the full open + attest: **0.0000044 ETH ≈ $0.011**.

## Position

| | |
|---|---|
| Option contract | [`0x8d28b6408547cd6057439BB1344EAEE8377E8240`](https://basescan.org/address/0x8d28b6408547cd6057439BB1344EAEE8377E8240) |
| Instrument | ETH $2,380 PUT, cash-settled, vanilla |
| Contracts | 0.290053 |
| Premium paid | 0.499999 USDC |
| Collateral escrowed by maker | 690.32614 USDC |
| Spot at entry | $2,459.32 |
| Delta at entry | −0.0562 |
| Expiry | 2026-09-01T08:00:00Z |
| Buyer | `0xB792296bE8202ba2fc5D3276fA184e5B479920E3` (our burner) |
| Seller | `0xEcda1D002FBC55F2Fd3386bB4B9B95F859f3C39E` (the market maker) |
| Correlation ID | `nsh_594136d67152559c` |

## Decoder validation against the contract's own arithmetic

Two independent confirmations that the decode is right, from the chain rather
than from our own code:

1. **Collateral escrowed = 690.32614 USDC**, exactly the notional this codebase
   computed as `contracts × strike` (0.290053 × 2380).
2. **Payout curve** read from `calculatePayout()`:

   | ETH settles | Contract says | `(2380 − px) × 0.290053` |
   |---|---|---|
   | $2,000 | 110.22014 | 110.22014 |
   | $2,200 | 52.20954 | 52.20954 |
   | $2,380 | 0 | 0 |
   | $2,459 | 0 | 0 |

   Exact to the last decimal at every point.

## Newly measured: the protocol fee is 12.5% of premium

`OrderFilled` reports `feeCollected = 0.062499` on `premiumAmount = 0.499999`
— **12.5%**. The transfers confirm the split:

```
0.437500 USDC  burner → market maker      (the maker's net premium)
0.062499 USDC  burner → OptionBook        (protocol fee)
690.32614 USDC maker  → OptionBook → option contract  (collateral escrow)
```

The fee is **inside** the quoted price, not added to it — we paid exactly the
quoted `price × contracts`. But it means the maker nets 87.5% of quote, and any
round trip pays it twice. The PRD does not mention this fee anywhere.

## Rounding: 1 unit of USDC

Planned premium 0.500000, on-chain 0.499999 — one micro-USDC, from the
contract's integer division on `contracts × price`. The executor detects the
divergence, warns, and reports the on-chain figure rather than its own.
