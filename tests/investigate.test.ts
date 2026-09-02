import { describe, expect, it } from 'vitest';
import {
  ASSET_ALIASES,
  ENTITY_REGISTRY,
  STABLECOIN_FEEDS,
  activityTarget,
  balanceDeltaTarget,
  claimAspects,
  custodialTarget,
  primaryAsset,
  primarySlug,
  resolveTargets,
  stablecoinAssets,
  tradeableAssetTarget,
} from '../lib/entities';
import { renderEvidenceForPrompt, evidenceHeadline, investigationConfig, BLOCK_TIME_S, LOG_WINDOW_BLOCKS } from '../lib/investigate';
import { renderAlert } from '../lib/gonka';
import { SIMULATOR_SCENARIOS } from '../lib/simulator';
import { TRADEABLE_ASSETS } from '../lib/event-mapping';
import type { AlertEvent, EvidencePacket, InvestigationCheck } from '../types/index';

// ─── Fixtures ─────────────────────────────────────────────────────────────

const check = (over: Partial<InvestigationCheck> = {}): InvestigationCheck => ({
  id: 'BALANCE_DELTA',
  title: 'Custodied balance vs 1h / 24h ago',
  stance: 'CORROBORATES',
  summary: 'Balance fell 40%.',
  facts: { usdcNow: 1, usdc1hAgo: 2 },
  method: 'balanceOf',
  source: 'BASE_RPC',
  latencyMs: 10,
  ...over,
});

const packet = (over: Partial<EvidencePacket> = {}): EvidencePacket => ({
  correlationId: 'nsh_0000000000000000',
  targets: [{ kind: 'PROTOCOL', name: 'Morpho', matchedOn: 'morpho', confidence: 'EXACT' }],
  checks: [check()],
  corroborating: 1,
  contradicting: 0,
  inconclusive: 0,
  unavailable: 0,
  blockNumber: 50_786_000,
  blockTimestamp: '2026-09-02T15:00:00.000Z',
  investigatedAt: '2026-09-02T15:00:00.000Z',
  totalLatencyMs: 1200,
  noTargetResolved: false,
  budgetExhausted: false,
  promptBlock: '',
  ...over,
});

const alert = (rawText: string): AlertEvent => ({
  id: 'nsh_0000000000000000',
  source: 'SIMULATOR',
  rawText,
  receivedAt: '2026-09-02T15:00:00.000Z',
  clusterKey: 'k',
});

// ─── Entity resolution ────────────────────────────────────────────────────

describe('resolveTargets', () => {
  it('does not fire on substrings inside ordinary words', () => {
    // The dangerous case: "insolvent" contains "sol", "method" contains "eth".
    // Both appear in real alert prose, and matching them would resolve the
    // wrong asset — PRD §3.4's most damaging bug.
    const targets = resolveTargets('The exchange is insolvent and the method was never disclosed together.');
    expect(targets.map((t) => t.name)).not.toContain('SOL');
    expect(targets.map((t) => t.name)).not.toContain('ETH');
  });

  it('resolves assets named properly', () => {
    expect(primaryAsset(resolveTargets('12,400 WETH drained'))).toBe('ETH');
    expect(primaryAsset(resolveTargets('Solana validators halted'))).toBe('SOL');
    expect(primaryAsset(resolveTargets('BTC fell sharply'))).toBe('BTC');
  });

  it('marks a catch-all bridge match BROAD and a named one EXACT', () => {
    const broad = resolveTargets('a cross-chain bridge on Base was drained')
      .find((t) => t.name === 'Base Bridge');
    expect(broad?.confidence).toBe('BROAD');

    const exact = resolveTargets('the Base Bridge was drained')
      .find((t) => t.name === 'Base Bridge');
    expect(exact?.confidence).toBe('EXACT');
  });

  it('extracts and checksums a literal address, marking it EXACT', () => {
    const targets = resolveTargets('attacker at 0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb moved funds');
    const hit = targets.find((t) => t.address);
    expect(hit?.address).toBe('0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb');
    expect(hit?.confidence).toBe('EXACT');
    // A known address resolves to its registry identity rather than a bare hex string.
    expect(hit?.name).toBe('Morpho');
  });

  it('ignores a malformed hex run that is not a valid address', () => {
    const targets = resolveTargets('see 0xZZZ and 0x1234');
    expect(targets.filter((t) => t.kind === 'ADDRESS')).toHaveLength(0);
  });

  it('returns nothing for a claim naming nothing checkable', () => {
    expect(resolveTargets('Something bad is happening. Trust me.')).toHaveLength(0);
  });

  it('does not duplicate a target matched twice', () => {
    // Four mentions of the same thing must not become four targets. USDC does
    // legitimately resolve twice — once as the token CONTRACT, which is what
    // the pause probe reads, and once as the ASSET, which is what the peg check
    // reads — but never more than once per kind.
    const targets = resolveTargets('USDC USDC usdc circle');
    const usdc = targets.filter((t) => t.name === 'USDC');
    expect(usdc).toHaveLength(2);
    expect(new Set(usdc.map((t) => t.kind)).size).toBe(2);
    expect(usdc.filter((t) => t.kind === 'TOKEN')).toHaveLength(1);
    expect(usdc.filter((t) => t.kind === 'ASSET')).toHaveLength(1);
  });
});

