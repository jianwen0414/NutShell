# NutShell Frontend

Next.js App Router frontend and thin API layer for NutShell.

Member 3 owns this surface:

- Public verify screen at `/`
- Dashboard at `/dashboard`
- Position lifecycle at `/position/[cid]`
- Operator panel at `/operator`
- Contract-shaped API route stubs under `/app/api`
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

The API routes return PRD-shaped mock data. Replace internals as M1/M2 land Gonka,
Thetanuts, and database integrations; keep the exported shapes stable.

## Environment

Copy `.env.example` to `.env` and fill real values before integration work.

Do not expose `THETANUTS_PRIVATE_KEY` to client components or public routes.
