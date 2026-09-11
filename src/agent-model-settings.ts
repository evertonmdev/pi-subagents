/** Resolve project/global settings.json agentModels aliases before dispatch. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AgentConfig, ThinkingLevel } from "./types.js";

export function readAgentModels(cwd: string): Record<string, string> {
  const models: Record<string, string> = Object.create(null);
  for (const path of [join(getAgentDir(), "settings.json"), join(cwd, ".pi", "settings.json")]) {
    let settings: unknown;
    try { settings = JSON.parse(readFileSync(path, "utf8")); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`Cannot read agentModels from ${path}; refusing to inherit another model.`);
    }
    if (!settings || typeof settings !== "object" || !("agentModels" in settings)) continue;
    const assignments = settings.agentModels;
    if (!assignments || typeof assignments !== "object" || Array.isArray(assignments)) throw new Error(`Invalid agentModels in ${path}`);
    for (const [key, value] of Object.entries(assignments)) {
      if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid agentModels.${key} in ${path}`);
      models[key] = value.trim();
    }
  }
  return models;
}

export function applyAgentModelSettings(config: AgentConfig, models: Record<string, string>): void {
  const alias = config.model && config.model !== "inherit" ? config.model : config.name;
  const assignment = models[alias] ?? (!config.model || config.model === "inherit" ? models.default : undefined);
  if (!assignment) return;
  const match = /^(.*):(off|minimal|low|medium|high|xhigh)$/.exec(assignment);
  config.model = match ? match[1] : assignment;
  if (!config.model.includes("/")) throw new Error(`agentModels.${alias} must specify provider/model, optionally followed by :thinking.`);
  if (match) config.thinking = match[2] as ThinkingLevel;
  config.modelFromSettings = true;
}
