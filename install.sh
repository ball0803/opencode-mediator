#!/usr/bin/env bash
# install.sh — opencode-mediator installer
#
# Race protection (D26): refuses to run if opencode is live.
# Atomic write: ~/.config/opencode/opencode.json written via .tmp + mv.
# Idempotent: re-running on an existing install is safe.
# Skip-env: OPENCODE_MEDIATOR_SKIP_LAT_INSTALL=1 bypasses the lat.md step.

set -euo pipefail

REPO_URL="git@github.com:ball0803/opencode-mediator.git"
REPO_NAME="opencode-mediator"
INSTALL_DIR="${HOME}/.config/opencode"
RUNTIME_DIR="${HOME}/.local/share/opencode/mediator"
SKIP_LAT="${OPENCODE_MEDIATOR_SKIP_LAT_INSTALL:-}"
DRY_RUN=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="1" ;;
    -h|--help)
      cat <<'USAGE'
Usage: install.sh [--dry-run]

Race-safe installer for opencode-mediator.

Options:
  --dry-run   Print actions without executing
  -h, --help  Show this help

Env vars (set before invoking):
  OPENCODE_MEDIATOR_SKIP_LAT_INSTALL=1  Bypass the lat.md install step

State (preserved across re-runs):
  ${INSTALL_DIR}/* symlinks
  ${RUNTIME_DIR}/ (records, provenance, patterns, sessions)
  ${INSTALL_DIR}/opencode.json (atomic-merged)

USAGE
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 1 ;;
  esac
done

run() {
  if [ -n "$DRY_RUN" ]; then
    printf '[dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

if [ -z "$DRY_RUN" ] && pgrep -f opencode >/dev/null 2>&1; then
  echo "opencode is running; stop it first (or use --dry-run)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

run cd "$REPO_ROOT"
run bun install --frozen-lockfile

mkdir -p "$REPO_ROOT/.build/plugins"
run bun build "$REPO_ROOT/plugins/recorder.ts" \
  --target=bun --format=esm \
  --external @opencode-ai/sdk --external @opencode-ai/plugin \
  --outfile "$REPO_ROOT/.build/plugins/recorder.js"
run bun build "$REPO_ROOT/plugins/patch-apply.ts" \
  --target=bun --format=esm \
  --external @opencode-ai/sdk --external @opencode-ai/plugin \
  --outfile "$REPO_ROOT/.build/plugins/patch-apply.js"

if [ -z "$SKIP_LAT" ]; then
  run lat init || true
else
  echo "[skip] lat init (OPENCODE_MEDIATOR_SKIP_LAT_INSTALL=1)"
fi

mkdir -p "$INSTALL_DIR/agents" \
         "$INSTALL_DIR/tools" \
         "$INSTALL_DIR/plugins" \
         "$INSTALL_DIR/commands" \
         "$INSTALL_DIR/.opencode" \
         "$RUNTIME_DIR/records" \
         "$RUNTIME_DIR/archive" \
         "$RUNTIME_DIR/sessions" \
         "$RUNTIME_DIR/permissions"
chmod 700 "$INSTALL_DIR"
chmod 700 "$RUNTIME_DIR"

link() {
  local src="$1" dst="$2"
  if [ -L "$dst" ] || [ -e "$dst" ]; then
    echo "[skip] $dst already exists"
  else
    run ln -s "$src" "$dst"
  fi
}

link "$REPO_ROOT/agents/mediator.md"      "$INSTALL_DIR/agents/mediator.md"
link "$REPO_ROOT/agents/refiner.md"       "$INSTALL_DIR/agents/refiner.md"
link "$REPO_ROOT/.build/plugins/recorder.js"      "$INSTALL_DIR/plugins/recorder.js"
link "$REPO_ROOT/.build/plugins/patch-apply.js"   "$INSTALL_DIR/plugins/patch-apply.js"
link "$REPO_ROOT/.opencode/plugins/lat-md-enforce.ts" "$INSTALL_DIR/.opencode/plugins/lat-md-enforce.ts"
link "$REPO_ROOT/.agents/skills/lat-md"   "$INSTALL_DIR/.agents/skills/lat-md"
link "$REPO_ROOT/docs/lat.md"             "$INSTALL_DIR/lat.md"

OC_CFG="$INSTALL_DIR/opencode.json"
OC_TMP="$OC_CFG.tmp"

if [ ! -f "$OC_CFG" ]; then
  cat > "$OC_TMP" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "./plugins/recorder.js",
    "./plugins/patch-apply.js",
    "./.opencode/plugins/lat-md-enforce.ts"
  ],
  "agent": {
    "mediator": { "prompt": "{file:./agents/mediator.md}" }
  },
  "mcp": {
    "lat-md": { "type": "local", "command": ["npx", "-y", "lat.md@0.12.2", "mcp"] }
  }
}
JSON
  run mv "$OC_TMP" "$OC_CFG"
else
  echo "[skip] $OC_CFG already exists (would atomic-merge with jq; Phase 3 follow-up)"
fi

cat <<DONE
opencode-mediator install complete.

Built:
  $REPO_ROOT/.build/plugins/recorder.js
  $REPO_ROOT/.build/plugins/patch-apply.js

Linked:
  $INSTALL_DIR/agents/mediator.md
  $INSTALL_DIR/agents/refiner.md
  $INSTALL_DIR/plugins/recorder.js
  $INSTALL_DIR/plugins/patch-apply.js
  $INSTALL_DIR/.opencode/plugins/lat-md-enforce.ts
  $INSTALL_DIR/.agents/skills/lat-md
  $INSTALL_DIR/lat.md

Opencode config: $OC_CFG
Runtime data:    $RUNTIME_DIR
DONE
