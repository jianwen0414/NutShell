/**
 * Position store — a file-backed stand-in for the `positions` table (PRD §8).
 *
 * The database belongs to the backend (M2/M3). Until it exists, the execution
 * layer still needs somewhere durable to record what it opened, or a fill
 * becomes unfindable the moment the process exits — and an unfindable position
 * cannot be settled, attested against, or shown in the UI.
 *
 * This implements the same `PositionResolver` contract the real table will,
 * so swapping to Postgres is a driver change rather than a rewrite.
 *
 * 🔒 A stored order is ALWAYS a dead quote. Records here carry the full
 * `DecodedOrder` for audit, but `raw` round-trips through JSON with its
 * bigints flattened to strings and MUST NOT be fed back to a signer. Quotes on
 * this venue live 57–117 s; anything read from disk expired long ago. Re-fetch.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError, toJsonSafe } from './errors';
import type { Attestation, CorrelationId, HedgePosition, PositionStatus } from '../types/index';

const STORE_DIR = process.env.POSITION_STORE_DIR ?? join(process.cwd(), 'artifacts', 'positions');

export interface PositionRecord {
  position: HedgePosition;
  attestation?: Attestation;
  /** When this record was last written. */
  updatedAt: string;
  /**
   * 🔒 Always true. A quote read back from disk is expired by definition —
   * this flag exists so nothing downstream is tempted to re-sign it.
   */
  quoteIsStale: true;
}

function ensureDir(): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
}

function pathFor(cid: CorrelationId): string {
  if (!/^nsh_[0-9a-f]{16}$/.test(cid)) {
    throw new AppError('VALIDATION_FAILED', `Refusing to build a store path from a malformed id: "${cid}"`);
  }
  return join(STORE_DIR, `${cid}.json`);
}

/** Persist a position, overwriting any earlier record for the same id. */
export function savePosition(position: HedgePosition, attestation?: Attestation): string {
  ensureDir();
  const record: PositionRecord = {
    position: toJsonSafe<HedgePosition>(position),
    ...(attestation ? { attestation: toJsonSafe<Attestation>(attestation) } : {}),
    updatedAt: new Date().toISOString(),
    quoteIsStale: true,
  };
  const file = pathFor(position.correlationId);
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return file;
}

export function loadRecord(cid: CorrelationId): PositionRecord | null {
  const file = pathFor(cid);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8')) as PositionRecord;
}

export function loadPosition(cid: CorrelationId): HedgePosition | null {
  return loadRecord(cid)?.position ?? null;
}

export function listRecords(): PositionRecord[] {
  ensureDir();
  return readdirSync(STORE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(STORE_DIR, f), 'utf8')) as PositionRecord)
    .sort((a, b) => Date.parse(b.position.openedAt) - Date.parse(a.position.openedAt));
}

export function listPositions(filter?: { status?: PositionStatus; asset?: string }): HedgePosition[] {
  return listRecords()
    .map((r) => r.position)
    .filter((p) => {
      if (filter?.status && p.status !== filter.status) return false;
      if (filter?.asset && p.asset !== filter.asset.toUpperCase()) return false;
      return true;
    });
}

/** Positions that are OPEN and past their expiry — ready for settlement. */
export function settleablePositions(now = Date.now()): HedgePosition[] {
  return listPositions({ status: 'OPEN' }).filter((p) => Date.parse(p.expiry) <= now);
}

/**
 * 🔒 The one-open-hedge-per-asset invariant — PRD §10.6.
 *
 * A real crisis emits dozens of alerts within minutes. Without this the agent
 * fires N hedges on one event and empties the reserve.
 */
export function openPositionFor(asset: string): HedgePosition | null {
  return listPositions({ status: 'OPEN', asset }).find((p) => !p.wasDryRun) ?? null;
}

/** Register this store as the resolver `unwindPosition`/`settlePosition` use. */
export function installFileResolver(): void {
  // Imported lazily so a read-only consumer of this module never constructs
  // an RPC provider just by importing it.
  void import('./thetanuts').then(({ setPositionResolver }) => {
    setPositionResolver(async (cid) => loadPosition(cid));
  });
}

export const positionStoreDir = STORE_DIR;
