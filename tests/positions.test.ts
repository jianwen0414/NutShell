/**
 * Position store tests — the stand-in for the `positions` table (PRD §8).
 *
 * The store is what makes a fill findable after the process exits. An
 * unrecorded position cannot be settled, attested against, or shown in the
 * UI, and the only way back is reconstructing it from chain.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The store resolves its directory at import time, so point it at a temp dir
// before importing. Each run gets a fresh directory.
const TMP = mkdtempSync(join(tmpdir(), 'nutshell-positions-'));
process.env.POSITION_STORE_DIR = TMP;

const {
  listPositions,
  loadPosition,
  loadRecord,
  openPositionFor,
  savePosition,
  settleablePositions,
} = await import('../lib/positions');
const { AppError } = await import('../lib/errors');

import type { HedgePosition } from '../types/index';

afterAll(() => rmSync(TMP, { recursive: true, force: true }));

function position(over: Partial<HedgePosition> = {}): HedgePosition {
  const base: HedgePosition = {
    correlationId: 'nsh_0000000000000001',
    status: 'OPEN',
    asset: 'ETH',
    strike: '2380',
    expiry: '2026-09-01T08:00:00.000Z',
    contracts: '0.290053',
    premiumPaidUsdc: '0.499999',
    notionalProtectedUsdc: '690.32614',
    entryTxHash: '0xe2d5fcce87e8895a87e4bc715d6253a4bfb43df46235a728ae6b6a46d62c1b2d',
    baseScanUrl: 'https://basescan.org/tx/0xe2d5',
    spotAtEntry: '2459.32',
    deltaAtEntry: -0.0562,
    openedAt: '2026-08-31T15:17:03.000Z',
    wasDryRun: false,
    optionAddress: '0x8d28b6408547cd6057439bb1344eaee8377e8240',
    execution: {
      dryRun: false,
      // Deliberately carries a bigint, to prove serialisation flattens it.
      selectedOrder: { orderHash: '0xabc', asset: 'ETH', raw: { nonce: 123n } } as never,
      snapshot: {} as never,
      selectionAttempts: 1,
      funnel: {} as never,
      premiumUsdc: '0.499999',
      premiumRaw: '499999',
      contracts: '0.290053',
      contractsRaw: '290053',
      approvalAmountRaw: '500000',
      existingAllowanceRaw: '0',
      approvalRequired: true,
      approvalTx: null,
      fillTx: {} as never,
      ttlAtBuildSeconds: 81.8,
      buildLatencyMs: 280,
      buildStartedAtMs: 1_788_000_000_000,
      warnings: [],
    },
    ...over,
  };
  return base;
}

beforeAll(() => {
  savePosition(position());
  savePosition(position({ correlationId: 'nsh_0000000000000002', asset: 'BTC', status: 'OPEN', expiry: '2020-01-01T00:00:00.000Z' }));
  savePosition(position({ correlationId: 'nsh_0000000000000003', asset: 'SOL', status: 'EXPIRED' }));
  savePosition(position({ correlationId: 'nsh_0000000000000004', asset: 'ETH', status: 'OPEN', wasDryRun: true }));
});

describe('round trip', () => {
  it('saves and reloads a position', () => {
    const p = loadPosition('nsh_0000000000000001');
    expect(p?.asset).toBe('ETH');
    expect(p?.premiumPaidUsdc).toBe('0.499999');
    expect(p?.optionAddress).toBe('0x8d28b6408547cd6057439bb1344eaee8377e8240');
  });

  it('flattens bigints so the record is valid JSON — PRD §7 invariant 2', () => {
    const raw = loadRecord('nsh_0000000000000001')?.position.execution.selectedOrder as { raw: { nonce: unknown } };
    expect(raw.raw.nonce).toBe('123');
    expect(typeof raw.raw.nonce).toBe('string');
  });

  it('🔒 marks every stored record as a stale quote', () => {
    // A quote read from disk expired long ago — this venue's quotes live
    // 57–117s. The flag exists so nothing is tempted to re-sign one.
    expect(loadRecord('nsh_0000000000000001')?.quoteIsStale).toBe(true);
  });

  it('returns null for an unknown id rather than throwing', () => {
    expect(loadPosition('nsh_00000000000000ff')).toBeNull();
  });

  it('overwrites in place on re-save', () => {
    savePosition(position({ status: 'UNWOUND' }));
    expect(loadPosition('nsh_0000000000000001')?.status).toBe('UNWOUND');
    savePosition(position()); // restore for later tests
    expect(loadPosition('nsh_0000000000000001')?.status).toBe('OPEN');
  });
});

describe('path safety', () => {
  it('refuses a malformed correlation id instead of building a path from it', () => {
    for (const bad of ['../../etc/passwd', 'nsh_short', 'nope', '', 'nsh_ZZZZZZZZZZZZZZZZ']) {
      expect(() => loadPosition(bad)).toThrow(AppError);
    }
  });
});

describe('queries', () => {
  it('filters by status and asset', () => {
    expect(listPositions({ status: 'EXPIRED' }).map((p) => p.asset)).toEqual(['SOL']);
    expect(listPositions({ asset: 'ETH' })).toHaveLength(2);
    expect(listPositions({ asset: 'eth' })).toHaveLength(2); // case-insensitive
  });

  it('reports positions past expiry as settleable', () => {
    // Pinned "now" — the fixtures carry real dates, so a wall-clock-dependent
    // assertion here silently changes meaning as those dates pass.
    const now = Date.parse('2026-08-31T12:00:00.000Z');
    const ready = settleablePositions(now).map((p) => p.correlationId);
    expect(ready).toContain('nsh_0000000000000002'); // expired 2020
    expect(ready).not.toContain('nsh_0000000000000001'); // expires 2026-09-01
  });

  it('includes a position once its expiry has passed', () => {
    const after = Date.parse('2026-09-01T08:00:01.000Z');
    expect(settleablePositions(after).map((p) => p.correlationId)).toContain('nsh_0000000000000001');
  });
});

describe('🔒 one open hedge per asset — PRD §10.6', () => {
  it('finds the open hedge for an asset', () => {
    expect(openPositionFor('ETH')?.correlationId).toBe('nsh_0000000000000001');
    expect(openPositionFor('BTC')?.correlationId).toBe('nsh_0000000000000002');
  });

  it('ignores dry runs — a rehearsal must never block a real hedge', () => {
    // nsh_…04 is an OPEN ETH position but wasDryRun, so …01 is still the one.
    expect(openPositionFor('ETH')?.wasDryRun).toBe(false);
  });

  it('ignores closed positions', () => {
    expect(openPositionFor('SOL')).toBeNull();
  });

  it('returns null for an asset with no position', () => {
    expect(openPositionFor('AVAX')).toBeNull();
  });
});
