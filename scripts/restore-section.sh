#!/usr/bin/env bash
# restore-section.sh — invoked by /mediator-restore command handler
# Restores a section from the archive directory back into prompts/mediator.md.

set -euo pipefail

section_id="${1:-}"
if [ -z "$section_id" ]; then
  echo "usage: restore-section.sh <section_id>" >&2
  exit 1
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
archive_dir="${HOME}/.local/share/opencode/mediator/archive"
prompt_file="${repo_root}/prompts/mediator.md"

archive_file=$(ls -1t "${archive_dir}/${section_id}_"*.md 2>/dev/null | head -1 || true)
if [ -z "$archive_file" ]; then
  echo "no archive copy for section_id: ${section_id}" >&2
  exit 1
fi

section_body=$(cat "$archive_file")

tmp=$(mktemp)
cat "$prompt_file" > "$tmp"
cat >> "$tmp" <<SECTION

## ${section_id} (restored from archive at $(basename "$archive_file"))

${section_body}
SECTION
mv "$tmp" "$prompt_file"

echo "restored ${section_id} from $(basename "$archive_file") into $(basename "$prompt_file")"
