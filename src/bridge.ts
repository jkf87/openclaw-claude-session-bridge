import * as crypto from "crypto";
import { execFileSync } from "child_process";
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

export interface GatewayAdapter {
  sessionSpawn(
    opts?: SpawnOptions & { cwd?: string; agentId?: string }
  ): Promise<BridgeResult<{ childSessionKey: string; rawText?: string }>>;
  sessionSend(
    childSessionKey: string,
    message: string
  ): Promise<BridgeResult<{ reply: string }>>;
  sessionStatus(
    childSessionKey: string
  ): Promise<BridgeResult<{ alive: boolean; rawText?: string }>>;
}

type ChatHistoryMessage = {
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
};

type ChatHistoryResult = {
  sessionKey?: string;
  messages?: ChatHistoryMessage[];
};

const ACP_SESSION_KEY_RE = /(agent:[a-z0-9_-]+:acp:[0-9a-f-]+)/i;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractText(message: ChatHistoryMessage): string {
  return (message.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

function extractAssistantTexts(history: ChatHistoryResult): string[] {
  return (history.messages ?? [])
    .filter((message) => message.role === "assistant")
    .map(extractText)
    .filter(Boolean);
}

function sanitizeSlashToken(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  // Current /acp slash parsing is whitespace-token based on most surfaces;
  // quotes are not reliably stripped. To stay robust, we avoid quoting and
  // instead replace whitespace with underscores.
  return trimmed.replace(/\s+/g, "_");
}

function formatExecError(err: unknown): string {
  if (err instanceof Error) {
    const anyErr = err as Error & { stdout?: string | Buffer; stderr?: string | Buffer };
    const stdout = anyErr.stdout ? String(anyErr.stdout) : "";
    const stderr = anyErr.stderr ? String(anyErr.stderr) : "";
    return [err.message, stdout.trim(), stderr.trim()].filter(Boolean).join(" | ");
  }
  return String(err);
}

// ---------------------------------------------------------------------------
// Simulated gateway (offline / demo mode)
// ---------------------------------------------------------------------------

export class SimulatedGateway implements GatewayAdapter {
  async sessionSpawn(
    _opts?: SpawnOptions & { cwd?: string; agentId?: string }
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
  ): Promise<BridgeResult<{ alive: boolean; rawText?: string }>> {
    return { ok: true, data: { alive: true, rawText: "simulated: alive" } };
  }
}

// ---------------------------------------------------------------------------
// Real gateway adapter via `openclaw gateway call` + slash commands
// ---------------------------------------------------------------------------

export class RealGatewayCliAdapter implements GatewayAdapter {
  private readonly openclawBin: string;
  private readonly managerSessionKey: string;
  private readonly timeoutMs: number;
  private readonly defaultAgentId: string;
  private readonly defaultCwd: string;

  constructor(opts?: {
    openclawBin?: string;
    managerSessionKey?: string;
    timeoutMs?: number;
    agentId?: string;
    cwd?: string;
  }) {
    this.openclawBin =
      opts?.openclawBin ?? process.env.OPENCLAW_BRIDGE_OPENCLAW_BIN ?? "openclaw";
    this.managerSessionKey =
      opts?.managerSessionKey ??
      process.env.OPENCLAW_BRIDGE_MANAGER_SESSION ??
      "bridge:manager:claude";
    this.timeoutMs = Math.max(
      5_000,
      opts?.timeoutMs ?? Number(process.env.OPENCLAW_BRIDGE_TIMEOUT_MS ?? 60_000)
    );
    this.defaultAgentId = opts?.agentId ?? process.env.OPENCLAW_BRIDGE_AGENT ?? "claude";
    this.defaultCwd = opts?.cwd ?? process.cwd();
  }

  private gatewayCall<T>(method: string, params: Record<string, unknown>): T {
    try {
      const stdout = execFileSync(
        this.openclawBin,
        [
          "gateway",
          "call",
          method,
          "--json",
          "--timeout",
          String(this.timeoutMs),
          "--params",
          JSON.stringify(params),
        ],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 8 * 1024 * 1024,
        }
      );
      return JSON.parse(stdout) as T;
    } catch (err) {
      throw new Error(formatExecError(err));
    }
  }

  private chatHistory(): ChatHistoryResult {
    return this.gatewayCall<ChatHistoryResult>("chat.history", {
      sessionKey: this.managerSessionKey,
      limit: 200,
    });
  }

  private sendSlashCommand(command: string): void {
    this.gatewayCall("chat.send", {
      sessionKey: this.managerSessionKey,
      message: command,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  private async waitForNewAssistantText(
    beforeAssistantCount: number,
    matcher?: (text: string) => boolean
  ): Promise<string> {
    const deadline = Date.now() + this.timeoutMs;

    while (Date.now() < deadline) {
      await sleep(1_500);
      const history = this.chatHistory();
      const texts = extractAssistantTexts(history);
      const newTexts = texts.slice(beforeAssistantCount);
      if (newTexts.length === 0) {
        continue;
      }
      const combined = newTexts.join("\n\n").trim();
      if (!matcher || matcher(combined)) {
        return combined;
      }
    }

    throw new Error("Timed out waiting for ACP slash-command response.");
  }

  async sessionSpawn(
    opts?: SpawnOptions & { cwd?: string; agentId?: string }
  ): Promise<BridgeResult<{ childSessionKey: string; rawText?: string }>> {
    try {
      const before = extractAssistantTexts(this.chatHistory()).length;
      const agentId = opts?.agentId ?? this.defaultAgentId;
      const cwd = opts?.cwd ?? this.defaultCwd;
      const parts = [
        "/acp spawn",
        sanitizeSlashToken(agentId),
        "--mode",
        "persistent",
        "--thread",
        "off",
        "--cwd",
        sanitizeSlashToken(cwd),
      ];
      if (opts?.label) {
        parts.push("--label", sanitizeSlashToken(opts.label));
      }
      this.sendSlashCommand(parts.join(" "));
      const text = await this.waitForNewAssistantText(before, (value) =>
        ACP_SESSION_KEY_RE.test(value)
      );
      const match = text.match(ACP_SESSION_KEY_RE);
      if (!match) {
        return { ok: false, error: `Unable to parse child session key from: ${text}` };
      }
      return {
        ok: true,
        data: { childSessionKey: match[1], rawText: text },
      };
    } catch (err) {
      return { ok: false, error: formatExecError(err) };
    }
  }

  async sessionSend(
    childSessionKey: string,
    message: string
  ): Promise<BridgeResult<{ reply: string }>> {
    try {
      const before = extractAssistantTexts(this.chatHistory()).length;
      const command = `/acp steer --session ${sanitizeSlashToken(childSessionKey)} ${message}`;
      this.sendSlashCommand(command);
      const text = await this.waitForNewAssistantText(before);
      return { ok: true, data: { reply: text } };
    } catch (err) {
      return { ok: false, error: formatExecError(err) };
    }
  }

  async sessionStatus(
    childSessionKey: string
  ): Promise<BridgeResult<{ alive: boolean; rawText?: string }>> {
    try {
      const before = extractAssistantTexts(this.chatHistory()).length;
      this.sendSlashCommand(`/acp status ${sanitizeSlashToken(childSessionKey)}`);
      const text = await this.waitForNewAssistantText(before, (value) =>
        value.includes("ACP status:") || value.includes("Unable to resolve session target")
      );
      const lower = text.toLowerCase();
      const alive =
        !lower.includes("unable to resolve session target") &&
        !lower.includes("runtime: status=dead") &&
        !lower.includes("state: dead") &&
        !lower.includes("missing acp metadata");
      return { ok: true, data: { alive, rawText: text } };
    } catch (err) {
      return { ok: false, error: formatExecError(err) };
    }
  }
}

// ---------------------------------------------------------------------------
// Bridge class
// ---------------------------------------------------------------------------

export class SessionBridge {
  private statePath?: string;
  private gateway: GatewayAdapter;
  private defaultSpawnAgentId?: string;
  private defaultSpawnCwd?: string;

  constructor(opts?: {
    statePath?: string;
    gateway?: GatewayAdapter;
    defaultSpawnAgentId?: string;
    defaultSpawnCwd?: string;
  }) {
    this.statePath = opts?.statePath;
    this.gateway = opts?.gateway ?? new SimulatedGateway();
    this.defaultSpawnAgentId = opts?.defaultSpawnAgentId;
    this.defaultSpawnCwd = opts?.defaultSpawnCwd;
  }

  private load(): BridgeState {
    return loadState(this.statePath);
  }

  private save(state: BridgeState): void {
    saveState(state, this.statePath);
  }

  private now(): string {
    return new Date().toISOString();
  }

  init(): BridgeResult {
    const state = this.load();
    this.save(state);
    return { ok: true, data: { statePath: getStatePath(this.statePath) } };
  }

  async spawn(opts?: SpawnOptions & { cwd?: string; agentId?: string }): Promise<BridgeResult<SessionRecord>> {
    const result = await this.gateway.sessionSpawn({
      ...opts,
      cwd: opts?.cwd ?? this.defaultSpawnCwd,
      agentId: opts?.agentId ?? this.defaultSpawnAgentId,
    });
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
      history: result.data.rawText
        ? [{ role: "assistant", content: result.data.rawText, timestamp: now }]
        : [],
    };

    let state = this.load();
    state = putSession(state, record);
    state = setActiveSession(state, record.childSessionKey);
    this.save(state);

    return { ok: true, data: record };
  }

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
      session.status = "error";
      session.metadata.updatedAt = this.now();
      state = putSession(state, session);
      this.save(state);
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

    if (session.history.length > 50) {
      session.history = session.history.slice(-50);
    }

    state = putSession(state, session);
    this.save(state);

    return { ok: true, data: { reply: result.data.reply, sessionKey: key } };
  }

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

  async probe(sessionKey?: string): Promise<BridgeResult<{ sessionKey: string; alive: boolean; rawText?: string }>> {
    const state = this.load();
    const key = sessionKey ?? state.activeSessionKey;
    if (!key) {
      return { ok: false, error: "No active session to probe." };
    }
    const local = getSession(state, key);
    if (!local) {
      return { ok: false, error: `Session ${key} not found in local state.` };
    }
    const result = await this.gateway.sessionStatus(key);
    if (!result.ok || !result.data) {
      return { ok: false, error: result.error ?? "Gateway status failed" };
    }
    return {
      ok: true,
      data: {
        sessionKey: key,
        alive: result.data.alive,
        rawText: result.data.rawText,
      },
    };
  }

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
