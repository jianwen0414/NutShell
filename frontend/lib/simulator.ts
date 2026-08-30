import { newCorrelationId } from "./ids";
import type { AlertEvent, AlertSource } from "@/types";

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
    rawText: "BREAKING: Major Base bridge exploit reported with $40M in suspicious outflows and paused withdrawals.",
    clusterKey: "base-bridge-exploit",
    expectedTier: "HEDGE_FULL",
  },
  {
    id: "scen_exchange_freeze",
    name: "Coinbase Withdrawal Freeze",
    source: "SIMULATOR",
    rawText: "Rumor: Coinbase has frozen all ETH withdrawals. No transaction hashes or official source yet.",
    clusterKey: "coinbase-withdrawal-rumor",
    expectedTier: "REJECT",
  },
  {
    id: "scen_usdc_depeg",
    name: "USDC Depeg Alert",
    source: "SIMULATOR",
    rawText: "USDC on Base briefly trades at $0.91 across several pools after a large liquidity removal.",
    clusterKey: "usdc-depeg-spike",
    expectedTier: "WATCH",
  },
  {
    id: "scen_exploit_debunk",
    name: "Exploit Debunk & Rollback",
    source: "SIMULATOR",
    rawText: "UPDATE: Outflow was a scheduled white-hat audit migration; contracts verified secure and funds returned to vault.",
    clusterKey: "base-bridge-exploit",
    expectedTier: "UNWOUND",
  },
];

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
