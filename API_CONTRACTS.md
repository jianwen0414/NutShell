# NutShell — MVP API Contracts & Integration Guide

> **Core Demo Flow**:
> Ingest Threat with Source ➔ 3 LLMs Verify in Parallel ➔ SSE Progress Stream ➔ Consensus Score ➔ Policy Decision ➔ Protective Option Executed ➔ Portfolio Updated

---

## 1. Ownership & Roles

| Member | Focus | Owns |
|---|---|---|
| **M1 (Web3 / Execution)** | Thetanuts Put Execution & Attestation | `lib/thetanuts.ts`, `lib/assets.ts`, `lib/attestation.ts`, Base mainnet trades |
| **M2 (AI / Backend)** | Multi-LLM Verification & Worker | `lib/gonka.ts`, `lib/consensus.ts`, `lib/policy.ts`, `worker/pipeline.ts` |
| **M3 (Lead / Frontend)** | Architecture, API Stubs, UI Demo | `types/index.ts`, `lib/decimals.ts`, `lib/simulator.ts`, Dashboard & Control UI |

---

## 2. 🥇 Tier 1: Core Hackathon Demo APIs (High Priority)

### 2.1 Multi-LLM Verification & Live SSE Stream

#### `POST /api/verify`
Submits a threat claim to trigger the parallel Gonka multi-LLM verification.
* **Request Body**:
```json
{
  "text": "Major Base bridge exploit reported with $40M in suspicious outflows.",
  "source": {
    "type": "ON_CHAIN",
    "name": "Base Bridge Telemetry",
    "credibilityScore": 98,
    "url": "https://basescan.org/address/0x..."
  }
}
```
* **Response `202 Accepted`**:
```json
{
  "jobId": "nsh_c89f2a01",
  "status": "QUEUED",
  "streamUrl": "/api/verify/nsh_c89f2a01/stream"
}
```

#### `GET /api/verify/[jobId]/stream` *(The Visual Centerpiece of the Demo)*
Server-Sent Events (SSE) stream demonstrating NutShell thinking in real time.
* **Emitted Events**:
  1. `event: status` ➔ `{"status": "VERIFYING", "message": "Querying 3 LLMs in parallel..."}`
  2. `event: verdict` ➔ Emitted as each model finishes:
     ```json
     {
       "modelId": "MiniMaxAI/MiniMax-M2.5",
       "stance": "REAL",
       "claimScore": 86,
       "evidence": "Anomalous contract drain detected on bridge address.",
       "gonkaRequestId": "gonka_req_mm_894f2a"
     }
     ```
  3. `event: consensus` ➔ `{"truthScore": 84, "agreement": 0.92, "stance": "REAL"}`
  4. `event: decision` ➔ `{"tier": "HEDGE_FULL", "bindingCap": "RESERVE_USDC"}`
  5. `event: position` ➔ `{"asset": "ETH", "strike": "2400", "status": "OPEN", "baseScanUrl": "..."}`
  6. `event: done` ➔ `{"status": "ATTESTED"}`

---

### 2.2 Event Ingestion & Simulation Feed

#### `GET /api/events`
Returns recent ingested threat signals with structured source metadata for the dashboard feed.
* **Response `200 OK`**:
```json
[
  {
    "id": "nsh_e74a92",
    "rawText": "Base Bridge $40.2M anomalous outflow detected to unverified mixer.",
    "source": {
      "type": "ON_CHAIN",
      "name": "On-Chain Bridge Telemetry",
      "credibilityScore": 98
    },
    "receivedAt": "2026-08-30T06:40:00Z"
  }
]
```

#### `POST /api/simulate/inject`
Triggers an immediate demo event injection to show how the system reacts.
* **Request Body**:
```json
{
  "scenarioId": "bridge_exploit" // or "depeg_rumor", "unwind_rollback"
}
```

---

### 2.3 Protective Option Execution & Rollback

#### `POST /api/hedge/execute`
Executes the protective put option fill on Thetanuts OptionBook (Base mainnet).
* **Request Body**:
```json
{
  "correlationId": "nsh_c89f2a01",
  "targetAsset": "ETH",
  "targetSizeUsdc": "2.50",
  "dryRun": false
}
```
* **Response `200 OK`**:
```json
{
  "correlationId": "nsh_c89f2a01",
  "status": "OPEN",
  "asset": "ETH",
  "strike": "2400",
  "premiumPaidUsdc": "2.15",
  "notionalProtectedUsdc": "2443.00",
  "entryTxHash": "0x7355eb92dfb0503db558a70c10843618932ab290",
  "baseScanUrl": "https://basescan.org/tx/0x7355eb92dfb0503db558a70c10843618932ab290"
}
```

#### `POST /api/hedge/[cid]/unwind`
Unwinds the put option when intelligence debunks the crisis, recovering unused premium.
* **Response `200 OK`**:
```json
{
  "correlationId": "nsh_c89f2a01",
  "status": "UNWOUND",
  "premiumRecoveredUsdc": "1.85",
  "realisedPnlUsdc": "-0.30"
}
```

---

### 2.4 Portfolio & Vault Ledger

#### `GET /api/vault`
Returns current yield reserve accounting and protected principal.
* **Response `200 OK`**:
```json
{
  "principalUsdc": "100000.00",
  "premiumReserveUsdc": "142.50",
  "dailySpentUsdc": "2.15",
  "isSimulated": true
}
```

#### `GET /api/positions`
Returns open and historical protective option positions.
* **Response `200 OK`**: Array of `HedgePosition` objects.

---

## 3. 🥈 Tier 2: Developer & Telemetry Utilities (Secondary)

* `GET /api/health` — Diagnostics check for Gonka API & Base RPC latency.
* `GET /api/book/quotes` — Raw Thetanuts orderbook snapshot (used by worker for strike selection).

---

## 4. Shared Helpers Reference

### Types (`types/index.ts`)
```ts
import type { AlertEvent, AlertSourceInfo, ModelVerdict, HedgePosition, JobStatus } from "@/types";
```

### Decimal Helpers (`lib/decimals.ts`)
```ts
import { decodePrice, decodeAmount } from "@/lib/decimals";
decodePrice("240000000000"); // -> "2400"
decodeAmount("10000000000", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"); // -> "10000"
```
