import type { AgentRecord, AgentTombstone } from "./types.js";

export const LIST_SUBAGENTS_TOOL = "list_subagents";

export interface AgentRosterEntry {
  id: string;
  type: string;
  handle?: string;
  alias?: string;
  description: string;
  status: string;
  resumable: boolean;
  intercom: string;
}

export function childIntercomName(input: {
  type: string;
  id: string;
  handle?: string;
  alias?: string;
}): string {
  return input.alias || input.handle || `${input.type}#${input.id.slice(0, 8)}`;
}

export function rosterEntryFromRecord(record: Pick<AgentRecord, "id" | "type" | "handle" | "alias" | "description" | "status" | "sessionFile">): AgentRosterEntry {
  return {
    id: record.id,
    type: record.type,
    handle: record.handle,
    alias: record.alias,
    description: record.description,
    status: record.status,
    resumable: Boolean(record.sessionFile) || record.status === "completed" || record.status === "steered",
    intercom: childIntercomName(record),
  };
}

export function rosterEntryFromTombstone(entry: AgentTombstone): AgentRosterEntry {
  return {
    id: entry.id,
    type: entry.type,
    handle: entry.handle,
    alias: entry.alias,
    description: entry.description,
    status: "remembered",
    resumable: true,
    intercom: childIntercomName(entry),
  };
}

export function collectAgentRoster(input: {
  records: AgentRecord[];
  tombstones?: Iterable<AgentTombstone>;
  parentAgentId?: string;
}): AgentRosterEntry[] {
  const seen = new Set<string>();
  const entries: AgentRosterEntry[] = [];
  for (const record of input.records) {
    if (input.parentAgentId) {
      if (record.parentAgentId !== input.parentAgentId) continue;
    } else if (record.parentAgentId) {
      continue;
    }
    seen.add(record.id);
    entries.push(rosterEntryFromRecord(record));
  }
  for (const tombstone of input.tombstones ?? []) {
    if (seen.has(tombstone.id)) continue;
    seen.add(tombstone.id);
    entries.push(rosterEntryFromTombstone(tombstone));
  }
  return entries;
}

export function formatAgentRoster(entries: AgentRosterEntry[]): string {
  if (entries.length === 0) {
    return [
      "No subagents in this session.",
      "Spawn with Agent and set `name` when you expect to reuse the writer.",
    ].join("\n");
  }
  const lines = [
    "Agent roster (labels only; no conversation dump).",
    "Before spawning the same type for related work, resume with Agent({ resume: \"<id>\" }).",
    "Set `name` on writers you expect to reuse. Use steer_subagent while status=running.",
    "",
  ];
  for (const entry of entries) {
    const parts = [
      `id=${entry.id}`,
      `type=${entry.type}`,
      entry.handle ? `handle=${entry.handle}` : undefined,
      entry.alias ? `alias=${entry.alias}` : undefined,
      `description=${JSON.stringify(entry.description)}`,
      `status=${entry.status}`,
      `resumable=${entry.resumable}`,
      `intercom=${entry.intercom}`,
    ].filter((part): part is string => Boolean(part));
    lines.push(parts.join(" "));
  }
  return lines.join("\n");
}

export function formatIntercomDirectory(input: {
  self?: string;
  supervisor?: string;
  peers: Array<{ type: string; intercom: string; description: string; status: string }>;
}): string {
  const lines = ["<intercom_directory>"];
  if (input.self) lines.push(`You: intercom to="${input.self}"`);
  if (input.supervisor) {
    lines.push(`Supervisor: intercom to="${input.supervisor}" — action=ask for product/scope/API decisions; action=send for plan-changing progress.`);
  } else {
    lines.push("Supervisor: run intercom({ action: \"list\" }) and message the parent session in this cwd.");
  }
  const live = input.peers.filter((peer) => peer.status === "running" || peer.status === "queued");
  if (live.length === 0) {
    lines.push("Live peers: none. Do not message completed agents; the supervisor resumes them.");
  } else {
    lines.push("Live peers (facts about their workspace only; do not assign them work):");
    for (const peer of live) {
      lines.push(`- ${peer.type} | to="${peer.intercom}" | ${peer.description} | ${peer.status}`);
    }
  }
  lines.push("</intercom_directory>");
  return lines.join("\n");
}
