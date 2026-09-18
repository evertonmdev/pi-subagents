import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  installExtensionToolScope,
  resolveToolRoutingExtension,
  runAgent,
} from "../src/agent-runner.js";
import { getChildSessionInfo, inChildSessionContext, runInChildSessionContext } from "../src/child-context.js";
import { registerAgents } from "../src/agent-types.js";

const {
  createAgentSession,
  defaultResourceLoaderCtor,
  loaderExtensionsRef,
} = vi.hoisted(() => ({
  createAgentSession: vi.fn(),
  defaultResourceLoaderCtor: vi.fn(),
  loaderExtensionsRef: {
    current: { extensions: [], errors: [], runtime: {} } as {
      extensions: Array<{ path: string; tools: Map<string, unknown> }>;
      errors: Array<{ path: string; error: string }>;
      runtime: Record<string, unknown>;
    },
  },
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession,
  DefaultResourceLoader: class {
    opts: any;
    constructor(options: any) {
      this.opts = options;
      defaultResourceLoaderCtor(options);
    }

    async reload() {
      if (this.opts.noExtensions) {
        loaderExtensionsRef.current = { extensions: [], errors: [], runtime: {} };
        return;
      }
      if (this.opts.extensionsOverride) {
        loaderExtensionsRef.current = this.opts.extensionsOverride(loaderExtensionsRef.current);
      }
    }

    getExtensions() {
      return loaderExtensionsRef.current;
    }
  },
  getAgentDir: () => "/mock/agent-dir",
  createCodingTools: () => [{ name: "read" }, { name: "write" }, { name: "bash" }, { name: "edit" }],
  createReadOnlyTools: () => [{ name: "read" }, { name: "grep" }, { name: "find" }, { name: "ls" }],
  SessionManager: {
    inMemory: () => ({ kind: "memory-session-manager" }),
    create: () => ({ kind: "persistent-session-manager" }),
    open: () => ({ kind: "reopened-session-manager" }),
  },
  SettingsManager: {
    create: () => ({ kind: "settings-manager", getSessionDir: () => undefined }),
  },
}));

describe("subagent tool routing resolution and inheritance", () => {
  let tmp: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "subagent-routing-"));
    loaderExtensionsRef.current = { extensions: [], errors: [], runtime: {} };
    defaultResourceLoaderCtor.mockClear();
    createAgentSession.mockReset();
    createAgentSession.mockResolvedValue({
      session: {
        messages: [],
        getActiveToolNames: () => ["read", "write"],
        getAllTools: () => [{ name: "read" }, { name: "write" }, { name: "bash" }],
        setActiveToolsByName: vi.fn(),
        subscribe: vi.fn(() => () => {}),
        bindExtensions: vi.fn(async () => {}),
        setSessionName: vi.fn(),
        agent: { beforeToolCall: undefined },
        prompt: vi.fn(async () => {}),
      },
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {}
  });

  it("resolveToolRoutingExtension resolves from HARNESS_RUNTIME_MANIFEST", () => {
    const manifestDir = join(tmp, "runtime");
    const manifestPath = join(manifestDir, "runtime-manifest.json");
    const routerPath = join(manifestDir, "extensions", "tool-routing", "index.ts");
    mkdirSync(join(manifestDir, "extensions", "tool-routing"), { recursive: true });
    writeFileSync(manifestPath, "{}");
    writeFileSync(routerPath, "// router");

    process.env.HARNESS_RUNTIME_MANIFEST = manifestPath;
    expect(resolveToolRoutingExtension(tmp)).toBe(routerPath);
  });

  it("resolveToolRoutingExtension resolves from HARNESS_CORE_OVERRIDES", () => {
    const customRouter = join(tmp, "custom-router.ts");
    writeFileSync(customRouter, "// custom");
    process.env.HARNESS_CORE_OVERRIDES = JSON.stringify({ "tool-routing": `local:${customRouter}` });

    expect(resolveToolRoutingExtension(tmp)).toBe(customRouter);
  });

  it("resolveToolRoutingExtension resolves from HARNESS_PROJECT_ROOT", () => {
    const projectRoot = join(tmp, "proj");
    const routerPath = join(projectRoot, ".pi", "extensions", "tool-routing", "index.ts");
    mkdirSync(join(projectRoot, ".pi", "extensions", "tool-routing"), { recursive: true });
    writeFileSync(routerPath, "// router");

    process.env.HARNESS_PROJECT_ROOT = projectRoot;
    expect(resolveToolRoutingExtension(tmp)).toBe(routerPath);
  });

  it("runAgent injects tool-routing when running under harness", async () => {
    const routerPath = join(tmp, "router.ts");
    writeFileSync(routerPath, "// router");
    process.env.HARNESS_CORE_OVERRIDES = JSON.stringify({ "tool-routing": routerPath });

    registerAgents(
      new Map([
        [
          "frontend",
          {
            name: "frontend",
            description: "Frontend agent",
            tools: "read, write",
            extensions: true,
          },
        ],
      ])
    );

    const ctx = {
      cwd: tmp,
      getSystemPrompt: () => "system",
      model: { id: "test", provider: "test" },
      modelRegistry: { find: () => undefined },
    } as any;

    await runAgent(ctx, "frontend", "inspect frontend", {
      pi: { exec: async () => ({ code: 0, stdout: "", stderr: "" }) } as any,
      agentId: "agent-123",
    });

    const ctorArgs = defaultResourceLoaderCtor.mock.calls[0][0];
    expect(ctorArgs.additionalExtensionPaths).toContain(routerPath);
  });

  it("runAgent does NOT inject tool-routing when isolated: true", async () => {
    const routerPath = join(tmp, "router.ts");
    writeFileSync(routerPath, "// router");
    process.env.HARNESS_CORE_OVERRIDES = JSON.stringify({ "tool-routing": routerPath });

    registerAgents(
      new Map([
        [
          "isolated-agent",
          {
            name: "isolated-agent",
            description: "Isolated agent",
            builtinToolNames: ["read"],
            extensions: true,
            skills: true,
            systemPrompt: "system",
            promptMode: "replace",
          },
        ],
      ])
    );

    const ctx = {
      cwd: tmp,
      getSystemPrompt: () => "system",
      model: { id: "test", provider: "test" },
      modelRegistry: { find: () => undefined },
    } as any;

    await runAgent(ctx, "isolated-agent", "run isolated", {
      pi: { exec: async () => ({ code: 0, stdout: "", stderr: "" }) } as any,
      agentId: "agent-456",
      isolated: true,
    });

    const ctorArgs = defaultResourceLoaderCtor.mock.calls[0][0];
    expect(ctorArgs.noExtensions).toBe(true);
    expect(ctorArgs.additionalExtensionPaths).toBeUndefined();
  });

  it("runAgent does NOT inject tool-routing when exclude_extensions includes tool-routing", async () => {
    const routerPath = join(tmp, "router.ts");
    writeFileSync(routerPath, "// router");
    process.env.HARNESS_CORE_OVERRIDES = JSON.stringify({ "tool-routing": routerPath });

    registerAgents(
      new Map([
        [
          "no-router-agent",
          {
            name: "no-router-agent",
            description: "Agent excluding router",
            builtinToolNames: ["read", "write"],
            extensions: true,
            excludeExtensions: ["tool-routing"],
            skills: true,
            systemPrompt: "system",
            promptMode: "replace",
          },
        ],
      ])
    );

    const ctx = {
      cwd: tmp,
      getSystemPrompt: () => "system",
      model: { id: "test", provider: "test" },
      modelRegistry: { find: () => undefined },
    } as any;

    await runAgent(ctx, "no-router-agent", "run without router", {
      pi: { exec: async () => ({ code: 0, stdout: "", stderr: "" }) } as any,
      agentId: "agent-789",
    });

    const ctorArgs = defaultResourceLoaderCtor.mock.calls[0][0];
    expect(ctorArgs.additionalExtensionPaths).toBeUndefined();
  });
});

