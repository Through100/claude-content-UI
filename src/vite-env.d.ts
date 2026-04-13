/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  /** Max wait for POST /api/run (ms). Default 30m; must be ≤ browser limits. */
  readonly VITE_RUN_TIMEOUT_MS?: string;
  /** Use SSE /api/run/stream for live terminal (default). Set 0 to use buffered /api/run only. */
  readonly VITE_RUN_STREAM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
