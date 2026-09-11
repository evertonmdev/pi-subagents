import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentManager } from "../src/agent-manager.js";
import { AgentRecordStore } from "../src/agent-record-store.js";
import { runAgent } from "../src/agent-runner.js";
import extension from "../src/index.js";
import type { AgentRecord } from "../src/types.js";
import { ctx, hermeticDir, makePi, textOf } from "./helpers/boot-extension.js";

vi.mock("../src/agent-runner.js", async importOriginal => ({
  ...await importOriginal<typeof import("../src/agent-runner.js")>(),
  runAgent: vi.fn(),
}));
vi.mock("../src/worktree.js", () => ({ createWorktree: vi.fn(), cleanupWorktree: vi.fn(), pruneWorktrees: vi.fn() }));

let env: ReturnType<typeof hermeticDir>;
const managers: AgentManager[] = [];
let shutdown: (() => Promise<void>) | undefined;
const pi = {} as ExtensionAPI;

function manager() {
  const value = new AgentManager();
  managers.push(value);
  return value;
}

function context(id = "parent-a", entries: unknown[] = []): ExtensionContext {
  return ctx({ cwd: env.dir, sessionManager: {
    getSessionId: () => id, getSessionFile: () => join(env.dir, `${id}.jsonl`),
    getEntries: () => entries, getBranch: () => [],
  } });
}

function restore(value: AgentManager, parent = context()) {
  value.restoreSession(parent.sessionManager.getSessionId(), parent.sessionManager.getSessionFile(), parent.sessionManager.getEntries());
}

beforeEach(() => {
  env = hermeticDir({ settings: { scheduling: false } });
  vi.mocked(runAgent).mockImplementation(async (_ctx, _type, _prompt, options) => {
    const child = join(env.dir, "child.jsonl");
    writeFileSync(child, "saved transcript");
    const session = {
      model: { id: "gpt-6-astra" }, messages: [], dispose: vi.fn(),
      sessionManager: { getSessionFile: () => child },
    } as unknown as AgentSession;
    options.onSessionCreated?.(session);
    options.onToolActivity?.({ type: "end", toolName: "read" });
    return { responseText: "Persisted receipt evidence", session, aborted: false, steered: false };
  });
});

afterEach(async () => {
  await shutdown?.();
  shutdown = undefined;
  for (const value of managers.splice(0)) value.dispose();
  env.restore();
  vi.clearAllMocks();
});

describe("persistent agent identities", () => {
  it("restores the same ID, result, handle, transcript and consumed state after restart and memory cleanup", async () => {
    const first = manager();
    restore(first);
    const id = first.spawn(pi, context(), "general-purpose", "Check", { description: "Receipt", name: "receipt", isBackground: true });
    await first.getRecord(id)!.promise;
    const original = first.getRecord(id)!;
    original.resultConsumed = true;
    first.persistRecord(original);
    first.clearCompleted();
    expect(first.getRecord(id)?.result).toBe("Persisted receipt evidence");
    const second = manager();
    restore(second);
    expect(second.getRecord(id)).toMatchObject({ id, result: original.result, alias: original.alias, resultConsumed: true, toolUses: 1 });
    expect(second.getRecord(id)?.session).toBeUndefined();
    expect(second.getRecord(id)?.sessionFile).toBe(original.sessionFile);
    expect(second.resolveMention("receipt")?.kind).toBe("live");
    const file = join(env.dir, `parent-a.jsonl.subagents/${id}.json`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).not.toContain("abortController");
  });

  it("does not expose another session's agents, including when an old run completes after a switch", async () => {
    const first = manager();
    restore(first);
    const id = first.spawn(pi, context(), "general-purpose", "Check", { description: "Receipt", isBackground: true });
    restore(first, context("parent-b"));
    expect(first.getRecord(id)).toBeUndefined();
    await first.waitForAll();
    expect(first.getRecord(id)).toBeUndefined();
    expect(first.listAgents()).toEqual([]);
    const second = manager();
    restore(second, context("parent-b"));
    expect(second.getRecord(id)).toBeUndefined();
    restore(second);
    expect(second.getRecord(id)?.result).toBe("Persisted receipt evidence");
  });

  it("recovers a interrupted queued/running ID as stopped without replaying tools", () => {
    const store = new AgentRecordStore(join(env.dir, "parent-a.jsonl"), "parent-a");
    for (const status of ["queued", "running"] as const) {
      store.save({ id: `interrupted-${status}`, type: "general-purpose", status, description: "Receipt", startedAt: 1, toolUses: 0,
        result: "Partial evidence", lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 }, compactionCount: 0 });
    }
    const restored = manager();
    restore(restored);
    expect(restored.hasRunning()).toBe(false);
    expect(restored.getRecord("interrupted-running")).toMatchObject({ status: "stopped", result: "Partial evidence" });
    expect(restored.getRecord("interrupted-queued")?.error).toContain("Interrupted");
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("resumes a saved transcript with its original ID and cwd", async () => {
    const first = manager();
    restore(first);
    const id = first.spawn(pi, context(), "general-purpose", "Check", { description: "Receipt", isBackground: true });
    await first.getRecord(id)!.promise;
    const saved = first.getRecord(id)!;
    const second = manager();
    restore(second);
    const result = await second.resumePersisted(pi, context(), id, "Continue", { description: "Receipt", isBackground: false });
    expect(result?.id).toBe(id);
    expect(result?.status).toBe("completed");
    expect(runAgent).toHaveBeenLastCalledWith(expect.anything(), "general-purpose", "Continue", expect.objectContaining({ agentId: id, resumeSessionFile: saved.sessionFile, cwd: env.dir }));
  });

  it("recovers legacy completion entries through the actual get_subagent_result tool", async () => {
    const boot = makePi();
    extension(boot.pi);
    shutdown = () => boot.lifecycle.get("session_shutdown")();
    const legacy = { type: "custom", customType: "subagents:record", data: {
      id: "af6d1313-26a8-437", type: "general-purpose", description: "Receipt",
      status: "completed", result: "Recovered old result", startedAt: 1, completedAt: 2,
    } };
    const parent = context("parent-a", [legacy]);
    await boot.lifecycle.get("session_start")({}, parent);
    const result = await boot.tools.get("get_subagent_result").execute("lookup", { agent_id: legacy.data.id }, new AbortController().signal, undefined, parent);
    expect(textOf(result)).toContain("Recovered old result");
    expect(textOf(result)).not.toContain("Agent not found");
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("ignores corrupt/version-mismatched records and prevents path traversal", () => {
    const directory = join(env.dir, "parent-a.jsonl.subagents");
    mkdirSync(directory);
    writeFileSync(join(directory, "corrupt.json"), "{");
    writeFileSync(join(directory, "future.json"), JSON.stringify({ version: 2, record: {} }));
    const store = new AgentRecordStore(join(env.dir, "parent-a.jsonl"), "parent-a");
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(store.list()).toEqual([]);
    expect(store.get("../parent-b")).toBeUndefined();
    expect(() => store.save({ id: "../escape" } as AgentRecord)).toThrow("Invalid agent record ID");
    warning.mockRestore();
  });
});
