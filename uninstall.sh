#!/usr/bin/env bash
# uninstall.sh — opencode-mediator uninstaller
#
# Removes symlinks and the opencode-mediator entries from opencode.json.
# PRESERVES user data: records, provenance, patterns, sessions.

set -euo pipefail

INSTALL_DIR="${HOME}/.config/opencode"
RUNTIME_DIR="${HOME}/.local/share/opencode/mediator"
DRY_RUN=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="1" ;;
    -h|--help)
      cat <<'USAGE'
Usage: uninstall.sh [--dry-run]

Removes opencode-mediator symlinks and config entries. User data at
~/.local/share/opencode/mediator/ is preserved (use --purge to remove it).
USAGE
      exit 0
      ;;
    --purge) PURGE="1" ;;
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

remove() {
  local target="$1"
  if [ -L "$target" ] || [ -e "$target" ]; then
    run rm -f "$target"
  else
    echo "[skip] $target not present"
  fi
}

remove "$INSTALL_DIR/agents/mediator.md"
remove "$INSTALL_DIR/agents/refiner.md"
remove "$INSTALL_DIR/tools/mediator-emit-intent.ts"
remove "$INSTALL_DIR/tools/apply-refiner-patch.ts"
remove "$INSTALL_DIR/plugins/recorder.ts"
remove "$INSTALL_DIR/plugins/patch-apply.ts"
remove "$INSTALL_DIR/.opencode/plugins/lat-md-enforce.ts"
remove "$INSTALL_DIR/.agents/skills/lat-md"
remove "$INSTALL_DIR/lat.md"

OC_CFG="$INSTALL_DIR/opencode.json"
if [ -f "$OC_CFG" ] && command -v jq >/dev/null 2>&1; then
  if [ -z "$DRY_RUN" ]; then
    tmp=$(mktemp)
    jq 'del(.plugin[] | select(test("mediator|lat-md-enforce"; "i"))) |
        del(.agent.mediator) |
        del(.mcp["lat-md"])' "$OC_CFG" > "$tmp" && mv "$tmp" "$OC_CFG"
  else
    echo "[dry-run] jq-merge: remove opencode-mediator keys from $OC_CFG"
  fi
else
  echo "[skip] $OC_CFG (no jq available, manual cleanup required)"
fi

if [ "${PURGE:-}" = "1" ]; then
  if [ -z "$DRY_RUN" ] && [ -d "$RUNTIME_DIR" ]; then
    run rm -rf "$RUNTIME_DIR"
    echo "[purged] $RUNTIME_DIR"
  else
    echo "[dry-run] rm -rf $RUNTIME_DIR"
  fi
else
  echo "[kept] $RUNTIME_DIR (use --purge to remove)"
fi

echo "Uninstall complete."
