/**
 * Core bridge logic — spawn, send, resume, status, bind, export.
 *
 * This module implements the session lifecycle by:
 *  1. Calling OpenClaw Gateway RPC/CLI for session operations.
 *  2. Persisting the resulting session keys and metadata locally.
 *
 * IMPORTANT HONESTY NOTE:
 * The actual ACP session_spawn / session_send RPCs depend on the OpenClaw
 * Gateway being available and the agent having proper credentials. When the
 * gateway is unreachable, this module falls back to **simulated** responses
 * so the CLI remains testable and demonstrable offline. Real gateway
 * integration replaces the `executeGatewayCall` function.
 */

import * as crypto from "crypto";
import {
  loadState,
  saveState,
  getSession,
  putSession,
  setActiveSession,
  getStatePath,
} from "./state";
import type {
  BridgeResult,
  BridgeState,
  ExportedConfig,
  SendOptions,
  SessionMessage,
  SessionMetadata,
  SessionRecord,
  SpawnOptions,
} from "./types";

// ---------------------------------------------------------------------------
// Gateway abstraction
// ---------------------------------------------------------------------------

export interface GatewayAdapter {
  /** Spawn a new ACP child session. Returns a childSessionKey. */
  sessionSpawn(parentKey?: string): Promise<BridgeResult<{ childSessionKey: string }>>;
  /** Send a message to an existing child session. */
  sessionSend(
    childSessionKey: string,
    message: string
  ): Promise<BridgeResult<{ reply: string }>>;
  /** Check if a session is still alive. */
  sessionStatus(childSessionKey: string): Promise<BridgeResult<{ alive: boolean }>>;
}

// ---------------------------------------------------------------------------
// Simulated gateway (offline / demo mode)
// ---------------------------------------------------------------------------

export class SimulatedGateway implements GatewayAdapter {
  async sessionSpawn(
    _parentKey?: string
  ): Promise<BridgeResult<{ childSessionKey: string }>> {
    const key = `acp_sim_${crypto.randomBytes(8).toString("hex")}`;
    return { ok: true, data: { childSessionKey: key } };
  }

  async sessionSend(
    childSessionKey: string,
    message: string
  ): Promise<BridgeResult<{ reply: string }>> {
    return {
      ok: true,
      data: {
        reply: `[simulated] Echo from ${childSessionKey}: received "${message.slice(0, 80)}"`,
      },
    };
  }

  async sessionStatus(
    _childSessionKey: string
  ): Promise<BridgeResult<{ alive: boolean }>> {
    return { ok: true, data: { alive: true } };
  }
}

// ---------------------------------------------------------------------------
// Bridge class
// ---------------------------------------------------------------------------

export class SessionBridge {
  private statePath?: string;
  private gateway: GatewayAdapter;

  constructor(opts?: { statePath?: string; gateway?: GatewayAdapter }) {
    this.statePath = opts?.statePath;
    this.gateway = opts?.gateway ?? new SimulatedGateway();
  }

  // -- helpers --

  private load(): BridgeState {
    return loadState(this.statePath);
  }

  private save(state: BridgeState): void {
    saveState(state, this.statePath);
  }

  private now(): string {
    return new Date().toISOString();
  }

  // -- public API --

  /** Initialize the bridge state directory. Idempotent. */
  init(): BridgeResult {
    const state = this.load();
    this.save(state);
    return { ok: true, data: { statePath: getStatePath(this.statePath) } };
  }

  /** Spawn a new Claude ACP child session. */
  async spawn(opts?: SpawnOptions): Promise<BridgeResult<SessionRecord>> {
    const result = await this.gateway.sessionSpawn(opts?.parentSessionKey);
    if (!result.ok || !result.data) {
      return { ok: false, error: result.error ?? "Gateway spawn failed" };
    }

    const now = this.now();
    const meta: SessionMetadata = {
      label: opts?.label,
      tags: opts?.tags,
      createdAt: now,
      updatedAt: now,
    };

    const record: SessionRecord = {
      childSessionKey: result.data.childSessionKey,
      parentSessionKey: opts?.parentSessionKey,
      status: "active",
      metadata: meta,
      history: [],
    };

    let state = this.load();
    state = putSession(state, record);
    state = setActiveSession(state, record.childSessionKey);
    this.save(state);

    return { ok: true, data: record };
  }

