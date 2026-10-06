#!/usr/bin/env bash
set -euo pipefail

: "${APP_HOME:?APP_HOME must be set}"
claude_dir=/home/loopy/.claude
skill_dir=${claude_dir}/skills
agent_dir=${claude_dir}/agents
mkdir -p "${skill_dir}" "${agent_dir}"

if [[ -d "${APP_HOME}/claude-seo" ]]; then
    source_dir=${APP_HOME}/claude-seo
    cp -a "${source_dir}/skills/." "${skill_dir}/"
    cp -a "${source_dir}/agents/." "${agent_dir}/"
    for payload in scripts schema pdf hooks data; do
        if [[ -d "${source_dir}/${payload}" ]]; then
            mkdir -p "${skill_dir}/seo/${payload}"
            cp -a "${source_dir}/${payload}/." "${skill_dir}/seo/${payload}/"
        fi
    done
    cp "${source_dir}/requirements.txt" "${skill_dir}/seo/requirements.txt"
    cp "${source_dir}/.claude-plugin/plugin.json" "${skill_dir}/seo/runtime-plugin.json"
    chmod 0755 "${skill_dir}/seo/scripts/claude-seo"

    for extension in "${source_dir}"/extensions/*; do
        [[ -d "${extension}" ]] || continue
        extension_name=$(basename "${extension}")
        for payload in skills agents; do
            [[ -d "${extension}/${payload}" ]] || continue
            cp -a "${extension}/${payload}/." "${claude_dir}/${payload}/"
        done
        for payload in references scripts; do
            [[ -d "${extension}/${payload}" ]] || continue
            mkdir -p "${skill_dir}/seo/extensions/${extension_name}/${payload}"
            cp -a "${extension}/${payload}/." "${skill_dir}/seo/extensions/${extension_name}/${payload}/"
        done
    done

    # Manual installation has no CLAUDE_PLUGIN_ROOT. Follow upstream's exact
    # launcher and reference substitutions, including new extension payloads.
    python3.11 - "${skill_dir}" "${agent_dir}" <<'PY'
import pathlib
import sys

skills = pathlib.Path(sys.argv[1])
agents = pathlib.Path(sys.argv[2])
for directory in (skills, agents):
    for document in directory.rglob("*.md"):
        text = document.read_text(encoding="utf-8")
        text = text.replace("${CLAUDE_PLUGIN_ROOT}/skills/", str(skills) + "/")
        text = text.replace('"${CLAUDE_PLUGIN_ROOT}/scripts/claude-seo"', '"$HOME/.claude/skills/seo/scripts/claude-seo"')
        document.write_text(text, encoding="utf-8")
PY

    # Carry forward the existing DDM presence-evidence and SPA acquisition
    # safeguards without replacing newer upstream guidance or references.
    guard=${APP_HOME}/deploy/runtime/seo-evidence-guard.md
    for document in "${skill_dir}/seo-geo/SKILL.md" "${agent_dir}/seo-geo.md" "${skill_dir}/seo-page/SKILL.md"; do
        if [[ -f "${guard}" && -f "${document}" ]]; then
            printf '\n\n' >> "${document}"
            cat "${guard}" >> "${document}"
        fi
    done
    chown -R loopy:loopy /home/loopy
    /usr/sbin/runuser -u loopy -- env CLAUDE_SEO_PYTHON=/usr/local/bin/python3 \
        "${skill_dir}/seo/scripts/claude-seo" setup
    /usr/sbin/runuser -u loopy -- env CLAUDE_SEO_PYTHON=/usr/local/bin/python3 \
        "${skill_dir}/seo/scripts/claude-seo" doctor --json
elif [[ -d "${APP_HOME}/claude-blog" ]]; then
    source_dir=${APP_HOME}/claude-blog
    cp -a "${source_dir}/skills/." "${skill_dir}/"
    cp -a "${source_dir}/agents/." "${agent_dir}/"
    mkdir -p "${claude_dir}/scripts" "${skill_dir}/blog/scripts" "${skill_dir}/blog/data"
    cp -a "${source_dir}/scripts/." "${claude_dir}/scripts/"
    cp -a "${source_dir}/scripts/." "${skill_dir}/blog/scripts/"
    cp "${source_dir}/data/google-updates.json" "${skill_dir}/blog/data/google-updates.json"

    python3.11 -m venv "${skill_dir}/blog/.venv"
    "${skill_dir}/blog/.venv/bin/python" -m pip install --no-cache-dir --upgrade 'pip==26.2.1'
    "${skill_dir}/blog/.venv/bin/python" -m pip install --no-cache-dir --require-hashes \
        -r "${source_dir}/requirements.lock"
    "${skill_dir}/blog/.venv/bin/python" -m pip check
    # The Google and Audio runners manage separate environments. Seed their
    # reviewed locks now so normal commands need no dependency download.
    for leaf in blog-google blog-audio; do
        leaf_dir=${skill_dir}/${leaf}
        scripts_dir=${leaf_dir}/scripts
        python3.11 -m venv "${leaf_dir}/.venv"
        "${leaf_dir}/.venv/bin/python" -m pip install --no-cache-dir --upgrade 'pip==26.2.1'
        "${leaf_dir}/.venv/bin/python" -m pip install --no-cache-dir --require-hashes \
            -r "${scripts_dir}/requirements.lock"
        "${leaf_dir}/.venv/bin/python" -m pip check
        sha256sum "${scripts_dir}/requirements.lock" | cut -d ' ' -f 1 \
            > "${leaf_dir}/.venv/.requirements.stamp"
    done
else
    echo "No pinned claude-seo or claude-blog source found under APP_HOME" >&2
    exit 1
fi

# Keep the established container permission-prompt behavior.
cat > "${claude_dir}/settings.json" <<'JSON'
{
  "skipDangerousModePermissionPrompt": true
}
JSON
chown -R loopy:loopy /home/loopy
