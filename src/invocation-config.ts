import { readAgentModels, resolveModelCodename } from "./agent-model-settings.js";
import type { AgentConfig, IsolationMode, JoinMode, ThinkingLevel } from "./types.js";

interface AgentInvocationParams {
  model?: string;
  thinking?: string;
  max_turns?: number;
  run_in_background?: boolean;
  inherit_context?: boolean;
  isolated?: boolean;
  isolation?: IsolationMode;
}

export function resolveAgentInvocationConfig(
  agentConfig: AgentConfig | undefined,
  params: AgentInvocationParams,
  cwd?: string,
): {
  modelInput?: string;
  modelFromParams: boolean;
  modelFromSettings: boolean;
  thinking?: ThinkingLevel;
  maxTurns?: number;
  inheritContext: boolean;
  runInBackground: boolean;
  isolated: boolean;
  isolation?: IsolationMode;
} {
  let modelInput = agentConfig?.model ?? params.model;
  const modelFromParams = agentConfig?.model == null && params.model != null;
  let modelFromSettings = agentConfig?.modelFromSettings ?? false;
  let thinking = (agentConfig?.thinking ?? params.thinking) as ThinkingLevel | undefined;

  if (cwd && modelInput) {
    try {
      const models = readAgentModels(cwd);
      const resolvedCodename = resolveModelCodename(modelInput, models);
      if (resolvedCodename) {
        modelInput = resolvedCodename.model;
        if (resolvedCodename.thinking && (!params.thinking || !modelFromParams)) {
          thinking = resolvedCodename.thinking;
        }
        modelFromSettings = true;
      }
    } catch {
      /* ignore read errors here; resolveModel will handle unavailable or invalid targets */
    }
  }

  return {
    modelInput,
    modelFromParams,
    modelFromSettings,
    thinking,
    maxTurns: agentConfig?.maxTurns ?? params.max_turns,
    inheritContext: agentConfig?.inheritContext ?? params.inherit_context ?? false,
    runInBackground: agentConfig?.runInBackground ?? params.run_in_background ?? false,
    isolated: agentConfig?.isolated ?? params.isolated ?? false,
    isolation: agentConfig?.isolation ?? params.isolation,
  };
}

export function resolveJoinMode(defaultJoinMode: JoinMode, runInBackground: boolean): JoinMode | undefined {
  return runInBackground ? defaultJoinMode : undefined;
}
