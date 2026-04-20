# PROJECT_KNOWLEDGE.md

## Project Overview
This is a web-based UI for Claude Code, designed to facilitate SEO and content generation tasks. It provides a dashboard to run Claude commands in a headless environment and view history/usage.

## Core Technologies
- **Frontend**: Vite, React, Tailwind CSS.
- **Backend**: Express (Node.js), node-pty for terminal interaction.
- **AI**: Claude Code (CLI) integration.

## Permission System
- **Headless Runs**: Automatically appends `--permission-mode bypassPermissions` to Claude commands.
- **Rationale**: Prevents interactive permission prompts from stalling automated API calls.
- **Opt-out**: Setting `CLAUDE_DISABLE_AUTO_PERMISSION_MODE=1` disables this behavior.

## Status Indicators
- **Patterns**: Recognizes TUI status lines like `✽ Actioning…`, `✻ Thinking…`, and token usage footers.
- **Animation**: The `✽` character is animated in the Pretty View when Claude is actively processing.
- **Inference**: Uses `inferClaudeActivity.ts` to derive the current phase (Reading, Editing, Shell, etc.) from the live stream.

## Key Files
- `server/claudeRunner.ts`: Logic for constructing Claude CLI arguments and spawning processes.
- `server/index.ts`: Main API server and initialization.
- `src/App.tsx`: Main React application.
- `.env`: Environment configuration.
