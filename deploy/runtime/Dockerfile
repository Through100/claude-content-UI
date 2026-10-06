FROM almalinux:9

ARG CLAUDE_CODE_VERSION=2.1.289
ARG INSTALL_OLLAMA=false
ARG OLLAMA_VERSION=0.35.1
ARG OLLAMA_AMD64_SHA256=9fcd79ac4575b2bd31b992eee18b1000c8ad126b451627c8f8cd091714cfbb10

RUN dnf -y module enable nodejs:22 \
    && dnf -y install \
        alsa-lib \
        at-spi2-atk \
        atk \
        ca-certificates \
        cups-libs \
        findutils \
        gcc \
        gcc-c++ \
        git \
        gtk3 \
        gzip \
        libdrm \
        libX11 \
        libXcomposite \
        libXdamage \
        libXext \
        libXfixes \
        libXi \
        libXrandr \
        libXtst \
        libxkbcommon \
        make \
        mesa-libgbm \
        nodejs \
        npm \
        nss \
        openssh-clients \
        pango \
        procps-ng \
        python3.11 \
        python3.11-devel \
        python3.11-pip \
        shadow-utils \
        tar \
        unzip \
        util-linux \
        util-linux-user \
        which \
        zstd \
    && dnf clean all \
    && rm -rf /var/cache/dnf \
    && ln -sf /usr/bin/python3.11 /usr/local/bin/python3 \
    && ln -sf /usr/bin/pip3.11 /usr/local/bin/pip3 \
    && useradd --create-home --uid 1000 --shell /bin/bash loopy \
    && npm install --global "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
    && npm cache clean --force

RUN if [ "${INSTALL_OLLAMA}" = "true" ]; then \
        curl -fsSL \
            "https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/ollama-linux-amd64.tar.zst" \
            -o /tmp/ollama-linux-amd64.tar.zst \
        && echo "${OLLAMA_AMD64_SHA256}  /tmp/ollama-linux-amd64.tar.zst" | sha256sum --check --strict \
        && zstd --decompress --stdout /tmp/ollama-linux-amd64.tar.zst | tar -xf - -C /usr \
        && rm -f /tmp/ollama-linux-amd64.tar.zst; \
    fi

ARG APP_NAME
ARG APP_HOME
ARG UI_COMMIT
ARG SKILL_COMMIT
RUN test -n "${UI_COMMIT}" && test -n "${SKILL_COMMIT}"

LABEL org.opencontainers.image.title="${APP_NAME}" \
      org.opencontainers.image.revision="${UI_COMMIT}" \
      com.doubledotmedia.skill-revision="${SKILL_COMMIT}" \
      com.doubledotmedia.ollama-version="${OLLAMA_VERSION}"

ENV APP_HOME="${APP_HOME}" \
    APP_BUILD_SHA="${UI_COMMIT}" \
    APP_SKILL_SHA="${SKILL_COMMIT}" \
    HOME=/home/loopy \
    NODE_ENV=production \
    PATH="/home/loopy/.claude/skills/seo/scripts:/home/loopy/.claude/skills/seo/.venv/bin:/home/loopy/.claude/skills/blog/.venv/bin:/usr/local/bin:/usr/bin:/bin"

WORKDIR ${APP_HOME}

COPY --chown=loopy:loopy app/ ./
COPY --chmod=0755 app/deploy/runtime/install-skills.sh /usr/local/bin/install-claude-skills
COPY --chmod=0755 app/deploy/runtime/start-container.sh /usr/local/bin/start-claude-container
RUN chown -R loopy:loopy "${APP_HOME}"

USER loopy
RUN npm ci --include=dev \
    && npm run lint \
    && npm run check:runtime \
    && npm run build \
    && npm cache clean --force

USER root
RUN /usr/local/bin/install-claude-skills \
    && chown -R loopy:loopy /home/loopy "${APP_HOME}"

USER loopy
EXPOSE 3000

CMD ["/usr/local/bin/start-claude-container"]