describe('per-check target selection', () => {
  it('never runs a balance delta against a token contract', () => {
    // Measured regression: WETH resolved from "12,400 WETH", and a balance
    // delta on the WETH contract reported its own $594M of backing as
    // unchanged — a confident CONTRADICTS about something the claim was not
    // about.
    const targets = resolveTargets('12,400 WETH drained from a vault');
    expect(targets.some((t) => t.name === 'WETH')).toBe(true);
    expect(balanceDeltaTarget(targets)?.kind).not.toBe('TOKEN');
  });

  it('excludes non-custodial protocols from the balance delta', () => {
    // Aave v3 keeps reserves in aTokens; its Pool held 114 USDC when measured.
    const targets = resolveTargets('Aave was exploited');
    expect(targets.some((t) => t.name === 'Aave v3')).toBe(true);
    expect(balanceDeltaTarget(targets)).toBeUndefined();
  });

  it('includes a custodial protocol in the balance delta', () => {
    const targets = resolveTargets('Morpho was exploited');
    expect(balanceDeltaTarget(targets)?.name).toBe('Morpho');
    expect(custodialTarget(targets)?.name).toBe('Morpho');
  });

  it('prefers a named token for the transfer-rate sample', () => {
    expect(activityTarget(resolveTargets('USDC transfers spiked'))?.name).toBe('USDC');
  });

  it('checks the hedgeable asset AND the stablecoin when a claim names both', () => {
    // Regression: "liquidity is draining from ETH/USDC pools on Base" resolved
    // USDC first purely on registry order, took the stablecoin branch, and
    // never ran the ETH liquidity check the claim was actually about.
    const targets = resolveTargets('Liquidity is draining from ETH USDC pools on Base');
    expect(tradeableAssetTarget(targets)).toBe('ETH');
    expect(stablecoinAssets(targets)).toEqual(['USDC']);
  });

  it('returns no hedgeable asset when only a stablecoin is named', () => {
    const targets = resolveTargets('USDC has depegged');
    expect(tradeableAssetTarget(targets)).toBeUndefined();
    expect(stablecoinAssets(targets)).toEqual(['USDC']);
  });

  it('🔒 only ever offers one of the six as the hedgeable asset', () => {
    for (const claim of ['USDC depeg', 'DAI broke', 'tether wobbled', 'SOL exploit', 'BTC drained']) {
      const a = tradeableAssetTarget(resolveTargets(claim));
      if (a !== undefined) expect(TRADEABLE_ASSETS as readonly string[]).toContain(a);
    }
  });

  it('finds the DeFiLlama slug for a listed protocol', () => {
    expect(primarySlug(resolveTargets('Aerodrome pools drained'))?.defillamaSlug).toBe('aerodrome');
  });
});

