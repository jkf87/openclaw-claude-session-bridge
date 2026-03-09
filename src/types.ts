/**
 * Core types for the OpenClaw Claude Session Bridge.
 */

/** Metadata attached to a session for identification and resumption. */
export interface SessionMetadata {
  /** User-defined label for this session. */
  label?: string;
  /** Arbitrary key-value tags. */
  tags?: Record<string, string>;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of last interaction. */
  updatedAt: string;
}

/** A single message sent or received in a session. */
export interface SessionMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

/** Represents one persisted Claude ACP session. */
export interface SessionRecord {
  /** Unique key identifying the child session (from ACP sessions_spawn). */
  childSessionKey: string;
  /** The parent session key that spawned this child. */
  parentSessionKey?: string;
  /** Session status. */
  status: "active" | "closed" | "error";
  /** Attached metadata for binding / resumption. */
  metadata: SessionMetadata;
  /** Truncated message history (last N messages kept for context). */
  history: SessionMessage[];
}

/** Top-level persisted bridge state. */
export interface BridgeState {
  /** Schema version for forward-compat. */
  version: number;
  /** Default / last-active session key. */
  activeSessionKey: string | null;
  /** Map of childSessionKey → SessionRecord. */
  sessions: Record<string, SessionRecord>;
}

/** Options for spawning a new session. */
export interface SpawnOptions {
  label?: string;
  tags?: Record<string, string>;
  parentSessionKey?: string;
}

/** Options for sending a message. */
export interface SendOptions {
  sessionKey?: string; // defaults to active session
}

/** Result from a spawn or send operation. */
export interface BridgeResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

/** Exported config for sharing / importing session bindings. */
export interface ExportedConfig {
  exportedAt: string;
  sessions: SessionRecord[];
}
