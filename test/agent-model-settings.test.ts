import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAgentModelSettings, readAgentModels } from "../src/agent-model-settings.js";
import { runAgent } from "../src/agent-runner.js";
import { loadCustomAgents } from "../src/custom-agents.js";
import extension from "../src/index.js";
import { resolveModel } from "../src/model-resolver.js";
import { ctx, hermeticDir, makePi, textOf } from "./helpers/boot-extension.js";

vi.mock("../src/agent-runner.js", async importOriginal => ({
  ...await importOriginal<typeof import("../src/agent-runner.js")>(), runAgent: vi.fn(),
}));

let env: ReturnType<typeof hermeticDir>;
let shutdown: (() => Promise<void>) | undefined;
const grok = { id: "grok-4.6", name: "Grok 4.6", provider: "xai" };
const astra = { id: "gpt-6-astra", name: "GPT-6 Astra", provider: "openai-codex" };

function settings(models: Record<string, string>, global = false) {
  const path = global ? getAgentDir() : join(env.dir, ".pi");
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "settings.json"), JSON.stringify({ agentModels: models }));
}

beforeEach(() => {
  env = hermeticDir({ settings: { scheduling: false }, agentFiles: {
    backend: "---\nname: backend\nmodel: backend\nthinking: high\n---\nImplement backend changes.",
    frontend: "---\nname: frontend\nmodel: frontend\nthinking: high\n---\nImplement frontend changes.",
    "code-reviewer": "---\nname: code-reviewer\nmodel: code-reviewer\n---\nReview code.",
    unmapped: "---\nname: unmapped\n---\nUse the configured default.",
  } });
});

afterEach(async () => {
  await shutdown?.(); shutdown = undefined;
  env.restore(); vi.clearAllMocks();
});

