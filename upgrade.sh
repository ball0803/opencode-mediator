#!/usr/bin/env bash
# upgrade.sh — opencode-mediator upgrade
#
# Diffs current install against new install.sh, applies only deltas,
# preserves user state (records, provenance, patterns, hand-edited config).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="${HOME}/.config/opencode"
RUNTIME_DIR="${HOME}/.local/share/opencode/mediator"
DRY_RUN=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN="1" ;;
    -h|--help)
      cat <<'USAGE'
Usage: upgrade.sh [--dry-run]

Brings an existing install up to the latest opencode-mediator release.
Preserves user data and hand-edited config.
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

if [ ! -d "$RUNTIME_DIR" ]; then
  echo "No existing install at $RUNTIME_DIR; run install.sh instead." >&2
  exit 1
fi

run cd "$REPO_ROOT"
run git pull --ff-only || run bun install --frozen-lockfile

NEW_VERSION=$(cat "$REPO_ROOT/VERSION" 2>/dev/null || echo "unknown")
OLD_VERSION=$(cat "$RUNTIME_DIR/VERSION" 2>/dev/null || echo "none")
echo "Upgrading from $OLD_VERSION to $NEW_VERSION"

NEW_SYMLINKS=(
  "agents/mediator.md:$INSTALL_DIR/agents/mediator.md"
  "agents/refiner.md:$INSTALL_DIR/agents/refiner.md"
  "tools/mediator-emit-intent.ts:$INSTALL_DIR/tools/mediator-emit-intent.ts"
  "tools/apply-refiner-patch.ts:$INSTALL_DIR/tools/apply-refiner-patch.ts"
  "plugins/recorder.ts:$INSTALL_DIR/plugins/recorder.ts"
  "plugins/patch-apply.ts:$INSTALL_DIR/plugins/patch-apply.ts"
  ".opencode/plugins/lat-md-enforce.ts:$INSTALL_DIR/.opencode/plugins/lat-md-enforce.ts"
  ".agents/skills/lat-md:$INSTALL_DIR/.agents/skills/lat-md"
  "docs/lat.md:$INSTALL_DIR/lat.md"
)

for entry in "${NEW_SYMLINKS[@]}"; do
  src="${entry%%:*}"
  dst="${entry#*:}"
  if [ -L "$dst" ]; then
    current=$(readlink "$dst")
    if [ "$current" = "$REPO_ROOT/$src" ]; then
      echo "[skip] $dst already up to date"
    else
      run ln -sfn "$REPO_ROOT/$src" "$dst"
    fi
  elif [ -e "$dst" ]; then
    echo "[warn] $dst exists and is not a symlink; manual review needed"
  else
    run ln -s "$REPO_ROOT/$src" "$dst"
  fi
done

OC_CFG="$INSTALL_DIR/opencode.json"
if [ -f "$OC_CFG" ] && command -v jq >/dev/null 2>&1; then
  if [ -z "$DRY_RUN" ]; then
    tmp=$(mktemp)
    has_plugin=$(jq '[.plugin[]?] | map(select(test("mediator|lat-md-enforce"; "i"))) | length' "$OC_CFG")
    if [ "$has_plugin" = "0" ]; then
      jq '.plugin += ["./plugins/recorder.ts", "./.opencode/plugins/lat-md-enforce.ts"]' "$OC_CFG" > "$tmp" && mv "$tmp" "$OC_CFG"
    fi
  else
    echo "[dry-run] jq-merge: ensure opencode-mediator keys present in $OC_CFG"
  fi
fi

run cp "$REPO_ROOT/VERSION" "$RUNTIME_DIR/VERSION"

echo "Upgrade complete. Records, provenance, and patterns preserved at $RUNTIME_DIR"