  /** Send a follow-up message to an existing session. */
  async send(
    message: string,
    opts?: SendOptions
  ): Promise<BridgeResult<{ reply: string; sessionKey: string }>> {
    let state = this.load();
    const key = opts?.sessionKey ?? state.activeSessionKey;

    if (!key) {
      return { ok: false, error: "No active session. Run spawn first." };
    }

    const session = getSession(state, key);
    if (!session) {
      return { ok: false, error: `Session ${key} not found in local state.` };
    }

    if (session.status !== "active") {
      return { ok: false, error: `Session ${key} is ${session.status}, not active.` };
    }

    const result = await this.gateway.sessionSend(key, message);
    if (!result.ok || !result.data) {
      return { ok: false, error: result.error ?? "Gateway send failed" };
    }

    const now = this.now();
    const userMsg: SessionMessage = { role: "user", content: message, timestamp: now };
    const assistantMsg: SessionMessage = {
      role: "assistant",
      content: result.data.reply,
      timestamp: now,
    };

    session.history.push(userMsg, assistantMsg);
    session.metadata.updatedAt = now;

    // Keep last 50 messages to bound state size.
    if (session.history.length > 50) {
      session.history = session.history.slice(-50);
    }

    state = putSession(state, session);
    this.save(state);

    return { ok: true, data: { reply: result.data.reply, sessionKey: key } };
  }

  /** Get the status of the bridge and its sessions. */
  status(sessionKey?: string): BridgeResult {
    const state = this.load();

    if (sessionKey) {
      const session = getSession(state, sessionKey);
      if (!session) {
        return { ok: false, error: `Session ${sessionKey} not found.` };
      }
      return { ok: true, data: session };
    }

    const sessionCount = Object.keys(state.sessions).length;
    const summaries = Object.values(state.sessions).map((s) => ({
      key: s.childSessionKey,
      label: s.metadata.label ?? "(unlabeled)",
      status: s.status,
      messages: s.history.length,
      updatedAt: s.metadata.updatedAt,
    }));

    return {
      ok: true,
      data: {
        activeSessionKey: state.activeSessionKey,
        sessionCount,
        sessions: summaries,
        statePath: getStatePath(this.statePath),
      },
    };
  }

  /** Bind / update metadata on an existing session. */
  bind(
    sessionKey: string,
    updates: Partial<Pick<SessionMetadata, "label" | "tags">>
  ): BridgeResult<SessionRecord> {
    let state = this.load();
    const session = getSession(state, sessionKey);
    if (!session) {
      return { ok: false, error: `Session ${sessionKey} not found.` };
    }

    if (updates.label !== undefined) session.metadata.label = updates.label;
    if (updates.tags !== undefined) {
      session.metadata.tags = { ...session.metadata.tags, ...updates.tags };
    }
    session.metadata.updatedAt = this.now();

    state = putSession(state, session);
    this.save(state);
    return { ok: true, data: session };
  }

  /** Export all (or selected) session configs for sharing / backup. */
  exportConfig(sessionKeys?: string[]): BridgeResult<ExportedConfig> {
    const state = this.load();
    const allSessions = Object.values(state.sessions);
    const selected = sessionKeys
      ? allSessions.filter((s) => sessionKeys.includes(s.childSessionKey))
      : allSessions;

    return {
      ok: true,
      data: {
        exportedAt: this.now(),
        sessions: selected,
      },
    };
  }

  /** Import session records from an exported config (for resume on another machine). */
  importConfig(config: ExportedConfig): BridgeResult<{ imported: number }> {
    let state = this.load();
    let count = 0;
    for (const rec of config.sessions) {
      if (!state.sessions[rec.childSessionKey]) {
        state = putSession(state, rec);
        count++;
      }
    }
    this.save(state);
    return { ok: true, data: { imported: count } };
  }
}
