# Agent model assignments

Pi harness configuration repair; no Bufly product change.

- Resolve agent frontmatter aliases through `agentModels` in global and project settings.json. Merge per key, with project values authoritative.
- Parse `provider/model:thinking`; the assignment's thinking suffix overrides the agent file's thinking value.
- Agents with no model, or `model: inherit`, use their named assignment and then `agentModels.default`. Embedded defaults follow the same rule when enabled.
- Direct model declarations remain direct when not aliases. Ordinary deployments without `agentModels` keep their existing behavior.
- Settings assignments require the exact available provider/model. No silent fallback to the parent or another provider when the assignment cannot resolve.
- Apply the same resolved agent configuration to foreground/background, nested delegation, RPC, scheduled runs, and saved-session reopening.
- Do not edit the user's settings or switch models of already-running agents.
