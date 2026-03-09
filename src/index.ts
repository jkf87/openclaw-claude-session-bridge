/**
 * Public API surface for openclaw-claude-session-bridge.
 */

export { SessionBridge, SimulatedGateway } from "./bridge";
export type { GatewayAdapter } from "./bridge";
export {
  loadState,
  saveState,
  getSession,
  putSession,
  setActiveSession,
  ensureStateDir,
  getStatePath,
} from "./state";
export type {
  BridgeState,
  SessionRecord,
  SessionMetadata,
  SessionMessage,
  SpawnOptions,
  SendOptions,
  BridgeResult,
  ExportedConfig,
} from "./types";
