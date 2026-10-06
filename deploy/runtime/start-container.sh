#!/usr/bin/env bash
set -euo pipefail

if command -v ollama >/dev/null 2>&1; then
    export OLLAMA_HOST="${OLLAMA_HOST:-127.0.0.1:11434}"
    ollama serve &
    ollama_pid=$!

    for attempt in $(seq 1 60); do
        if curl --fail --silent --show-error \
            http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
            break
        fi
        if ! kill -0 "${ollama_pid}" 2>/dev/null; then
            wait "${ollama_pid}"
        fi
        if [[ "${attempt}" -eq 60 ]]; then
            echo "Ollama did not become ready during container startup." >&2
            exit 1
        fi
        sleep 1
    done
fi

exec npm run start
