import { type AgentSession, initTheme } from "@earendil-works/pi-coding-agent";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { AgentRecord } from "../src/types.js";
import { getAgentRuntime } from "../src/ui/agent-widget.js";
import { ConversationViewer } from "../src/ui/conversation-viewer.js";

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };

function fixture() {
  initTheme("dark", false);
  const session = {
    model: { id: "gpt-6-astra" },
    thinkingLevel: "high",
    messages: [
      { role: "assistant", content: [
        { type: "thinking", thinking: "Check the receipt identity first." },
        { type: "text", text: "**Checking** local evidence." },
        { type: "toolCall", id: "call-1", name: "read", arguments: { path: "receipt.ts" } },
      ] },
      { role: "toolResult", toolName: "read", toolCallId: "call-1", isError: true,
        content: [{ type: "text", text: Array.from({ length: 20 }, (_, i) => `evidence ${i}`).join("\n") }] },
      { role: "assistant", content: [{ type: "text", text: "The receipt is **inconclusive**." }] },
    ],
    subscribe: () => () => {},
  } as unknown as AgentSession;
  const record = {
    id: "probe", type: "general-purpose", description: "Verify evidence", status: "completed",
    startedAt: 1, completedAt: 2, toolUses: 1, session,
  } as AgentRecord;
  const tui = { terminal: { rows: 80, columns: 120 }, requestRender: vi.fn() } as unknown as TUI;
  return { session, record, tui, viewer: new ConversationViewer(tui, session, record, undefined, theme, vi.fn()) };
}

describe("agent runtime and transcript readability", () => {
  it("shows inherited runtime and tracks effective model changes", () => {
    const { record, session } = fixture();
    expect(getAgentRuntime(record)).toBe("model: gpt-6-astra · thinking: high");
    Object.defineProperty(session, "model", { value: { id: "gpt-5.6-sol" } });
    expect(getAgentRuntime(record)).toContain("gpt-5.6-sol");
    expect(getAgentRuntime({})).toBe("model: unavailable");
    expect(getAgentRuntime({ invocation: { modelName: "sonnet" } as AgentRecord["invocation"] })).toBe("model: sonnet (configured)");
  });

  it("preserves block order, identifies tool errors, and expands complete results", () => {
    const { viewer } = fixture();
    const collapsed = viewer.render(120).join("\n");
    expect(collapsed).toContain("model: gpt-6-astra");
    expect(collapsed).toContain("Thinking");
    expect(collapsed.indexOf("Thinking")).toBeLessThan(collapsed.indexOf("Response"));
    expect(collapsed.indexOf("Response")).toBeLessThan(collapsed.indexOf("Tool call"));
    expect(collapsed).toContain("Tool result · read · ERROR · call-1");
    expect(collapsed).not.toContain("evidence 19");
    expect(collapsed).toContain("inconclusive");
    expect(collapsed).not.toContain("**inconclusive**");
    viewer.handleInput("t");
    expect(viewer.render(120).join("\n")).toContain("evidence 19");
    viewer.handleInput("t");
    expect(viewer.render(120).join("\n")).not.toContain("evidence 19");
    viewer.dispose();
  });

  it("fits normal and narrow terminal dimensions with tool controls visible", () => {
    const { viewer, tui } = fixture();
    for (const [columns, rows] of [[180, 48], [60, 28]]) {
      Object.assign(tui.terminal, { columns, rows });
      const lines = viewer.render(columns);
      expect(lines.length).toBeLessThanOrEqual(Math.floor(rows * 0.7));
      expect(lines.join("\n")).toContain("t expand tools");
      expect(lines.join("\n")).toContain("Esc close");
      for (const line of lines) expect(visibleWidth(line)).toBeLessThanOrEqual(columns);
    }
    viewer.dispose();
  });
});
