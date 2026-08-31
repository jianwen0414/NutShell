# NutShell

Next.js App Router UI, the API layer, and the agent worker.

- Public verify screen at `/`
- Dashboard at `/dashboard`
- Position lifecycle at `/position/[cid]`
- Operator panel at `/operator`
- API routes under `/app/api`
- Verification, policy and vault in `/lib`
- Agent loop and pipeline in `/worker`
- Shared contracts in `/types/index.ts`

## Getting Started

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

Run the worker stub in a second terminal:

```bash
npm run worker
```

## Current State

Verification, consensus, policy, asset mapping and the simulated vault are live
against the real Gonka network. Trade execution and attestation are still
interfaces waiting on their implementations, and job storage is in-memory until
a database is wired.

```bash
npm run dev          # UI and API
npm run worker       # agent loop, second terminal
npm run demo         # one alert through the whole pipeline
npm run test:all     # 89 tests, no network needed
npm run diag:kimi    # which models are healthy right now
npm run verify:chain # confirm the on-chain links resolve
```

## Environment

Copy `.env.example` to `.env` and fill real values before integration work.

Do not expose `THETANUTS_PRIVATE_KEY` to client components or public routes.
