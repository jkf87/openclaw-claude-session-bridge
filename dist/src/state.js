"use strict";
/**
 * Durable local state management.
 *
 * Persists bridge state as a JSON file so that session keys and metadata
 * survive across CLI invocations and process restarts.
 */
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
exports.ensureStateDir = ensureStateDir;
exports.loadState = loadState;
exports.saveState = saveState;
exports.getSession = getSession;
exports.putSession = putSession;
exports.setActiveSession = setActiveSession;
exports.getStatePath = getStatePath;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const STATE_VERSION = 1;
const DEFAULT_STATE_DIR = ".openclaw-bridge";
const STATE_FILENAME = "bridge-state.json";
function defaultStateDir() {
    return path.join(process.cwd(), DEFAULT_STATE_DIR);
}
function defaultStatePath() {
    return path.join(defaultStateDir(), STATE_FILENAME);
}
function emptyState() {
    return {
        version: STATE_VERSION,
        activeSessionKey: null,
        sessions: {},
    };
}
/** Ensure the state directory exists. */
function ensureStateDir(stateDir) {
    const dir = stateDir ?? defaultStateDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}
/** Load bridge state from disk, returning empty state if absent. */
function loadState(statePath) {
    const p = statePath ?? defaultStatePath();
    if (!fs.existsSync(p)) {
        return emptyState();
    }
    try {
        const raw = fs.readFileSync(p, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed.version !== STATE_VERSION) {
            console.warn(`[bridge] State version mismatch (got ${parsed.version}, expected ${STATE_VERSION}). Resetting.`);
            return emptyState();
        }
        return parsed;
    }
    catch {
        console.warn("[bridge] Corrupt state file. Resetting.");
        return emptyState();
    }
}
/** Save bridge state to disk atomically (write-then-rename). */
function saveState(state, statePath) {
    const p = statePath ?? defaultStatePath();
    ensureStateDir(path.dirname(p));
    const tmp = p + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
    fs.renameSync(tmp, p);
}
/** Get a session record by key, or null. */
function getSession(state, key) {
    return state.sessions[key] ?? null;
}
/** Upsert a session record into state. */
function putSession(state, record) {
    return {
        ...state,
        sessions: {
            ...state.sessions,
            [record.childSessionKey]: record,
        },
    };
}
/** Set the active session key. */
function setActiveSession(state, key) {
    return { ...state, activeSessionKey: key };
}
/** Get the resolved state file path (for display). */
function getStatePath(statePath) {
    return statePath ?? defaultStatePath();
}
//# sourceMappingURL=state.js.map