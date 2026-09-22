import type { AgentRecord } from "./types.js";

const clip = (value: string, limit: number) => value.length > limit ? `${value.slice(0, limit)}…` : value;
const messageText = (message: unknown): string => {
  if (!message || typeof message !== "object" || !("content" in message)) return "";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part?.type === "text")
    .map((part) => String(part.text ?? ""))
    .join("\n");
};

/** Bounded, read-only observation of a live child. No wait and no result consumption. */
export function describeAgentProgress(record: AgentRecord): string {
  const messages = record.session?.messages ?? [];
  const firstUser = messages.find((message) => message?.role === "user");
  const original = record.taskPrompt ?? (firstUser ? messageText(firstUser) : "");
  const assignment = original || record.description;
  const label = record.taskPrompt ? "Original assignment" : original ? "Recorded user request" : "Task summary (full assignment unavailable)";
  const lines = [`${label}: ${clip(assignment, 1800)}`];
  if (!record.session) {
    lines.push(record.status === "queued" ? "Waiting for an execution slot; no session events yet." : "Live session unavailable.");
    return lines.join("\n");
  }
  const recent: string[] = [];
  for (const message of messages.slice(-18)) {
    if (message?.role === "user") {
      const text = messageText(message);
      if (text) recent.push(`Guidance: ${clip(text, 500)}`);
    } else if (message?.role === "assistant") {
      for (const part of Array.isArray(message.content) ? message.content : []) {
        if (part?.type === "text" && part.text) recent.push(`Agent: ${clip(String(part.text), 650)}`);
        if (part?.type === "toolCall") recent.push(`Tool called: ${clip(String(part.name ?? "unknown"), 120)}`);
      }
    } else if (message?.role === "toolResult") {
      recent.push(`Tool result (${clip(String(message.toolName ?? "tool"), 80)}): ${clip(messageText(message), 260)}`);
    }
  }
  lines.push("Recent session activity:", ...(recent.slice(-8).length ? recent.slice(-8) : ["No messages yet."]));
  return lines.join("\n");
}
