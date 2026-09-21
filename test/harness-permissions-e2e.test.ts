import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resumeAgent, runAgent } from "../src/agent-runner.js";
import { registerAgents } from "../src/agent-types.js";
import { loadCustomAgents } from "../src/custom-agents.js";
import { fauxModelBackend } from "./helpers/faux-model-backend.js";
import { registerFauxProvider } from "./helpers/pi-ai.js";

const runtimeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("harness child permission enforcement (real Pi, scripted model)", () => {
  const originalEnv = { ...process.env };
  let root: string;
  let session: AgentSession | undefined;
  let faux: ReturnType<typeof registerFauxProvider>;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "harness-permission-e2e-"));
    process.env.PI_CODING_AGENT_DIR = join(root, "profile");
    process.env.HARNESS_RUNTIME_MANIFEST = join(runtimeRoot, "runtime-manifest.json");
    delete process.env.HARNESS_CORE_OVERRIDES;
    const configDir = join(root, "profile/extensions/pi-permission-system");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), JSON.stringify({ yoloMode: true, permissionReviewLog: true }));
    mkdirSync(join(root, ".pi/agents"), { recursive: true });
    writeFileSync(join(root, ".pi/agents/database.md"), `---
name: database
description: Permission regression
tools: read, bash
extensions: pi-permission-system
exclude_extensions: tool-routing
skills: false
prompt_mode: replace
persist_session: false
permission:
  "*": ask
  bash:
    "*": deny
    "printf allowed": allow
    "printf ask": ask
---
Inspect the database. No active_agent prompt tag is needed.
`);
    registerAgents(loadCustomAgents(root));
    faux = registerFauxProvider({ provider: "faux", models: [{ id: "faux-1", contextWindow: 200_000 }] });
  });

  afterEach(() => {
    session?.dispose();
    session = undefined;
    faux.unregister();
    process.env = { ...originalEnv };
    rmSync(root, { recursive: true, force: true });
  });

  async function run() {
    const model = faux.getModel();
    const backend = fauxModelBackend(model);
    backend.modelRegistry.runtime = backend.modelRuntime;
    return runAgent({ cwd: root, getSystemPrompt: () => "parent", model,
      modelRegistry: backend.modelRegistry,
    } as ExtensionContext, "database", "probe", {
      pi: { exec: async () => ({ code: 1, stdout: "", stderr: "" }) } as unknown as ExtensionAPI,
      model,
      onSessionCreated: (created) => { session = created; },
    });
  }

  it("YOLO allows ask, preserves deny before shell execution, and stays enforced on resume", async () => {
    const marker = join(root, "must-not-exist");
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("bash", { command: `printf forbidden > '${marker}'` })]),
      fauxAssistantMessage([fauxToolCall("bash", { command: "printf allowed" })]),
      fauxAssistantMessage([fauxToolCall("bash", { command: "printf ask" })]),
      fauxAssistantMessage([fauxText("done")]),
    ]);
    const result = await run();
    expect(result.failure).toBeUndefined();
    const results = result.session.messages.filter((message) => message.role === "toolResult");
    expect(results.map((message) => message.isError)).toEqual([true, false, false]);
    expect(JSON.stringify(results[0])).toContain("pi-permission-system");
    expect(result.session.getAllTools().map((tool) => tool.name)).not.toContain("write");
    expect(existsSync(marker)).toBe(false);
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("bash", { command: `printf forbidden > '${marker}'` })]),
      fauxAssistantMessage([fauxText("done")]),
    ]);
    await resumeAgent(result.session, "again");
    expect(result.session.messages.filter((message) => message.role === "toolResult").at(-1)?.isError).toBe(true);
    expect(existsSync(marker)).toBe(false);
  }, 30000);

  it("refuses to start when the required permission extension is missing", async () => {
    process.env.HARNESS_RUNTIME_MANIFEST = join(root, "missing/runtime-manifest.json");
    await expect(run()).rejects.toThrow("Required pi-permission-system");
    expect(session).toBeUndefined();
  });

  it("refuses a permission extension that loads without a tool_call guard", async () => {
    const extension = join(root, "pi-permission-system.ts");
    writeFileSync(extension, "export default function () {}\n");
    process.env.HARNESS_CORE_OVERRIDES = JSON.stringify({ "permission-system": `local:${extension}` });
    await expect(run()).rejects.toThrow("tool_call guard did not load");
    expect(session).toBeUndefined();
  });
});
