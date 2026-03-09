# openclaw-claude-session-bridge

A TypeScript CLI and library for maintaining **durable Claude Code ACP sessions** through OpenClaw session primitives.

## What it does

This tool lets an OpenClaw agent (or any automation) keep a persistent conversation with a Claude Code child session by:

1. **Spawning** a new ACP child session (`sessions_spawn`)
2. **Sending** follow-up messages to the same child session (`sessions_send`)
3. **Persisting** session keys and metadata to a local state file so the session can be resumed later
4. **Inspecting** bridge state at any time
5. **Binding** metadata (labels, tags) to sessions for organization
6. **Exporting/importing** session configs for backup or cross-machine transfer

## Installation

```bash
# From source
git clone https://github.com/jkf87/openclaw-claude-session-bridge.git
cd openclaw-claude-session-bridge
npm install
npm run build

# Use the CLI
./bin/openclaw-bridge.js --help

# Or link globally
npm link
openclaw-bridge --help
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize the bridge state directory (`.openclaw-bridge/`) |
| `spawn` | Spawn a new Claude ACP child session |
| `send <message>` | Send a follow-up message to the active session |
| `status [sessionKey]` | Show bridge status or session details |
| `bind <sessionKey>` | Update metadata (label, tags) on a session |
| `export-config` | Export session bindings as JSON |

### Examples

```bash
# Initialize
openclaw-bridge init

# Spawn a labeled session
openclaw-bridge spawn --label "my-task" --tag env=production

# Send messages (goes to the active session automatically)
openclaw-bridge send "What files are in the project?"
openclaw-bridge send "Refactor the auth module"

# Check status
openclaw-bridge status

# Bind metadata
openclaw-bridge bind acp_sim_abc123 --label "renamed" --tag priority=high

# Export for backup
openclaw-bridge export-config > backup.json
```

## Library API

```typescript
import { SessionBridge } from "openclaw-claude-session-bridge";

const bridge = new SessionBridge();
bridge.init();

// Spawn
const { data } = await bridge.spawn({ label: "my-session" });
console.log(data.childSessionKey);

// Send
const reply = await bridge.send("Hello, Claude");
console.log(reply.data.reply);

// Status
const status = bridge.status();
console.log(status.data);
```

## Architecture

```
openclaw-claude-session-bridge/
├── src/
│   ├── types.ts      # Core TypeScript interfaces
│   ├── state.ts      # Durable local state (JSON file persistence)
│   ├── bridge.ts     # Session lifecycle: spawn, send, resume, bind, export
│   ├── cli.ts        # Commander-based CLI
│   └── index.ts      # Public API surface
├── simulate/
│   └── scenarios.ts  # 5-scenario validation script
├── bin/
│   └── openclaw-bridge.js  # CLI entry point
├── package.json
├── tsconfig.json
├── LICENSE
└── README.md
```

### State file

The bridge persists all session data in `.openclaw-bridge/bridge-state.json`:

```json
{
  "version": 1,
  "activeSessionKey": "acp_sim_abc123...",
  "sessions": {
    "acp_sim_abc123...": {
      "childSessionKey": "acp_sim_abc123...",
      "status": "active",
      "metadata": { "label": "my-task", "createdAt": "...", "updatedAt": "..." },
      "history": [ ... ]
    }
  }
}
```

This file survives across process restarts, enabling session resumption.

## How this relates to OpenClaw ACP primitives

### `sessions_spawn`

The `spawn` command/method maps to the ACP `sessions_spawn` primitive. It requests the OpenClaw Gateway to create a new child Claude session and returns a `childSessionKey` that uniquely identifies it.

### `sessions_send`

The `send` command/method maps to `sessions_send`. It delivers a follow-up message to an existing child session identified by its `childSessionKey`, maintaining conversational context.

### ACP Bindings

The `bind` and `export-config` commands relate to ACP session bindings — the ability to attach metadata to a session and persist that association. This bridge stores bindings locally, enabling:

- **Resumption**: A new process can load persisted state and continue the same ACP session.
- **Portability**: Exported configs can be transferred to another machine or agent.
- **Organization**: Labels and tags help manage multiple concurrent sessions.

### Honest limitations

- **Simulated mode**: When the OpenClaw Gateway is not available, the bridge uses a simulated adapter that echoes messages locally. Real ACP session operations require a running gateway.
- **Session lifetime**: ACP sessions may expire server-side. The bridge tracks local state optimistically; a stale `childSessionKey` will produce an error on the next real `send`.
- **No server-side resume**: ACP does not currently support resuming a session from a saved conversation history. The `childSessionKey` is the only resumption handle — if the server-side session is gone, a new one must be spawned.
- **Gateway adapter**: To connect to a real OpenClaw Gateway, implement the `GatewayAdapter` interface and pass it to `new SessionBridge({ gateway: yourAdapter })`.

## Running the simulation

```bash
npm run build
npm run simulate
```

This exercises 5 scenarios:
1. Fresh spawn
2. Follow-up send to the same session
3. Resume from saved state (new bridge instance)
4. Missing session handling (graceful errors)
5. Config/binding export and import flow

## License

MIT
