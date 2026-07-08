#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
HERMES_SRC="$HERMES_HOME/hermes-agent"

if [ ! -d "$REPO_DIR/hermes-agent" ] || [ ! -f "$REPO_DIR/hermes-agent/pyproject.toml" ]; then
  echo "Missing hermes-agent submodule. Clone with:"
  echo "  git clone --recurse-submodules <repo-url>"
  echo "or run:"
  echo "  git submodule update --init --recursive"
  exit 1
fi

mkdir -p "$HERMES_HOME"

if [ ! -f "$HERMES_HOME/.env" ]; then
  echo "Missing $HERMES_HOME/.env"
  echo "Create it from .env.example and fill secrets before running deploy:"
  echo "  mkdir -p $HERMES_HOME"
  echo "  cp .env.example $HERMES_HOME/.env"
  exit 1
fi

rsync -a "$REPO_DIR/hermes-home/" "$HERMES_HOME/" \
  --exclude ".env" \
  --exclude "auth.json" \
  --exclude "*.db" \
  --exclude "*.db-shm" \
  --exclude "*.db-wal" \
  --exclude "sessions/" \
  --exclude "logs/" \
  --exclude "cache/" \
  --exclude "cron/output/" \
  --exclude "gateway.pid" \
  --exclude "gateway.lock"

mkdir -p "$HERMES_SRC"
rsync -a "$REPO_DIR/hermes-agent/" "$HERMES_SRC/" \
  --exclude ".git" \
  --exclude "venv/" \
  --exclude "node_modules/" \
  --exclude "__pycache__/"

cd "$HERMES_SRC"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required."
  exit 1
fi

python3 -m venv venv
source venv/bin/activate

python -m pip install --upgrade pip
pip install -e ".[all]"

python -m hermes_cli.main gateway install || true
systemctl --user daemon-reload || true
systemctl --user restart hermes-gateway.service

python -m hermes_cli.main status
