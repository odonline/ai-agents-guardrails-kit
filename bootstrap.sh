#!/usr/bin/env bash
# bootstrap.sh — one-shot installer. Clones the guardrails kit into a temp
# dir (shallow, no history), runs it against the CURRENT directory, and
# cleans up. Works with ANY git host (GitHub, GitLab.com, self-hosted
# GitLab, Bitbucket...) because it uses `git clone`, not a provider-specific
# archive URL — and it transparently reuses whatever git auth (SSH key,
# stored token) is already configured on the developer's machine, so it
# works the same for public and private repos.
#
# Usage (once hosted):
#   curl -fsSL https://github.com/odonline/ai-agents-guardrails-kit/-/raw/main/bootstrap.sh | bash
#   curl -fsSL .../bootstrap.sh | bash -s -- --agents claude-code --stacks node
#
# Configure the source repo either by editing REPO_URL below, or by setting
# env vars before piping:
#   GUARDRAILS_REPO_URL=git@github.com:odonline/ai-agents-guardrails-kit.git \
#     curl -fsSL .../bootstrap.sh | bash
#
# Security note: this is the same curl-pipe-shell pattern the policy engine
# itself blocks for AGENTS — that's intentional and fine here because a
# human runs it, once, and can read it first. Pin GUARDRAILS_REF to a tag
# or commit (not a mutable branch) before wiring this into your org, and
# encourage `curl ... -o bootstrap.sh && less bootstrap.sh` before piping
# on machines you don't fully trust.
set -euo pipefail

REPO_URL="${GUARDRAILS_REPO_URL:-https://github.com/odonline/ai-agents-guardrails-kit.git}"
REF="${GUARDRAILS_REF:-main}"                   # recommended: pin to a tag, e.g. v1.0.0
TARGET_DIR="${PWD}"

if ! command -v git >/dev/null 2>&1; then
  echo "git no está instalado." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js no está instalado. Instalalo (nodejs.org) y volvé a correr este script." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Descargando ai-agents-guardrails-kit (${REPO_URL}@${REF})..."
git clone --depth 1 --branch "$REF" "$REPO_URL" "$TMP/kit" --quiet

echo "Instalando guardrails en: ${TARGET_DIR}"
node "$TMP/kit/install.js" --target "$TARGET_DIR" "$@"
