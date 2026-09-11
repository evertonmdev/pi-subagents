# Persistent agent identity

Pi harness repair; no Bufly product/API/schema change.

- Agent IDs, names, results, status and transcript references belong to the parent Pi session. Reopening that session restores them; a different session must not expose them.
- Save explicit data snapshots at spawn, session creation, completed tools, completion, result consumption and shutdown. Store them atomically beside the parent session file with private permissions, outside project source.
- Memory cleanup may dispose runtime sessions but must not expire IDs or results on disk.
- A recovered running/queued record is stopped with an interruption explanation. Never automatically replay tool calls or claim the process survived a restart.
- Import existing `subagents:record` history for completed agents from older versions. Such records may lack a resumable transcript, but their result remains accessible under the original ID.
- An explicit resume reopens the saved child transcript using the existing runner/configuration and original ID/cwd. Missing transcripts or removed worktrees fail explicitly.
- Validate restart, old history, cleanup, separate sessions, interruption, malformed files, and original-ID resume without live model calls.
