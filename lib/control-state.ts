/**
 * Authoritative Server Control State
 *
 * Keeps track of whether the autonomous agent is ARMED or PAUSED,
 * and what execution mode it is running in (AUTONOMOUS, APPROVAL_REQUIRED, MONITOR_ONLY).
 *
 * Stored in globalThis in the Node environment so all Next.js API routes
 * share the exact same state instance across hot reloads.
 */

export type AgentStatus = "ARMED" | "PAUSED";
export type ExecutionMode = "AUTONOMOUS" | "APPROVAL_REQUIRED" | "MONITOR_ONLY";

export interface ControlState {
  status: AgentStatus;
  mode: ExecutionMode;
  updatedAt: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __nutshell_control: ControlState | undefined;
}

function getStore(): ControlState {
  if (!globalThis.__nutshell_control) {
    globalThis.__nutshell_control = {
      status: "ARMED",
      mode: "AUTONOMOUS",
      updatedAt: new Date().toISOString(),
    };
  }
  return globalThis.__nutshell_control;
}

export function getControlState(): ControlState {
  return { ...getStore() };
}

export function isAgentPaused(): boolean {
  return getStore().status === "PAUSED";
}

export function setAgentStatus(status: AgentStatus): ControlState {
  const store = getStore();
  store.status = status;
  store.updatedAt = new Date().toISOString();
  return { ...store };
}

export function setExecutionMode(mode: ExecutionMode): ControlState {
  const store = getStore();
  store.mode = mode;
  store.updatedAt = new Date().toISOString();
  return { ...store };
}

export function updateControlState(partial: {
  status?: AgentStatus;
  mode?: ExecutionMode;
}): ControlState {
  const store = getStore();
  if (partial.status) store.status = partial.status;
  if (partial.mode) store.mode = partial.mode;
  store.updatedAt = new Date().toISOString();
  return { ...store };
}
