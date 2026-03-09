"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionBridge = exports.RealGatewayCliAdapter = exports.SimulatedGateway = void 0;
const crypto = __importStar(require("crypto"));
const child_process_1 = require("child_process");
const state_1 = require("./state");
const ACP_SESSION_KEY_RE = /(agent:[a-z0-9_-]+:acp:[0-9a-f-]+)/i;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function extractText(message) {
    return (message.content ?? [])
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text ?? "")
        .join("\n")
        .trim();
}
function extractAssistantTexts(history) {
    return (history.messages ?? [])
        .filter((message) => message.role === "assistant")
        .map(extractText)
        .filter(Boolean);
}
function sanitizeSlashToken(value) {
    const trimmed = value.trim();
    if (!trimmed)
        return trimmed;
    // Current /acp slash parsing is whitespace-token based on most surfaces;
    // quotes are not reliably stripped. To stay robust, we avoid quoting and
    // instead replace whitespace with underscores.
    return trimmed.replace(/\s+/g, "_");
}
function formatExecError(err) {
    if (err instanceof Error) {
        const anyErr = err;
        const stdout = anyErr.stdout ? String(anyErr.stdout) : "";
        const stderr = anyErr.stderr ? String(anyErr.stderr) : "";
        return [err.message, stdout.trim(), stderr.trim()].filter(Boolean).join(" | ");
    }
    return String(err);
}
// ---------------------------------------------------------------------------
// Simulated gateway (offline / demo mode)
// ---------------------------------------------------------------------------
class SimulatedGateway {
    async sessionSpawn(_opts) {
        const key = `acp_sim_${crypto.randomBytes(8).toString("hex")}`;
        return { ok: true, data: { childSessionKey: key } };
    }
    async sessionSend(childSessionKey, message) {
        return {
            ok: true,
            data: {
                reply: `[simulated] Echo from ${childSessionKey}: received "${message.slice(0, 80)}"`,
            },
        };
    }
    async sessionStatus(_childSessionKey) {
        return {
            ok: true,
            data: {
                alive: true,
                reusableLikely: true,
                transportState: "warm",
                rawText: "simulated: alive",
            },
        };
    }
}
exports.SimulatedGateway = SimulatedGateway;
// ---------------------------------------------------------------------------
// Real gateway adapter via `openclaw gateway call` + slash commands
// ---------------------------------------------------------------------------
class RealGatewayCliAdapter {
    openclawBin;
    managerSessionKey;
    timeoutMs;
    defaultAgentId;
    defaultCwd;
    constructor(opts) {
        this.openclawBin =
            opts?.openclawBin ?? process.env.OPENCLAW_BRIDGE_OPENCLAW_BIN ?? "openclaw";
        this.managerSessionKey =
            opts?.managerSessionKey ??
                process.env.OPENCLAW_BRIDGE_MANAGER_SESSION ??
                "bridge:manager:claude";
        this.timeoutMs = Math.max(5_000, opts?.timeoutMs ?? Number(process.env.OPENCLAW_BRIDGE_TIMEOUT_MS ?? 60_000));
        this.defaultAgentId = opts?.agentId ?? process.env.OPENCLAW_BRIDGE_AGENT ?? "claude";
        this.defaultCwd = opts?.cwd ?? process.cwd();
    }
    gatewayCall(method, params) {
        try {
            const stdout = (0, child_process_1.execFileSync)(this.openclawBin, [
                "gateway",
                "call",
                method,
                "--json",
                "--timeout",
                String(this.timeoutMs),
                "--params",
                JSON.stringify(params),
            ], {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"],
                maxBuffer: 8 * 1024 * 1024,
            });
            return JSON.parse(stdout);
        }
        catch (err) {
            throw new Error(formatExecError(err));
        }
    }
    chatHistory() {
        return this.gatewayCall("chat.history", {
            sessionKey: this.managerSessionKey,
            limit: 200,
        });
    }
    sendSlashCommand(command) {
        this.gatewayCall("chat.send", {
            sessionKey: this.managerSessionKey,
            message: command,
            idempotencyKey: crypto.randomUUID(),
        });
    }
    async waitForNewAssistantText(beforeAssistantCount, matcher) {
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
    async sessionSpawn(opts) {
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
            const text = await this.waitForNewAssistantText(before, (value) => ACP_SESSION_KEY_RE.test(value));
            const match = text.match(ACP_SESSION_KEY_RE);
            if (!match) {
                return { ok: false, error: `Unable to parse child session key from: ${text}` };
            }
            return {
                ok: true,
                data: { childSessionKey: match[1], rawText: text },
            };
        }
        catch (err) {
            return { ok: false, error: formatExecError(err) };
        }
    }
    async sessionSend(childSessionKey, message) {
        try {
            const before = extractAssistantTexts(this.chatHistory()).length;
            const command = `/acp steer --session ${sanitizeSlashToken(childSessionKey)} ${message}`;
            this.sendSlashCommand(command);
            const text = await this.waitForNewAssistantText(before);
            return { ok: true, data: { reply: text } };
        }
        catch (err) {
            return { ok: false, error: formatExecError(err) };
        }
    }
    async sessionStatus(childSessionKey) {
        try {
            const before = extractAssistantTexts(this.chatHistory()).length;
            this.sendSlashCommand(`/acp status ${sanitizeSlashToken(childSessionKey)}`);
            const text = await this.waitForNewAssistantText(before, (value) => value.includes("ACP status:") || value.includes("Unable to resolve session target"));
            const lower = text.toLowerCase();
            const missing = lower.includes("unable to resolve session target") ||
                lower.includes("missing acp metadata") ||
                lower.includes("state: dead");
            const cold = !missing &&
                (lower.includes("runtime: status=dead") ||
                    lower.includes("queue owner unavailable") ||
                    lower.includes("summary: queue owner unavailable"));
            const alive = !missing && !cold;
            const transportState = missing ? "missing" : cold ? "cold" : "warm";
            const reusableLikely = transportState !== "missing";
            return {
                ok: true,
                data: {
                    alive,
                    reusableLikely,
                    transportState,
                    rawText: text,
                },
            };
        }
        catch (err) {
            return { ok: false, error: formatExecError(err) };
        }
    }
}
exports.RealGatewayCliAdapter = RealGatewayCliAdapter;
// ---------------------------------------------------------------------------
// Bridge class
// ---------------------------------------------------------------------------
class SessionBridge {
    statePath;
    gateway;
    defaultSpawnAgentId;
    defaultSpawnCwd;
    constructor(opts) {
        this.statePath = opts?.statePath;
        this.gateway = opts?.gateway ?? new SimulatedGateway();
        this.defaultSpawnAgentId = opts?.defaultSpawnAgentId;
        this.defaultSpawnCwd = opts?.defaultSpawnCwd;
    }
    load() {
        return (0, state_1.loadState)(this.statePath);
    }
    save(state) {
        (0, state_1.saveState)(state, this.statePath);
    }
    now() {
        return new Date().toISOString();
    }
    init() {
        const state = this.load();
        this.save(state);
        return { ok: true, data: { statePath: (0, state_1.getStatePath)(this.statePath) } };
    }
    async spawn(opts) {
        const result = await this.gateway.sessionSpawn({
            ...opts,
            cwd: opts?.cwd ?? this.defaultSpawnCwd,
            agentId: opts?.agentId ?? this.defaultSpawnAgentId,
        });
        if (!result.ok || !result.data) {
            return { ok: false, error: result.error ?? "Gateway spawn failed" };
        }
        const now = this.now();
        const meta = {
            label: opts?.label,
            tags: opts?.tags,
            createdAt: now,
            updatedAt: now,
        };
        const record = {
            childSessionKey: result.data.childSessionKey,
            parentSessionKey: opts?.parentSessionKey,
            status: "active",
            metadata: meta,
            history: result.data.rawText
                ? [{ role: "assistant", content: result.data.rawText, timestamp: now }]
                : [],
        };
        let state = this.load();
        state = (0, state_1.putSession)(state, record);
        state = (0, state_1.setActiveSession)(state, record.childSessionKey);
        this.save(state);
        return { ok: true, data: record };
    }
    async send(message, opts) {
        let state = this.load();
        const key = opts?.sessionKey ?? state.activeSessionKey;
        if (!key) {
            return { ok: false, error: "No active session. Run spawn first." };
        }
        const session = (0, state_1.getSession)(state, key);
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
            state = (0, state_1.putSession)(state, session);
            this.save(state);
            return { ok: false, error: result.error ?? "Gateway send failed" };
        }
        const now = this.now();
        const userMsg = { role: "user", content: message, timestamp: now };
        const assistantMsg = {
            role: "assistant",
            content: result.data.reply,
            timestamp: now,
        };
        session.history.push(userMsg, assistantMsg);
        session.metadata.updatedAt = now;
        if (session.history.length > 50) {
            session.history = session.history.slice(-50);
        }
        state = (0, state_1.putSession)(state, session);
        this.save(state);
        return { ok: true, data: { reply: result.data.reply, sessionKey: key } };
    }
    status(sessionKey) {
        const state = this.load();
        if (sessionKey) {
            const session = (0, state_1.getSession)(state, sessionKey);
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
                statePath: (0, state_1.getStatePath)(this.statePath),
            },
        };
    }
    async probe(sessionKey) {
        const state = this.load();
        const key = sessionKey ?? state.activeSessionKey;
        if (!key) {
            return { ok: false, error: "No active session to probe." };
        }
        const local = (0, state_1.getSession)(state, key);
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
                reusableLikely: result.data.reusableLikely,
                transportState: result.data.transportState,
                rawText: result.data.rawText,
            },
        };
    }
    bind(sessionKey, updates) {
        let state = this.load();
        const session = (0, state_1.getSession)(state, sessionKey);
        if (!session) {
            return { ok: false, error: `Session ${sessionKey} not found.` };
        }
        if (updates.label !== undefined)
            session.metadata.label = updates.label;
        if (updates.tags !== undefined) {
            session.metadata.tags = { ...session.metadata.tags, ...updates.tags };
        }
        session.metadata.updatedAt = this.now();
        state = (0, state_1.putSession)(state, session);
        this.save(state);
        return { ok: true, data: session };
    }
    exportConfig(sessionKeys) {
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
    importConfig(config) {
        let state = this.load();
        let count = 0;
        for (const rec of config.sessions) {
            if (!state.sessions[rec.childSessionKey]) {
                state = (0, state_1.putSession)(state, rec);
                count++;
            }
        }
        this.save(state);
        return { ok: true, data: { imported: count } };
    }
}
exports.SessionBridge = SessionBridge;
//# sourceMappingURL=bridge.js.map