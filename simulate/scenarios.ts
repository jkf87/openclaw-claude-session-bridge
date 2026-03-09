/**
 * Simulation script exercising 5 core scenarios.
 *
 * Run: npm run build && npm run simulate
 *
 * Scenarios:
 *   1. Fresh spawn
 *   2. Follow-up send to the same session
 *   3. Resume from saved state (new bridge instance reads persisted state)
 *   4. Missing session handling
 *   5. Config/binding export flow
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { SessionBridge } from "../src/bridge";
import type { ExportedConfig } from "../src/types";

// Use a temp directory so we don't pollute the repo.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-sim-"));
const STATE_PATH = path.join(TMP_DIR, "bridge-state.json");

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
}

async function run(): Promise<void> {
  console.log(`\nOpenClaw Claude Session Bridge — Simulation\n${"=".repeat(50)}`);
  console.log(`State file: ${STATE_PATH}\n`);

  // -----------------------------------------------------------------------
  // Scenario 1: Fresh spawn
  // -----------------------------------------------------------------------
  console.log("Scenario 1: Fresh spawn");
  const bridge1 = new SessionBridge({ statePath: STATE_PATH });
  bridge1.init();

  const spawn1 = await bridge1.spawn({ label: "test-session-1", tags: { env: "sim" } });
  assert(spawn1.ok === true, "spawn succeeds");
  assert(!!spawn1.data?.childSessionKey, "returns a childSessionKey");
  assert(spawn1.data?.metadata.label === "test-session-1", "label is set");

  const sessionKey = spawn1.data!.childSessionKey;
  console.log();

  // -----------------------------------------------------------------------
  // Scenario 2: Follow-up send to the same session
  // -----------------------------------------------------------------------
  console.log("Scenario 2: Follow-up send to same session");
  const send1 = await bridge1.send("Hello from simulation");
  assert(send1.ok === true, "send succeeds");
  assert(typeof send1.data?.reply === "string", "receives a reply");
  assert(send1.data?.sessionKey === sessionKey, "reply references correct session");

  const send2 = await bridge1.send("Second message");
  assert(send2.ok === true, "second send succeeds");

  const statusAfterSend = bridge1.status(sessionKey);
  assert(
    (statusAfterSend.data as any).history.length === 4,
    "history has 4 messages (2 user + 2 assistant)"
  );
  console.log();

  // -----------------------------------------------------------------------
  // Scenario 3: Resume from saved state
  // -----------------------------------------------------------------------
  console.log("Scenario 3: Resume from saved state (new bridge instance)");
  const bridge2 = new SessionBridge({ statePath: STATE_PATH });
  const resumed = bridge2.status(sessionKey);
  assert(resumed.ok === true, "resumed bridge finds session");
  assert(
    (resumed.data as any).childSessionKey === sessionKey,
    "session key matches"
  );
  assert(
    (resumed.data as any).history.length === 4,
    "history is preserved"
  );

  const sendResume = await bridge2.send("Message after resume");
  assert(sendResume.ok === true, "send after resume succeeds");
  console.log();

  // -----------------------------------------------------------------------
  // Scenario 4: Missing session handling
  // -----------------------------------------------------------------------
  console.log("Scenario 4: Missing session handling");
  const missingStatus = bridge2.status("nonexistent_key_12345");
  assert(missingStatus.ok === false, "status returns error for missing session");
  assert(
    missingStatus.error?.includes("not found") === true,
    "error message mentions not found"
  );

  const missingSend = await bridge2.send("hello", {
    sessionKey: "nonexistent_key_12345",
  });
  assert(missingSend.ok === false, "send returns error for missing session");
  console.log();

  // -----------------------------------------------------------------------
  // Scenario 5: Config/binding export flow
  // -----------------------------------------------------------------------
  console.log("Scenario 5: Config/binding export flow");

  // Bind metadata first.
  const bindResult = bridge2.bind(sessionKey, {
    label: "renamed-session",
    tags: { priority: "high" },
  });
  assert(bindResult.ok === true, "bind succeeds");
  assert(bindResult.data?.metadata.label === "renamed-session", "label updated");
  assert(bindResult.data?.metadata.tags?.priority === "high", "tags updated");

  // Export.
  const exported = bridge2.exportConfig();
  assert(exported.ok === true, "export succeeds");
  assert(
    (exported.data as ExportedConfig).sessions.length >= 1,
    "exported config contains sessions"
  );

  // Import into a fresh bridge.
  const TMP_DIR2 = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-sim2-"));
  const STATE_PATH2 = path.join(TMP_DIR2, "bridge-state.json");
  const bridge3 = new SessionBridge({ statePath: STATE_PATH2 });
  bridge3.init();
  const importResult = bridge3.importConfig(exported.data as ExportedConfig);
  assert(importResult.ok === true, "import succeeds");
  assert((importResult.data as any).imported >= 1, "imported at least 1 session");

  const importedStatus = bridge3.status(sessionKey);
  assert(importedStatus.ok === true, "imported session is queryable");
  console.log();

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  console.log("=".repeat(50));
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);

  // Cleanup
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.rmSync(TMP_DIR2, { recursive: true, force: true });

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Simulation crashed:", err);
  process.exit(1);
});
