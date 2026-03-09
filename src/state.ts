/**
 * Durable local state management.
 *
 * Persists bridge state as a JSON file so that session keys and metadata
 * survive across CLI invocations and process restarts.
 */

import * as fs from "fs";
import * as path from "path";
import type { BridgeState, SessionRecord } from "./types";

const STATE_VERSION = 1;
const DEFAULT_STATE_DIR = ".openclaw-bridge";
const STATE_FILENAME = "bridge-state.json";

function defaultStateDir(): string {
  return path.join(process.cwd(), DEFAULT_STATE_DIR);
}

function defaultStatePath(): string {
  return path.join(defaultStateDir(), STATE_FILENAME);
}

function emptyState(): BridgeState {
  return {
    version: STATE_VERSION,
    activeSessionKey: null,
    sessions: {},
  };
}

/** Ensure the state directory exists. */
export function ensureStateDir(stateDir?: string): string {
  const dir = stateDir ?? defaultStateDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Load bridge state from disk, returning empty state if absent. */
export function loadState(statePath?: string): BridgeState {
  const p = statePath ?? defaultStatePath();
  if (!fs.existsSync(p)) {
    return emptyState();
  }
  try {
    const raw = fs.readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw) as BridgeState;
    if (parsed.version !== STATE_VERSION) {
      console.warn(
        `[bridge] State version mismatch (got ${parsed.version}, expected ${STATE_VERSION}). Resetting.`
      );
      return emptyState();
    }
    return parsed;
  } catch {
    console.warn("[bridge] Corrupt state file. Resetting.");
    return emptyState();
  }
}

/** Save bridge state to disk atomically (write-then-rename). */
export function saveState(
  state: BridgeState,
  statePath?: string
): void {
  const p = statePath ?? defaultStatePath();
  ensureStateDir(path.dirname(p));
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tmp, p);
}

/** Get a session record by key, or null. */
export function getSession(
  state: BridgeState,
  key: string
): SessionRecord | null {
  return state.sessions[key] ?? null;
}

/** Upsert a session record into state. */
export function putSession(
  state: BridgeState,
  record: SessionRecord
): BridgeState {
  return {
    ...state,
    sessions: {
      ...state.sessions,
      [record.childSessionKey]: record,
    },
  };
}

/** Set the active session key. */
export function setActiveSession(
  state: BridgeState,
  key: string | null
): BridgeState {
  return { ...state, activeSessionKey: key };
}

/** Get the resolved state file path (for display). */
export function getStatePath(statePath?: string): string {
  return statePath ?? defaultStatePath();
}