describe('claimAspects', () => {
  it('reads a drain claim as CUSTODY, not PRICE', () => {
    const bridge = SIMULATOR_SCENARIOS.find((s) => s.id === 'scen_bridge_exploit')!;
    const aspects = claimAspects(bridge.rawText);
    expect(aspects).toContain('CUSTODY');
    // The scenario also says the team "paused deposits", so HALT is legitimate.
    expect(aspects).toContain('HALT');
  });

  it('reads a depeg claim as PRICE', () => {
    const depeg = SIMULATOR_SCENARIOS.find((s) => s.id === 'scen_usdc_depeg')!;
    expect(claimAspects(depeg.rawText)).toContain('PRICE');
  });

  it('reads a withdrawal freeze as HALT', () => {
    expect(claimAspects('A major exchange has frozen all ETH withdrawals')).toContain('HALT');
  });

  it('finds nothing in a claim that asserts nothing specific', () => {
    expect(claimAspects('Something bad is happening. Trust me.')).toEqual([]);
  });

  it('does not fire on substrings inside longer words', () => {
    // "peg" must not match "pegged back" style words via substring, and
    // "moved" must not match "removed".
    expect(claimAspects('The team removed a legacy contract.')).not.toContain('CUSTODY');
  });
});

describe('registry hygiene', () => {
  it('has lowercase aliases only, so matching is predictable', () => {
    for (const e of ENTITY_REGISTRY) {
      for (const a of [...e.aliases, ...(e.broadAliases ?? [])]) {
        expect(a).toBe(a.toLowerCase());
      }
    }
  });

  it('gives every entry either an address or a DeFiLlama slug', () => {
    for (const e of ENTITY_REGISTRY) {
      expect(Boolean(e.address || e.defillamaSlug)).toBe(true);
    }
  });

  it('covers the six tradeable assets plus the stablecoins the peg check needs', () => {
    for (const a of TRADEABLE_ASSETS) expect(ASSET_ALIASES[a]).toBeDefined();
    for (const a of Object.keys(STABLECOIN_FEEDS)) expect(ASSET_ALIASES[a]).toBeDefined();
  });

  it('🔒 keeps stablecoins out of the hedgeable set', () => {
    // Stage 02 may investigate a stablecoin; the agent may never hedge one,
    // because the book prices no USDC put. These two lists must not converge.
    for (const a of Object.keys(STABLECOIN_FEEDS)) {
      expect(TRADEABLE_ASSETS as readonly string[]).not.toContain(a);
    }
  });
});

// ─── Prompt rendering ─────────────────────────────────────────────────────

describe('renderEvidenceForPrompt', () => {
  it('always keeps the interpretation rules, however many checks there are', () => {
    // Regression: an earlier version appended the rules last and truncated the
    // whole block at the budget, cutting them mid sentence and leaving the
    // models measurements with no instruction on how to weigh them.
    const many = Array.from({ length: 40 }, (_, i) =>
      check({ title: `Check ${i}`, summary: 'x'.repeat(300) }),
    );
    const out = renderEvidenceForPrompt(packet({ checks: many }));
    expect(out).toContain('HOW TO READ THIS');
    expect(out).toContain('Cite the specific readings you relied on in keyEvidence.');
    expect(out).toContain('</ONCHAIN_EVIDENCE>');
    expect(out.length).toBeLessThanOrEqual(investigationConfig.promptCharBudget);
  });

  it('says so plainly when the claim named nothing checkable', () => {
    const out = renderEvidenceForPrompt(packet({ noTargetResolved: true, checks: [] }));
    expect(out).toContain('names no contract address');
    // Must not invite the models to read absence as disproof.
    expect(out).toContain('It is not evidence that the event did not happen.');
  });

  it('tells the models an UNAVAILABLE check says nothing about the claim', () => {
    const out = renderEvidenceForPrompt(
      packet({ checks: [check({ stance: 'UNAVAILABLE', error: 'RPC down' })] }),
    );
    expect(out).toContain('nothing whatsoever about the claim');
  });

  it('fits a realistic six-check packet without trimming any findings', () => {
    const six = Array.from({ length: 6 }, (_, i) =>
      check({ title: `Check number ${i}`, summary: 'A realistic one-line finding about the chain state.'.repeat(2) }),
    );
    const out = renderEvidenceForPrompt(packet({ checks: six }));
    expect(out).not.toContain('omitted for length');
    for (let i = 0; i < 6; i++) expect(out).toContain(`Check number ${i}`);
  });
});