describe("settings.json agentModels", () => {
  it("resolves role aliases and thinking suffixes with per-key project precedence", () => {
    settings({ backend: "openai-codex/gpt-6-astra:low", "code-reviewer": "openai-codex/gpt-6-astra:high" }, true);
    settings({ backend: "xai/grok-4.6:xhigh", frontend: "xai/grok-4.6:medium", default: "xai/grok-4.6:low" });
    const agents = loadCustomAgents(env.dir);
    expect(agents.get("backend")).toMatchObject({ model: "xai/grok-4.6", thinking: "xhigh", modelFromSettings: true });
    expect(agents.get("frontend")).toMatchObject({ model: "xai/grok-4.6", thinking: "medium" });
    expect(agents.get("code-reviewer")?.model).toBe("openai-codex/gpt-6-astra");
    expect(agents.get("unmapped")?.model).toBe("xai/grok-4.6");
    expect(agents.get("general-purpose")?.model).toBe("xai/grok-4.6");
    // No cache may pin an earlier assignment across launches.
    settings({ backend: "xai/grok-4.6:medium" });
    expect(loadCustomAgents(env.dir).get("backend")?.thinking).toBe("medium");
  });

  it("leaves direct declarations alone and rejects provider substitution", () => {
    const config = loadCustomAgents(env.dir).get("backend")!;
    config.model = "openai-codex/gpt-6-astra";
    applyAgentModelSettings(config, { default: "xai/grok-4.6:high" });
    expect(config.model).toBe("openai-codex/gpt-6-astra");
    const otherProvider = { ...grok, provider: "other" };
    const registry = { getAvailable: () => [otherProvider], getAll: () => [otherProvider], find: () => otherProvider };
    expect(resolveModel("xai/grok-4.6", registry, true)).toContain("unavailable");
  });

  it("dispatches backend on Grok even when the parent and tool parameter select Astra", async () => {
    settings({ backend: "xai/grok-4.6:high" });
    const boot = makePi(); extension(boot.pi);
    shutdown = () => boot.lifecycle.get("session_shutdown")();
    vi.mocked(runAgent).mockResolvedValue({ responseText: "done", aborted: false, steered: false, session: { dispose() {} } as never });
    const registry = { getAvailable: () => [grok, astra], getAll: () => [grok, astra], find: (provider: string, id: string) => [grok, astra].find(m => m.provider === provider && m.id === id) };
    await boot.tools.get("Agent").execute("call", { subagent_type: "backend", description: "Code", prompt: "Implement", model: "openai-codex/gpt-6-astra" }, undefined, undefined, ctx({ model: astra, modelRegistry: registry }));
    expect(runAgent).toHaveBeenCalledWith(expect.anything(), "backend", "Implement", expect.objectContaining({ model: grok, thinkingLevel: "high" }));
  });

  it("fails without spawning when the configured model is unavailable", async () => {
    settings({ backend: "xai/grok-4.6:high" });
    const boot = makePi(); extension(boot.pi);
    shutdown = () => boot.lifecycle.get("session_shutdown")();
    const registry = { getAvailable: () => [astra], getAll: () => [astra], find: () => astra };
    const result = await boot.tools.get("Agent").execute("call", { subagent_type: "backend", description: "Code", prompt: "Implement" }, undefined, undefined, ctx({ model: astra, modelRegistry: registry }));
    expect(textOf(result)).toContain("Configured model is unavailable");
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("rejects invalid assignments without silently inheriting the parent", () => {
    writeFileSync(join(env.dir, ".pi", "settings.json"), JSON.stringify({ agentModels: { backend: null } }));
    expect(() => readAgentModels(env.dir)).toThrow("Invalid agentModels.backend");
  });

  it("reads and resolves agentModels from .pi/harness/codename-models.json with highest precedence", () => {
    settings({ backend: "xai/grok-4.6:low", frontend: "xai/grok-4.6:low" });
    const harnessDir = join(env.dir, ".pi", "harness");
    mkdirSync(harnessDir, { recursive: true });
    writeFileSync(join(harnessDir, "codename-models.json"), JSON.stringify({
      agentModels: {
        backend: "openai-codex/gpt-6-astra:high",
        quick: "openai-codex/gpt-6-astra:medium",
      },
    }));

    const models = readAgentModels(env.dir);
    expect(models.backend).toBe("openai-codex/gpt-6-astra:high");
    expect(models.frontend).toBe("xai/grok-4.6:low");
    expect(models.quick).toBe("openai-codex/gpt-6-astra:medium");

    const agents = loadCustomAgents(env.dir);
    expect(agents.get("backend")).toMatchObject({ model: "openai-codex/gpt-6-astra", thinking: "high", modelFromSettings: true });
  });

  it("supports thinking override in model alias (e.g. quick:xhigh)", () => {
    const config = { name: "my-worker", model: "quick:xhigh" };
    applyAgentModelSettings(config, { quick: "openai-codex/gpt-6-astra:medium" });
    expect(config.model).toBe("openai-codex/gpt-6-astra");
    expect(config.thinking).toBe("xhigh");
    expect(config.modelFromSettings).toBe(true);
  });

  it("dispatches subagent when model is a codename via Agent({ model: 'quick' })", async () => {
    const harnessDir = join(env.dir, ".pi", "harness");
    mkdirSync(harnessDir, { recursive: true });
    writeFileSync(join(harnessDir, "codename-models.json"), JSON.stringify({
      agentModels: {
        quick: "xai/grok-4.6:low",
      },
    }));

    const boot = makePi(); extension(boot.pi);
    shutdown = () => boot.lifecycle.get("session_shutdown")();
    vi.mocked(runAgent).mockResolvedValue({ responseText: "done", aborted: false, steered: false, session: { dispose() {} } as never });
    const registry = {
      getAvailable: () => [grok, astra],
      getAll: () => [grok, astra],
      find: (provider: string, id: string) => [grok, astra].find(m => m.provider === provider && m.id === id),
    };

    await boot.tools.get("Agent").execute(
      "call",
      { subagent_type: "unmapped", description: "Quick task", prompt: "Run quick", model: "quick" },
      undefined,
      undefined,
      ctx({ model: astra, modelRegistry: registry, cwd: env.dir }),
    );

    expect(runAgent).toHaveBeenCalledWith(
      expect.anything(),
      "unmapped",
      "Run quick",
      expect.objectContaining({ model: grok, thinkingLevel: "low" }),
    );
  });
});
