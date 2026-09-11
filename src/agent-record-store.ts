/** Durable agent identities/results beside the owning Pi session, never in the repository. */
import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRecord } from "./types.js";

const statuses = new Set(["queued", "running", "completed", "steered", "aborted", "stopped", "error"]);

/** Explicit projection: never restore sessions, promises, controllers or executable callbacks. */
export function decodeAgentRecord(value: unknown, sessionId: string): AgentRecord | undefined {
  if (!value || typeof value !== "object") return undefined;
  const data = value as Record<string, unknown>;
  if (typeof data.id !== "string" || !/^[a-zA-Z0-9-]+$/.test(data.id)
    || typeof data.type !== "string" || typeof data.description !== "string"
    || typeof data.status !== "string" || !statuses.has(data.status)
    || typeof data.startedAt !== "number" || !Number.isFinite(data.startedAt)
    || (data.rootSessionId !== undefined && data.rootSessionId !== sessionId)) return undefined;
  const record: AgentRecord = {
    id: data.id, type: data.type, description: data.description,
    status: data.status as AgentRecord["status"], startedAt: data.startedAt,
    toolUses: typeof data.toolUses === "number" ? data.toolUses : 0,
    compactionCount: typeof data.compactionCount === "number" ? data.compactionCount : 0,
    lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 },
    rootSessionId: sessionId,
  };
  for (const key of ["handle", "alias", "result", "error", "sessionFile", "outputFile", "executionCwd", "parentAgentId"] as const) {
    if (typeof data[key] === "string") record[key] = data[key];
  }
  if (typeof data.completedAt === "number") record.completedAt = data.completedAt;
  if (typeof data.isBackground === "boolean") record.isBackground = data.isBackground;
  if (typeof data.resultConsumed === "boolean") record.resultConsumed = data.resultConsumed;
  if (typeof data.depth === "number") record.depth = data.depth;
  if (typeof data.maxSubagentDepth === "number") record.maxSubagentDepth = data.maxSubagentDepth;
  if (data.lifetimeUsage && typeof data.lifetimeUsage === "object") {
    const usage = data.lifetimeUsage as Record<string, unknown>;
    for (const key of ["input", "output", "cacheWrite"] as const) {
      if (typeof usage[key] === "number" && Number.isFinite(usage[key])) record.lifetimeUsage[key] = usage[key];
    }
  }
  if (typeof data.modelName === "string") record.invocation = { modelName: data.modelName };
  if (data.invocation && typeof data.invocation === "object") {
    const invocation = data.invocation as Record<string, unknown>;
    record.invocation ??= {};
    for (const key of ["isolated", "inheritContext", "runInBackground"] as const) {
      if (typeof invocation[key] === "boolean") record.invocation[key] = invocation[key];
    }
    if (typeof invocation.maxTurns === "number") record.invocation.maxTurns = invocation.maxTurns;
    if (invocation.isolation === "worktree") record.invocation.isolation = "worktree";
    if (typeof invocation.thinking === "string" && ["off", "minimal", "low", "medium", "high", "xhigh"].includes(invocation.thinking)) {
      record.invocation.thinking = invocation.thinking as NonNullable<AgentRecord["invocation"]>["thinking"];
    }
  }
  return record;
}

export class AgentRecordStore {
  private directory: string;

  constructor(sessionFile: string, readonly sessionId: string) {
    this.directory = `${sessionFile}.subagents`;
  }

  save(record: AgentRecord): void {
    if (!/^[a-zA-Z0-9-]+$/.test(record.id)) throw new Error("Invalid agent record ID");
    const data = {
      id: record.id, type: record.type, description: record.description,
      handle: record.handle, alias: record.alias, status: record.status,
      result: record.result, error: record.error, startedAt: record.startedAt,
      completedAt: record.completedAt, resultConsumed: record.resultConsumed,
      toolUses: record.toolUses, lifetimeUsage: record.lifetimeUsage,
      compactionCount: record.compactionCount, isBackground: record.isBackground,
      sessionFile: record.sessionFile, outputFile: record.outputFile,
      executionCwd: record.executionCwd, rootSessionId: this.sessionId,
      parentAgentId: record.parentAgentId, depth: record.depth, maxSubagentDepth: record.maxSubagentDepth,
      modelName: record.session?.model?.id ?? record.invocation?.modelName,
      invocation: record.invocation,
    };
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const target = join(this.directory, `${record.id}.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify({ version: 1, record: data }), { mode: 0o600, flag: "wx" });
      renameSync(temporary, target);
    } finally {
      try { unlinkSync(temporary); } catch { /* already renamed, or never created */ }
    }
  }

  get(id: string): AgentRecord | undefined {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) return undefined;
    try {
      const data = JSON.parse(readFileSync(join(this.directory, `${id}.json`), "utf8"));
      if (data.version !== 1) return undefined;
      const record = decodeAgentRecord(data.record, this.sessionId);
      return record?.id === id ? record : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error(`[subagents] Could not read saved agent ${id}.`);
      return undefined;
    }
  }

  list(): AgentRecord[] {
    let names: string[];
    try { names = readdirSync(this.directory); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.error("[subagents] Could not read saved agent registry.");
      return [];
    }
    return names.filter(name => name.endsWith(".json"))
      .flatMap(name => this.get(name.slice(0, -5)) ?? []);
  }
}
