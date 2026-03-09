# openclaw-claude-session-bridge

A TypeScript CLI/library for maintaining **durable Claude Code ACP sessions** through OpenClaw session primitives.

## What it does

This tool helps an OpenClaw agent or operator keep talking to the **same Claude ACP session** by:

1. **Spawning** a Claude ACP session
2. **Sending** follow-up messages to the same child session key
3. **Persisting** session keys and metadata to a local state file
4. **Probing** whether the remote ACP session still looks alive
5. **Binding** local metadata (labels, tags) for organization
6. **Exporting/importing** saved bridge state

## Two modes

### 1) Simulated mode

Default mode for offline testing and the included scenario suite.

- No OpenClaw Gateway required
- Messages are echoed locally
- Safe for demos and CI-like validation

### 2) Real mode (`--real`)

Real mode drives OpenClaw through:

- `openclaw gateway call chat.send`
- `openclaw gateway call chat.history`
- slash commands in a dedicated **manager session**:
  - `/acp spawn ...`
  - `/acp steer --session ...`
  - `/acp status ...`

This is honest about current OpenClaw surfaces: the bridge does **not** call a hidden direct `sessions_spawn` RPC from Node. Instead, it uses supported Gateway chat/slash-command flows that are available today.

## Installation

```bash
git clone https://github.com/jkf87/openclaw-claude-session-bridge.git
cd openclaw-claude-session-bridge
npm install
npm run build
```

Optional global install:

```bash
npm link
openclaw-bridge --help
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `init` | Initialize the bridge state directory (`.openclaw-bridge/`) |
| `spawn` | Spawn a new Claude ACP child session |
| `send <message>` | Send a follow-up message to the active session |
| `status [sessionKey]` | Show local state, and with `--real` also probe remote ACP status |
| `bind <sessionKey>` | Update local metadata (label, tags) on a session |
| `export-config` | Export session bindings as JSON |
| `import-config <file>` | Import a previously exported bridge config |

## Real mode usage

```bash
# initialize local state
openclaw-bridge --real --manager-session bridge:manager:claude init

# spawn a persistent Claude ACP session
openclaw-bridge \
  --real \
  --manager-session bridge:manager:claude \
  --cwd /absolute/path/to/project \
  spawn --label "bridge-test"

# send follow-ups to the saved active session
openclaw-bridge --real --manager-session bridge:manager:claude send "Reply with exactly: HELLO"
openclaw-bridge --real --manager-session bridge:manager:claude send "Now say SECOND"

# inspect local + remote status
openclaw-bridge --real --manager-session bridge:manager:claude status

# bind local metadata
openclaw-bridge --real --manager-session bridge:manager:claude bind <childSessionKey> --label "important" --tag env=prod
```

## Simulated mode usage

```bash
openclaw-bridge init
openclaw-bridge spawn --label "demo"
openclaw-bridge send "Hello Claude"
openclaw-bridge status
```

## Library API

```ts
import {
  RealGatewayCliAdapter,
  SessionBridge,
} from "openclaw-claude-session-bridge";

const bridge = new SessionBridge({
  gateway: new RealGatewayCliAdapter({
    managerSessionKey: "bridge:manager:claude",
    cwd: process.cwd(),
    agentId: "claude",
  }),
});

await bridge.spawn({ label: "my-session" });
await bridge.send("Continue from the previous instruction.");
const probe = await bridge.probe();
console.log(probe.data);
```

## Architecture

```text
openclaw-claude-session-bridge/
├── src/
│   ├── types.ts
│   ├── state.ts
│   ├── bridge.ts      # simulated + real CLI gateway adapters
│   ├── cli.ts
│   └── index.ts
├── simulate/
│   └── scenarios.ts
├── bin/
│   └── openclaw-bridge.js
├── package.json
├── tsconfig.json
├── LICENSE
└── README.md
```

## State file

The bridge persists state in `.openclaw-bridge/bridge-state.json` under the current working directory by default.

Example:

```json
{
  "version": 1,
  "activeSessionKey": "agent:claude:acp:...",
  "sessions": {
    "agent:claude:acp:...": {
      "childSessionKey": "agent:claude:acp:...",
      "status": "active",
      "metadata": {
        "label": "bridge-test",
        "createdAt": "2026-03-10T...Z",
        "updatedAt": "2026-03-10T...Z"
      },
      "history": []
    }
  }
}
```

## How this maps to OpenClaw ACP features

### Spawn

The bridge uses `/acp spawn claude --mode persistent --thread off --cwd ...` in a manager session and stores the returned `childSessionKey`.

### Send

The bridge uses `/acp steer --session <childSessionKey> ...` so later invocations can continue using the same saved session key.

### Binding

The bridge currently provides **local binding metadata** (`label`, `tags`) and config export/import. It does **not** mutate OpenClaw channel thread bindings.

### Status

The bridge uses `/acp status <childSessionKey>` and parses the resulting text to determine whether the remote runtime appears alive.

## Honest limitations

- **Real mode depends on OpenClaw CLI/Gateway** being configured and reachable.
- **Manager-session based**: real mode currently relies on supported slash-command flows rather than a dedicated public Node RPC for ACP spawn/steer.
- **Session lifetime is not guaranteed**: a saved `childSessionKey` may later report dead or stale if the ACP runtime has exited.
- **Local binding only**: this tool stores labels/tags locally; it does not configure Telegram/Discord thread binding policy for you.
- **History is capped** at 50 messages per session to bound state size.

## Running the simulation

```bash
npm run build
npm run simulate
```

This exercises 5 scenarios:
1. Fresh spawn
2. Follow-up send to the same session
3. Resume from saved state
4. Missing session handling
5. Config/binding export/import flow

## License

MIT
