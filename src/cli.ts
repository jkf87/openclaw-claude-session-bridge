#!/usr/bin/env node

/**
 * CLI entry point for openclaw-claude-session-bridge.
 *
 * Commands:
 *   init                  Initialize bridge state directory
 *   spawn [--label] [--tag key=val]  Spawn a new ACP Claude session
 *   send <message>        Send a follow-up to the active session
 *   status [sessionKey]   Inspect bridge / session state
 *   bind <sessionKey>     Bind metadata to a session
 *   export-config         Export session bindings as JSON
 */

import { Command } from "commander";
import { SessionBridge } from "./bridge";

const program = new Command();
const bridge = new SessionBridge();

function print(result: { ok: boolean; data?: unknown; error?: string }): void {
  if (result.ok) {
    console.log(JSON.stringify(result.data, null, 2));
  } else {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }
}

program
  .name("openclaw-bridge")
  .description(
    "Maintain durable Claude Code ACP sessions through OpenClaw session primitives."
  )
  .version("0.1.0");

program
  .command("init")
  .description("Initialize the bridge state directory")
  .action(() => {
    print(bridge.init());
  });

program
  .command("spawn")
  .description("Spawn a new Claude ACP child session")
  .option("-l, --label <label>", "Human-readable label")
  .option("-t, --tag <kv...>", "Tags as key=value pairs")
  .option("-p, --parent <key>", "Parent session key")
  .action(async (opts) => {
    const tags: Record<string, string> = {};
    if (opts.tag) {
      for (const kv of opts.tag as string[]) {
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
  .action(async (message: string, opts) => {
    const result = await bridge.send(message, { sessionKey: opts.session });
    print(result);
  });

program
  .command("status")
  .description("Show bridge status or details of a specific session")
  .argument("[sessionKey]", "Optional session key to inspect")
  .action((sessionKey?: string) => {
    print(bridge.status(sessionKey));
  });

program
  .command("bind <sessionKey>")
  .description("Bind / update metadata on an existing session")
  .option("-l, --label <label>", "Set label")
  .option("-t, --tag <kv...>", "Set tags as key=value pairs")
  .action((sessionKey: string, opts) => {
    const tags: Record<string, string> = {};
    if (opts.tag) {
      for (const kv of opts.tag as string[]) {
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
    const result = bridge.exportConfig(opts.sessions);
    print(result);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
