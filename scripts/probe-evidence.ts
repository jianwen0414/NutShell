/**
 * Stage 02 against reality — the fastest way to see what the investigation
 * actually finds, and to re-verify the registry when something looks wrong.
 *
 * Two modes:
 *   npm run probe:evidence            run every simulator scenario
 *   npm run probe:evidence -- "text"  run one claim of your own
 *
 * Prints each check's stance, summary, facts and latency, then the exact block
 * that would be handed to layer 1. Nothing here calls Gonka, so it is free to
 * run as often as you like.
 */

import { loadEnv } from '../lib/env';
loadEnv();

import { ethers } from 'ethers';
import { investigate, evidenceHeadline, BLOCK_TIME_S, LOG_WINDOW_BLOCKS, investigationConfig } from '../lib/investigate';
import { ENTITY_REGISTRY, resolveTargets } from '../lib/entities';
import { getProvider } from '../lib/thetanuts';
import { SIMULATOR_SCENARIOS } from '../lib/simulator';
import { newCorrelationId } from '../lib/ids';
import type { AlertEvent, EvidencePacket } from '../types/index';

const BAR = '─'.repeat(78);

function alertFor(text: string, clusterKey = 'probe'): AlertEvent {
  return {
    id: newCorrelationId(),
    source: 'SIMULATOR',
    rawText: text,
    receivedAt: new Date().toISOString(),
    clusterKey,
  };
}

function printPacket(packet: EvidencePacket) {
  console.log(`  targets: ${packet.targets.length ? packet.targets.map((t) => `${t.name}/${t.kind}[${t.confidence}] (matched "${t.matchedOn}")`).join(', ') : 'NONE'}`);
  console.log(`  block ${packet.blockNumber} @ ${packet.blockTimestamp}`);
  console.log(`  ${evidenceHeadline(packet)} · ${packet.totalLatencyMs}ms${packet.budgetExhausted ? ' · BUDGET EXHAUSTED' : ''}`);
  console.log('');
  for (const c of packet.checks) {
    const mark = { CORROBORATES: '✓', CONTRADICTS: '✗', INCONCLUSIVE: '~', UNAVAILABLE: '!' }[c.stance];
    console.log(`  ${mark} [${c.stance}] ${c.title}  (${c.latencyMs}ms, ${c.source})`);
    console.log(`      ${c.summary}`);
    const facts = Object.entries(c.facts);
    if (facts.length) {
      console.log(`      facts: ${facts.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
    console.log(`      method: ${c.method}`);
    if (c.error) console.log(`      error: ${c.error}`);
    console.log('');
  }
}

/** Re-verify every registry address against the chain. Catches rot. */
async function verifyRegistry() {
  console.log(BAR);
  console.log('REGISTRY VERIFICATION — every stored address, against Base mainnet');
  console.log(BAR);
  const provider = getProvider();
  let bad = 0;
  for (const entry of ENTITY_REGISTRY) {
    if (!entry.address) {
      console.log(`  ─ ${entry.name.padEnd(28)} no address (resolved at runtime or DeFiLlama only)`);
      continue;
    }
    const code = await provider.getCode(entry.address);
    const bytes = (code.length - 2) / 2;
    const ok = bytes > 0;
    if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} ${entry.name.padEnd(28)} ${entry.address} code=${bytes}B${entry.custodial ? ' custodial' : ''}`);
  }
  if (bad) console.log(`\n  ⚠️  ${bad} registry address(es) hold no code. Fix before trusting stage 02.`);
  console.log('');
}

/** Confirm the measured RPC constraints still hold. */
async function verifyConstraints() {
  console.log(BAR);
  console.log('MEASURED CONSTRAINTS — re-checked live');
  console.log(BAR);
  const provider = getProvider();
  const head = await provider.getBlockNumber();

  const [b0, b1] = await Promise.all([provider.getBlock(head), provider.getBlock(head - 500)]);
  const measured = b0 && b1 ? (b0.timestamp - b1.timestamp) / 500 : NaN;
  console.log(`  block time: ${measured}s/block (code assumes ${BLOCK_TIME_S})${measured === BLOCK_TIME_S ? ' ✓' : ' ⚠️ MISMATCH'}`);

  const TRANSFER = ethers.id('Transfer(address,address,uint256)');
  const WETH = '0x4200000000000000000000000000000000000006';
  try {
    await provider.getLogs({ address: WETH, topics: [TRANSFER], fromBlock: head - LOG_WINDOW_BLOCKS, toBlock: head });
    console.log(`  eth_getLogs at ${LOG_WINDOW_BLOCKS + 1} blocks: ✓ accepted`);
  } catch (e) {
    console.log(`  eth_getLogs at ${LOG_WINDOW_BLOCKS + 1} blocks: ✗ REJECTED — ${(e as Error).message.slice(0, 120)}`);
  }
  try {
    await provider.getLogs({ address: WETH, topics: [TRANSFER], fromBlock: head - LOG_WINDOW_BLOCKS - 1, toBlock: head });
    console.log(`  eth_getLogs at ${LOG_WINDOW_BLOCKS + 2} blocks: accepted — the free-tier cap has been RAISED, windows could widen`);
  } catch {
    console.log(`  eth_getLogs at ${LOG_WINDOW_BLOCKS + 2} blocks: rejected as expected (10-block cap still in force)`);
  }

  const erc = new ethers.Contract(WETH, ['function balanceOf(address) view returns (uint256)'], provider);
  try {
    await erc.balanceOf(WETH, { blockTag: head - 43_200 });
    console.log(`  archive eth_call 24 h back: ✓ available`);
  } catch (e) {
    console.log(`  archive eth_call 24 h back: ✗ UNAVAILABLE — balance deltas will degrade — ${(e as Error).message.slice(0, 100)}`);
  }
  console.log('');
  console.log(`  budget=${investigationConfig.budgetMs}ms perCheck=${investigationConfig.checkTimeoutMs}ms ` +
    `drain=${investigationConfig.drainPct}% normal=${investigationConfig.normalPct}% z=${investigationConfig.activityZ} ` +
    `divergence=${investigationConfig.divergencePct}% tvlDrop=${investigationConfig.tvlDropPct}%`);
  console.log('');
}

async function main() {
  const custom = process.argv.slice(2).join(' ').trim();

  await verifyRegistry();
  await verifyConstraints();

  const cases = custom
    ? [{ name: 'custom claim', rawText: custom, clusterKey: 'probe' }]
    : SIMULATOR_SCENARIOS.map((s) => ({ name: s.name, rawText: s.rawText, clusterKey: s.clusterKey }));

  for (const c of cases) {
    console.log(BAR);
    console.log(`SCENARIO: ${c.name}`);
    console.log(BAR);
    console.log(`  claim: ${c.rawText.slice(0, 160)}${c.rawText.length > 160 ? '…' : ''}`);
    console.log(`  resolved: ${[...new Set(resolveTargets(c.rawText).map((t) => t.name))].join(', ') || 'nothing'}`);
    console.log('');

    const packet = await investigate(alertFor(c.rawText, c.clusterKey));
    printPacket(packet);

    console.log('  ── prompt block handed to layer 1 ' + '─'.repeat(42));
    console.log(packet.promptBlock.split('\n').map((l) => `  │ ${l}`).join('\n'));
    console.log(`  └─ ${packet.promptBlock.length} chars (budget ${investigationConfig.promptCharBudget})`);
    console.log('');
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
