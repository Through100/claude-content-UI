# AI_PLAN.md

## Current Task
- Address user query regarding automatic permission bypass in Claude.

## Completed Tasks
- [x] Identified logic for `bypassPermissions` in `server/claudeRunner.ts`.
- [x] Created `PROJECT_KNOWLEDGE.md`.
- [x] Updated `.env` to disable auto permission bypass.
- [x] Provided explanation to the user.
- [x] Added support for `✽` and `Actioning` status patterns in PTY parsing.
- [x] Enhanced `PtyAssistantPending` with an animated `✽` and live status capture.
- [x] Fixed PTY permission auto-selection prompt dropping input by mimicking manual reply behavior (150ms delay between choice and carriage return \r).
- [x] Fixed menu parser regex to tolerate the interactive `❯ ` cursor in the first menu option, preventing false "user text bubbles" and ensuring the auto-submit selects index 1.
- [x] Verified build.

## To-Do
- [ ] Monitor for any further user requests.
