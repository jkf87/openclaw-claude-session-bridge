# RESULT

## What was built

**openclaw-claude-session-bridge** — A TypeScript CLI and library that maintains durable Claude Code ACP sessions through OpenClaw session primitives.

### Components
- **Core library** (`src/bridge.ts`, `src/state.ts`, `src/types.ts`) — Session lifecycle management with pluggable gateway adapter
- **CLI** (`src/cli.ts`, `bin/openclaw-bridge.js`) — Commands: `init`, `spawn`, `send`, `status`, `bind`, `export-config`
- **Simulation suite** (`simulate/scenarios.ts`) — 23 assertions across 5 scenarios

## Commands to install/use

```bash
git clone https://github.com/jkf87/openclaw-claude-session-bridge.git
cd openclaw-claude-session-bridge
npm install && npm run build

# CLI
./bin/openclaw-bridge.js init
./bin/openclaw-bridge.js spawn --label "my-task"
./bin/openclaw-bridge.js send "Hello Claude"
./bin/openclaw-bridge.js status

# Run simulation
npm run simulate
```

## Repo URL

https://github.com/jkf87/openclaw-claude-session-bridge

## What was validated

### Simulation

Simulation script (`npm run simulate`) exercises:
1. Fresh spawn — session created with key, label, tags
2. Follow-up send — messages delivered and history tracked
3. Resume from saved state — new bridge instance reads persisted state correctly
4. Missing session handling — graceful errors for nonexistent keys
5. Config/binding export — bind metadata, export JSON, import into fresh bridge

**Result: 23/23 assertions passed.**

### Real-mode smoke test (OpenClaw Gateway + /acp slash commands)

Validated on a local OpenClaw install by:
- installing from the public GitHub repo into a separate consumer project
- running: `init → spawn → send → send → status`
- confirming that the *same* saved `childSessionKey` can be steered multiple times across invocations

Note: `/acp status` may report `runtime: status=dead` / `queue owner unavailable` even when the next `/acp steer` can still revive/continue the session. The bridge now classifies this as `transportState=cold` (likely reusable) rather than treating it as permanently dead.

## Known limitations

- **Simulated gateway**: Without a running OpenClaw Gateway, the bridge uses a local echo simulator. Real ACP RPCs require gateway connectivity.
- **No server-side resume**: ACP sessions may expire server-side. The `childSessionKey` is the only resumption handle.
- **History cap**: Message history is capped at 50 entries per session to bound state file size.
- **Single-machine state**: The local state file is not synced across machines (use `export-config` / `import` for that).
