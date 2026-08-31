/**
 * Run one alert through the entire pipeline, for real.
 *
 *   npm run demo
 *   npm run demo -- "BREAKING: Solana validators halted after an exploit"
 *
 * Real Gonka calls, real consensus maths, real policy decision, real vault
 * accounting. The ONLY stub is execution: M1 owns lib/thetanuts.ts, so the
 * fill is printed rather than placed. Every line below says which it is.
 *
 * This is the rehearsal tool. Vary the text between runs — an identical
 * prompt comes back from the router's cache in milliseconds and will make the
 * pipeline look far faster than it is on the day.
 */
import { newJob, runJob, type Executor, type PipelineDeps } from '../worker/pipeline.js';
import { EventBus, InMemoryJobStore } from '../worker/index.js';
import { InMemoryLedgerStore, SimulatedVaultDriver, SIMULATED_VAULT_BANNER } from '../lib/vault.js';
import { thresholdsFromEnv } from '../lib/policy.js';
import { newCorrelationId } from '../lib/errors.js';
import type { AlertEvent, HedgeDecision, HedgePosition } from '../types/index.js';
import { createHash } from 'node:crypto';

try {
  process.loadEnvFile('.env');
} catch {
  /* ambient env */
}

const DEFAULT_TEXT =
  'Security researchers at BlockSec report an active exploit against a cross-chain bridge on ' +
  'Base. The attacker contract 0x9f2a...c41d has drained approximately 12,400 WETH (~$41M) ' +
  'across 7 transactions between 14:02 and 14:19 UTC, exploiting an unchecked return value in ' +
  'the withdrawal verifier. The bridge team has paused deposits and acknowledged the incident.';

const rawText = process.argv.slice(2).join(' ').trim() || DEFAULT_TEXT;

/** Stand-in for M1's executor. Prints the order it would place; places nothing. */
const stubExecutor: Executor = {
  async execute(d: HedgeDecision): Promise<HedgePosition> {
    return {
      correlationId: d.correlationId,
      status: 'PENDING',
      asset: d.targetAsset,
      strike: '(selected by lib/thetanuts.ts)',
      expiry: '(nearest qualifying expiry)',
      contracts: '(from the live book)',
      premiumPaidUsdc: d.targetSizeUsdc,
      notionalProtectedUsdc: '(strike x contracts)',
      entryTxHash: `0x${'0'.repeat(64)}`,
      baseScanUrl: '(no transaction: executor not wired)',
      spotAtEntry: '(from getMarketData)',
      deltaAtEntry: 0,
      openedAt: new Date().toISOString(),
      wasDryRun: true,
    };
  },
};

const line = () => console.log('─'.repeat(76));

async function main() {
  const started = Date.now();
  const vault = new SimulatedVaultDriver(new InMemoryLedgerStore());
  const before = await vault.getState();

  line();
  console.log('NutShell pipeline demo');
  line();
  console.log(`Alert  : ${rawText.slice(0, 68)}${rawText.length > 68 ? '…' : ''}`);
  console.log(`Vault  : reserve ${before.premiumReserveUsdc} · daily cap ${before.dailyCapUsdc} · principal ${before.principalUsdc}`);
  console.log(`         ${SIMULATED_VAULT_BANNER}`);
  const t = thresholdsFromEnv();
  console.log(`Policy : hedge at truth ≥${t.truthHedge}, agreement ≥${t.agreement}; ceiling ${t.hardCeilingUsdc}, floor ${t.minFillUsdc}`);
  line();

  const alert: AlertEvent = {
    id: newCorrelationId(),
    source: 'MANUAL',
    rawText,
    receivedAt: new Date().toISOString(),
    clusterKey: createHash('sha256').update(rawText).digest('hex').slice(0, 16),
  };

  const bus = new EventBus();
  bus.subscribe(alert.id, (ev) => {
    const at = `${String(((Date.now() - started) / 1000).toFixed(1)).padStart(5)}s`;
    switch (ev.event) {
      case 'status':
        console.log(`${at}  status      ${ev.data.status}${ev.data.step ? ` · ${ev.data.step}` : ''}`);
        break;
      case 'verdict':
        console.log(
          `${at}  verdict     ${ev.data.modelId.padEnd(34)} ${String(ev.data.claimScore).padStart(3)}  ` +
            `sev ${ev.data.severity}  ${ev.data.stance}`,
        );
        break;
      case 'consensus':
        console.log(
          `${at}  consensus   truth ${ev.data.truthScore} · agreement ${ev.data.agreement} · ` +
            `spread ${ev.data.spread} · conviction ${ev.data.conviction} · ${ev.data.modelsResponded}/3`,
        );
        break;
      case 'decision':
        console.log(`${at}  decision    ${ev.data.tier} · ${ev.data.targetAsset || '(none)'} via ${ev.data.mappingRule}`);
        console.log(`${at}              size ${ev.data.targetSizeUsdc} USDC · bound by ${ev.data.bindingCap}`);
        console.log(`${at}              ${ev.data.reason}`);
        break;
      case 'position':
        console.log(`${at}  position    ${ev.data.asset} · premium ${ev.data.premiumPaidUsdc} USDC  [STUB, nothing placed]`);
        break;
      case 'attestation':
        console.log(`${at}  attestation ${ev.data.method}`);
        break;
      case 'error':
        console.log(`${at}  ERROR       ${ev.data.error.code}: ${ev.data.error.message}`);
        break;
      case 'done':
        console.log(`${at}  done        ${ev.data.status}`);
        break;
    }
  });

  const deps: PipelineDeps = {
    store: new InMemoryJobStore(),
    vault,
    executor: stubExecutor,
    emit: (jobId, ev) => bus.emit(jobId, ev),
  };

  const job = await runJob(newJob(alert, { dryRun: true }), deps);

  line();
  console.log(`Final status : ${job.status}`);
  if (job.verification?.failures?.length) {
    for (const f of job.verification.failures) {
      console.log(`Dropped      : ${f.modelId} — ${f.code} after ${f.latencyMs}ms`);
    }
  }
  if (job.verification) {
    for (const v of job.verification.verdicts) {
      if (v.chainUrl) console.log(`On chain    : shard ${v.chainShardId} · ${v.chainUrl}`);
    }
    console.log(`Reasoning    : ${job.verification.reasoningTrace[0] ?? '(none)'}`);
    console.log(`Request IDs  : ${job.verification.gonkaRequestIds.join(', ') || '(none)'}`);
    console.log(
      `               ${job.verification.idChainResolvable
        ? 'On-chain shard record (model, epoch and serving nodes) — see chainUrl'
        : 'Auditable request reference returned by the Gonka Router'}`,
    );
  }
  console.log(`Total        : ${((Date.now() - started) / 1000).toFixed(1)}s`);
  line();
  console.log('Execution is stubbed. Wiring M1\'s lib/thetanuts.ts is what makes the fill real.');
  line();
}

main().catch((e) => {
  console.error(`\nDEMO FAILED: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
