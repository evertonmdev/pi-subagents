import { expect, test } from "vitest";
import { describeAgentProgress } from "../src/agent-progress.js";
import type { AgentRecord } from "../src/types.js";

test("inspection returns original assignment and bounded live activity without changing the record", () => {
  const messages = [
    { role: "user", content: [{ type: "text", text: "Older inherited context" }] },
    { role: "assistant", content: [{ type: "toolCall", name: "read" }] },
    { role: "toolResult", toolName: "read", content: [{ type: "text", text: "source" }] },
    { role: "assistant", content: [{ type: "text", text: "Investigating route X" }] },
  ];
  const record = { status: "running", description: "Investigate", taskPrompt: "Find the cause in route X", session: { messages } };
  const output = describeAgentProgress(record as unknown as AgentRecord);
  expect(output).toContain("Original assignment: Find the cause in route X");
  expect(output).toContain("Tool called: read");
  expect(output).toContain("Agent: Investigating route X");
  expect(record.session.messages).toBe(messages);
  expect(record.status).toBe("running");
});

test("queued agent reports its task without inventing session activity", () => {
  const output = describeAgentProgress({ status: "queued", description: "Short label", taskPrompt: "Exact queued order" } as AgentRecord);
  expect(output).toContain("Exact queued order");
  expect(output).toContain("no session events yet");
});
