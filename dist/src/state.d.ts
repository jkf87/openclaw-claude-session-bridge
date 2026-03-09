/**
 * Durable local state management.
 *
 * Persists bridge state as a JSON file so that session keys and metadata
 * survive across CLI invocations and process restarts.
 */
import type { BridgeState, SessionRecord } from "./types";
/** Ensure the state directory exists. */
export declare function ensureStateDir(stateDir?: string): string;
/** Load bridge state from disk, returning empty state if absent. */
export declare function loadState(statePath?: string): BridgeState;
/** Save bridge state to disk atomically (write-then-rename). */
export declare function saveState(state: BridgeState, statePath?: string): void;
/** Get a session record by key, or null. */
export declare function getSession(state: BridgeState, key: string): SessionRecord | null;
/** Upsert a session record into state. */
export declare function putSession(state: BridgeState, record: SessionRecord): BridgeState;
/** Set the active session key. */
export declare function setActiveSession(state: BridgeState, key: string | null): BridgeState;
/** Get the resolved state file path (for display). */
export declare function getStatePath(statePath?: string): string;
//# sourceMappingURL=state.d.ts.map