/** Resolve project/global settings.json and .pi/harness/codename-models.json agentModels aliases before dispatch. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { AgentConfig, ThinkingLevel } from "./types.js";

export function readAgentModels(cwd: string): Record<string, string> {
  const models: Record<string, string> = Object.create(null);
  const paths: string[] = [];

  if (process.env.HARNESS_CODENAME_MODELS) {
    paths.push(process.env.HARNESS_CODENAME_MODELS);
  }

  paths.push(join(getAgentDir(), "settings.json"));
  paths.push(join(cwd, ".pi", "settings.json"));

  if (process.env.HARNESS_PROJECT_ROOT && process.env.HARNESS_PROJECT_ROOT !== cwd) {
    paths.push(join(process.env.HARNESS_PROJECT_ROOT, ".pi", "settings.json"));
  }

  paths.push(join(cwd, ".pi", "harness", "codename-models.json"));

  if (process.env.HARNESS_PROJECT_ROOT && process.env.HARNESS_PROJECT_ROOT !== cwd) {
    paths.push(join(process.env.HARNESS_PROJECT_ROOT, ".pi", "harness", "codename-models.json"));
  }

  for (const path of paths) {
    let settings: unknown;
    try {
      settings = JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`Cannot read agentModels from ${path}; refusing to inherit another model.`);
    }
    if (!settings || typeof settings !== "object") continue;
    let assignments: unknown;
    if ("agentModels" in settings) {
      assignments = (settings as { agentModels: unknown }).agentModels;
    } else if (!("enabledModels" in settings) && !Array.isArray(settings)) {
      assignments = settings;
    }
    if (!assignments) continue;
    if (typeof assignments !== "object" || Array.isArray(assignments)) {
      throw new Error(`Invalid agentModels in ${path}`);
    }
    for (const [key, value] of Object.entries(assignments)) {
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Invalid agentModels.${key} in ${path}`);
      }
      models[key] = value.trim();
    }
  }
  return models;
}

export function resolveModelCodename(
  input: string,
  models: Record<string, string>,
): { model: string; thinking?: ThinkingLevel; fromSettings: boolean } | undefined {
  if (!input || typeof input !== "string") return undefined;
  let alias = input.trim();
  let overrideThinking: ThinkingLevel | undefined;
  const match = /^(.*?):(off|minimal|low|medium|high|xhigh)$/.exec(alias);
  if (match) {
    alias = match[1];
    overrideThinking = match[2] as ThinkingLevel;
  }
  const assignment = models[alias];
  if (!assignment) return undefined;
  const assignMatch = /^(.*):(off|minimal|low|medium|high|xhigh)$/.exec(assignment);
  const concreteModel = assignMatch ? assignMatch[1] : assignment;
  const defaultThinking = assignMatch ? (assignMatch[2] as ThinkingLevel) : undefined;
  if (!concreteModel.includes("/")) {
    throw new Error(`agentModels.${alias} must specify provider/model, optionally followed by :thinking.`);
  }
  return {
    model: concreteModel,
    thinking: overrideThinking ?? defaultThinking,
    fromSettings: true,
  };
}

export function applyAgentModelSettings(config: AgentConfig, models: Record<string, string>): void {
  let alias = config.model && config.model !== "inherit" ? config.model : config.name;
  let overrideThinking: ThinkingLevel | undefined;
  if (alias) {
    const match = /^(.*?):(off|minimal|low|medium|high|xhigh)$/.exec(alias);
    if (match) {
      alias = match[1];
      overrideThinking = match[2] as ThinkingLevel;
    }
  }
  const assignment = models[alias] ?? (!config.model || config.model === "inherit" ? models.default : undefined);
  if (!assignment) return;
  const match = /^(.*):(off|minimal|low|medium|high|xhigh)$/.exec(assignment);
  config.model = match ? match[1] : assignment;
  if (!config.model.includes("/")) throw new Error(`agentModels.${alias} must specify provider/model, optionally followed by :thinking.`);
  config.thinking = overrideThinking ?? (match ? (match[2] as ThinkingLevel) : undefined) ?? config.thinking;
  config.modelFromSettings = true;
}
