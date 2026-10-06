<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

## Claude Blog runtime

The dashboard is aligned with the stable claude-blog 2.2.0 release. Its 33 existing command choices are retained, including writing, analysis, strategy, assets, Google APIs, international publishing, and FLOW workflows.

The October 6, 2026 model review is captured in `shared/modelCatalog.ts`. The dashboard and API share this catalog with Ollama routing. The default Claude model is Fable 5.1; Opus 5.5, Sonnet 5.5, and current Ollama cloud alternatives are available. Retired cloud models resolve to available replacements for older clients. Direct Ollama API calls use catalog names rather than CLI cloud suffixes.

The model picker also controls the interactive Blog terminal. Changing models saves the previous run to History and opens a fresh conversation with the selected provider and model; the choice survives reloads in the same browser tab. Logon opens the direct Claude account session when switching from an Ollama model.

The pinned AlmaLinux container recipe in `deploy/runtime/` includes Claude Code 2.1.289, Ollama 0.35.1, and the complete Blog 2.2.0 skill files, scripts, and Google update ledger. Core, Google, and Audio Python environments use upstream hash locks. Build from clean Git exports and confirm the UI/skill commit identifiers returned by `/api/health` after deployment.

Run `npm run lint`, `npm run check:runtime`, and `npm run build` before release. The runtime checks cover provider routing, retired selections, retained commands, and report output isolation.

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/1cc7377d-b9c9-4af8-8fef-304a5dff0b3f

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
