#!/usr/bin/env node
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
const fs = __importStar(require("fs"));
const commander_1 = require("commander");
const bridge_1 = require("./bridge");
const program = new commander_1.Command();
function print(result) {
    if (result.ok) {
        console.log(JSON.stringify(result.data, null, 2));
    }
    else {
        console.error(`Error: ${result.error}`);
        process.exit(1);
    }
}
function rootOptions() {
    return program.opts();
}
function createBridge() {
    const opts = rootOptions();
    const gateway = opts.real
        ? new bridge_1.RealGatewayCliAdapter({
            managerSessionKey: opts.managerSession,
            agentId: opts.agent,
            cwd: opts.cwd,
        })
        : new bridge_1.SimulatedGateway();
    return new bridge_1.SessionBridge({
        statePath: opts.statePath,
        gateway,
        defaultSpawnAgentId: opts.agent,
        defaultSpawnCwd: opts.cwd,
    });
}
program
    .name("openclaw-bridge")
    .description("Maintain durable Claude Code ACP sessions through OpenClaw session primitives.")
    .version("0.1.2")
    .option("--real", "Use the real OpenClaw Gateway via slash commands in a manager session")
    .option("--state-path <path>", "Override the bridge state file path")
    .option("--manager-session <key>", "Manager session key used to run /acp slash commands when --real is enabled")
    .option("--agent <id>", "ACP agent id to spawn when --real is enabled", "claude")
    .option("--cwd <path>", "Working directory for spawned ACP sessions when --real is enabled");
program
    .command("init")
    .description("Initialize the bridge state directory")
    .action(() => {
    const bridge = createBridge();
    print(bridge.init());
});
program
    .command("spawn")
    .description("Spawn a new Claude ACP child session")
    .option("-l, --label <label>", "Human-readable label")
    .option("-t, --tag <kv...>", "Tags as key=value pairs")
    .option("-p, --parent <key>", "Parent session key")
    .action(async (opts) => {
    const bridge = createBridge();
    const tags = {};
    if (opts.tag) {
        for (const kv of opts.tag) {
            const [k, ...rest] = kv.split("=");
            tags[k] = rest.join("=");
        }
    }
    const result = await bridge.spawn({
        label: opts.label,
        tags: Object.keys(tags).length > 0 ? tags : undefined,
        parentSessionKey: opts.parent,
    });
    print(result);
});
program
    .command("send <message>")
    .description("Send a follow-up message to the active (or specified) session")
    .option("-s, --session <key>", "Target session key")
    .action(async (message, opts) => {
    const bridge = createBridge();
    const result = await bridge.send(message, { sessionKey: opts.session });
    print(result);
});
program
    .command("status")
    .description("Show local bridge status; with --real also probe remote ACP session")
    .argument("[sessionKey]", "Optional session key to inspect")
    .action(async (sessionKey) => {
    const bridge = createBridge();
    const local = bridge.status(sessionKey);
    if (!rootOptions().real) {
        print(local);
        return;
    }
    if (!local.ok) {
        print(local);
        return;
    }
    const probe = await bridge.probe(sessionKey);
    print({
        ok: true,
        data: {
            local: local.data,
            remote: probe.ok ? probe.data : { error: probe.error },
        },
    });
});
program
    .command("bind <sessionKey>")
    .description("Bind / update metadata on an existing session")
    .option("-l, --label <label>", "Set label")
    .option("-t, --tag <kv...>", "Set tags as key=value pairs")
    .action((sessionKey, opts) => {
    const bridge = createBridge();
    const tags = {};
    if (opts.tag) {
        for (const kv of opts.tag) {
            const [k, ...rest] = kv.split("=");
            tags[k] = rest.join("=");
        }
    }
    const result = bridge.bind(sessionKey, {
        label: opts.label,
        tags: Object.keys(tags).length > 0 ? tags : undefined,
    });
    print(result);
});
program
    .command("export-config")
    .description("Export session bindings as JSON")
    .option("-s, --sessions <keys...>", "Specific session keys to export")
    .action((opts) => {
    const bridge = createBridge();
    const result = bridge.exportConfig(opts.sessions);
    print(result);
});
program
    .command("import-config <file>")
    .description("Import a previously exported bridge config JSON file")
    .action((file) => {
    const bridge = createBridge();
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    const result = bridge.importConfig(config);
    print(result);
});
program.parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=cli.js.map