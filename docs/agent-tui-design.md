# Agent inspection UI contract

This change is confined to the Pi harness; it does not change Bufly product behavior.

- Agent selectors and widgets identify the effective session model, including inherited models. Invocation metadata is a fallback; missing runtime data is labelled unavailable rather than guessed.
- Model information precedes the task description so long descriptions cannot hide it.
- The conversation header keeps model and thinking level visible independently of the task title.
- Transcript sections preserve message/block order and distinguish User, Thinking, Response, Tool call, and Tool result. Tool results identify the tool and success/error state.
- Responses render Markdown using Pi's theme. Thinking and tool output use separate labelled sections with spacing, without nested panels.
- Tool arguments and results show short previews by default; `t` expands or collapses their full content. No full-content truncation when expanded.
- Existing scroll, stop confirmation, steering, and close controls remain available. Narrow widths must not overflow.
- Validate focused rendering and keyboard behavior, full package checks, and a standalone terminal fixture at normal and narrow dimensions. Do not reload active user sessions.