describe('renderAlert', () => {
  it('is byte-identical to the no-evidence form when evidence is absent', () => {
    // The guarantee that a failed or skipped stage 02 costs verification
    // nothing: the prompt the models see is exactly what it was before.
    const a = alert('BREAKING: something happened');
    expect(renderAlert(a, undefined, undefined)).toBe(renderAlert(a));
    expect(renderAlert(a)).toContain('Judge the CLAIM on its own content.');
  });

  it('includes the evidence block and drops the bare-claim instruction', () => {
    const a = alert('BREAKING: something happened');
    const p = packet();
    p.promptBlock = renderEvidenceForPrompt(p);
    const out = renderAlert(a, undefined, p);
    expect(out).toContain('<ONCHAIN_EVIDENCE>');
    expect(out).toContain('where they conflict, the measurement is the more reliable of the two');
    expect(out).not.toContain('Judge the CLAIM on its own content.');
  });

  it('keeps the claim itself intact and first', () => {
    const p = packet();
    p.promptBlock = renderEvidenceForPrompt(p);
    const out = renderAlert(alert('the claim text'), undefined, p);
    expect(out.indexOf('<CLAIM>')).toBeLessThan(out.indexOf('<ONCHAIN_EVIDENCE>'));
    expect(out).toContain('the claim text');
  });
});

describe('evidenceHeadline', () => {
  it('tallies the stances', () => {
    const p = packet({
      checks: [check(), check({ stance: 'CONTRADICTS' }), check({ stance: 'UNAVAILABLE' })],
      corroborating: 1, contradicting: 1, inconclusive: 0, unavailable: 1,
    });
    expect(evidenceHeadline(p)).toBe('1 corroborating · 1 contradicting · 0 inconclusive · 1 unavailable');
  });

  it('is explicit when nothing was checkable', () => {
    expect(evidenceHeadline(packet({ noTargetResolved: true, checks: [] })))
      .toBe('No checkable entity named in the claim');
  });
});

// ─── Measured constants ───────────────────────────────────────────────────

describe('measured RPC constraints', () => {
  it('keeps the log window inside the free-tier 10-block cap', () => {
    // Measured: a 10-block span (fromBlock = toBlock - 9) succeeds; 11 returns
    // HTTP 400 / -32600. Raising this without a paid key breaks every
    // activity check.
    expect(LOG_WINDOW_BLOCKS + 1).toBeLessThanOrEqual(10);
  });

  it('uses the measured Base block time', () => {
    expect(BLOCK_TIME_S).toBe(2);
  });
});

// ─── The scenarios the demo actually runs ─────────────────────────────────

describe('simulator scenarios resolve sensibly', () => {
  it.each(SIMULATOR_SCENARIOS.map((s) => [s.name, s.rawText] as const))(
    '%s resolves at least one checkable target',
    (_name, rawText) => {
      expect(resolveTargets(rawText).length).toBeGreaterThan(0);
    },
  );

  it('resolves the bridge scenario to the bridge, not just the token', () => {
    const bridge = SIMULATOR_SCENARIOS.find((s) => s.id === 'scen_bridge_exploit')!;
    const names = resolveTargets(bridge.rawText).map((t) => t.name);
    expect(names).toContain('Base Bridge');
    expect(names).toContain('ETH');
  });
});