describe("installExtensionToolScope coordination with tool-routing", () => {
  it("initial renarrow sets all allowed tools, and turn_end preserves router narrowing", () => {
    let activeTools = ["read", "write", "bash"];
    let turnEndCallback: ((event: any) => void) | undefined;

    const session: any = {
      getActiveToolNames: () => activeTools,
      getAllTools: () => [{ name: "read" }, { name: "write" }, { name: "bash" }],
      setActiveToolsByName: vi.fn((names: string[]) => {
        activeTools = names;
      }),
      subscribe: vi.fn((cb: (event: any) => void) => {
        turnEndCallback = cb;
        return () => {};
      }),
      agent: {},
    };

    const loader: any = {
      getExtensions: () => ({
        extensions: [
          {
            path: "/path/to/extensions/tool-routing/index.ts",
            tools: new Map(),
          },
        ],
      }),
    };

    // Agent has read and write, but disallowed bash
    installExtensionToolScope(session, {
      loader,
      toolNames: ["read", "write"],
      disallowedSet: new Set(["bash"]),
      extNames: new Set(),
      narrowing: new Map(),
      nestedToolNames: new Set(),
    });

    // 1. Initial renarrow activated allowed tools ['read', 'write']
    expect(session.setActiveToolsByName).toHaveBeenCalledWith(["read", "write"]);
    expect(activeTools).toEqual(["read", "write"]);

    // 2. Simulate Jev router narrowing the active tools to just ['read']
    activeTools = ["read"];

    // 3. Fire turn_end
    session.setActiveToolsByName.mockClear();
    turnEndCallback?.({ type: "turn_end" });

    // Because ['read'] is a valid subset of allowed ['read', 'write'],
    // renarrow must NOT overwrite ['read'] back to ['read', 'write']!
    expect(session.setActiveToolsByName).not.toHaveBeenCalled();
    expect(activeTools).toEqual(["read"]);

    // 4. If an unallowed tool somehow leaks into active tools (e.g. bash)
    activeTools = ["read", "bash"];
    turnEndCallback?.({ type: "turn_end" });

    // renarrow intervenes and removes bash, leaving ['read']
    expect(session.setActiveToolsByName).toHaveBeenCalledWith(["read"]);
  });
});

describe("child session context metadata", () => {
  it("getChildSessionInfo exposes agentId and type during child execution", async () => {
    expect(inChildSessionContext()).toBe(false);
    expect(getChildSessionInfo()).toBeUndefined();

    await runInChildSessionContext({ isChild: true, agentId: "agent-run-1", type: "frontend" }, async () => {
      expect(inChildSessionContext()).toBe(true);
      const info = getChildSessionInfo();
      expect(info?.agentId).toBe("agent-run-1");
      expect(info?.type).toBe("frontend");
    });

    expect(inChildSessionContext()).toBe(false);
    expect(getChildSessionInfo()).toBeUndefined();
  });
});
