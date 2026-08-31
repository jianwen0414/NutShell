import { newCorrelationId } from "./ids";
import type { AlertEvent, AlertSource } from "@/types";

/**
 * Scripted alerts for the operator panel.
 *
 * `rawText` is not display copy. It is the exact string sent to the models, so
 * the wording decides the score. A one line version of the bridge exploit
 * scored 35 and was rejected; the detailed version below scores about 77 and
 * hedges. Same event, same models, forty points apart.
 *
 * `expectedTier` records what each text actually produced when measured
 * against the live network, not what we hoped for.
 */
export interface SimulatorScenario {
  id: string;
  name: string;
  source: AlertSource;
  rawText: string;
  clusterKey: string;
  expectedTier: string;
}

export const SIMULATOR_SCENARIOS: SimulatorScenario[] = [
  {
    id: "scen_bridge_exploit",
    name: "Base Bridge Exploit",
    source: "SIMULATOR",
    rawText:
      "BlockSec reports an active exploit against a cross-chain bridge on Base. The attacker " +
      "contract has drained approximately 12,400 WETH, around $40M, across 7 transactions between " +
      "14:02 and 14:19 UTC. The flaw is an unchecked return value in the withdrawal verifier that " +
      "allows repeated withdrawals against a single burn proof. The bridge team has paused deposits " +
      "and acknowledged the incident on their status page.",
    clusterKey: "base-bridge-exploit",
    expectedTier: "HEDGE_SMALL",
  },
  {
    id: "scen_exchange_freeze",
    name: "Coinbase Withdrawal Freeze",
    source: "SIMULATOR",
    rawText:
      "Hearing from a source that a major exchange has frozen all ETH withdrawals this morning. " +
      "Nothing official yet but people are saying it is bad. Get your funds out while you still can.",
    clusterKey: "coinbase-withdrawal-rumor",
    expectedTier: "REJECT",
  },
  {
    id: "scen_usdc_depeg",
    name: "USDC Depeg Alert",
    source: "SIMULATOR",
    rawText:
      "USDC traded down to $0.991 against USDT on two Base pools for roughly four minutes this " +
      "morning after a single provider withdrew about $6M of liquidity. Depth has since recovered and " +
      "the peg is holding. No issuer statement, and reserves attestations are unchanged.",
    clusterKey: "usdc-depeg-spike",
    expectedTier: "WATCH",
  },
  {
    id: "scen_exploit_debunk",
    name: "Exploit Debunk & Rollback",
    source: "SIMULATOR",
    rawText:
      "Correction on the earlier Base bridge report. The 12,400 WETH movement was a scheduled " +
      "treasury migration executed by the protocol team under an existing multisig timelock, not an " +
      "exploit. BlockSec has retracted its alert. The full amount is accounted for in the new " +
      "custody contract and deposits have been re-enabled.",
    clusterKey: "base-bridge-exploit",
    expectedTier: "WATCH",
  },
];

/**
 * The debunk shares a cluster key with the exploit so it lands on the same
 * cluster. It does NOT unwind the position: the pipeline only asks whether a
 * claim is credible, never whether it contradicts an open one, so a credible
 * correction reads as a credible claim and settles at WATCH. Turning that into
 * a rollback needs the unwind path, which is not built.
 */

/**
 * Creates an AlertEvent with a fresh correlation ID for simulation.
 */
export function generateSimulatedAlert(scenarioIndex = 0): AlertEvent {
  const scenario = SIMULATOR_SCENARIOS[scenarioIndex] ?? SIMULATOR_SCENARIOS[0];
  const correlationId = newCorrelationId();

  return {
    id: correlationId,
    source: scenario.source,
    rawText: scenario.rawText,
    receivedAt: new Date().toISOString(),
    clusterKey: scenario.clusterKey,
    metadata: {
      mode: "simulator",
      scenarioId: scenario.id,
      expectedTier: scenario.expectedTier,
    },
  };
}
