#!/usr/bin/env bash
set -euo pipefail

# cortex-engine setup script
# Usage: ./setup.sh --target /path/to/your/project
# Prefer: npx fozikio init (does this automatically)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --target) TARGET="$2"; shift 2 ;;
    *) echo "Usage: ./setup.sh --target /path/to/project"; exit 1 ;;
  esac
done

if [[ -z "$TARGET" ]]; then
  echo "Error: --target is required"
  echo "Usage: ./setup.sh --target /path/to/your/project"
  exit 1
fi

if [[ ! -d "$TARGET" ]]; then
  echo "Error: Target directory does not exist: $TARGET"
  exit 1
fi

CLAUDE_DIR="$TARGET/.claude"
mkdir -p "$CLAUDE_DIR/hooks" "$CLAUDE_DIR/skills" "$CLAUDE_DIR/agents" "$CLAUDE_DIR/state"

echo "Installing cortex-engine to $TARGET..."

# Symlink hooks (update automatically with git pull)
for hook in "$SCRIPT_DIR"/hooks/*.sh; do
  name=$(basename "$hook")
  ln -sf "$hook" "$CLAUDE_DIR/hooks/$name"
  echo "  Linked hook: $name"
done

# Symlink skills
for skill_dir in "$SCRIPT_DIR"/skills/*/; do
  name=$(basename "$skill_dir")
  mkdir -p "$CLAUDE_DIR/skills/$name"
  ln -sf "$skill_dir/SKILL.md" "$CLAUDE_DIR/skills/$name/SKILL.md"
  echo "  Linked skill: $name"
done

# Copy agents (users customize these)
for agent in "$SCRIPT_DIR"/agents/*.md; do
  name=$(basename "$agent")
  if [[ -f "$CLAUDE_DIR/agents/$name" ]]; then
    echo "  Skipped agent (exists): $name"
  else
    cp "$agent" "$CLAUDE_DIR/agents/$name"
    echo "  Copied agent: $name"
  fi
done

# Write version file
VERSION=$(jq -r '.version' "$SCRIPT_DIR/fozikio.json")
echo "$VERSION" > "$CLAUDE_DIR/cortex-engine.version"

echo ""
echo "cortex-engine v$VERSION installed successfully!"
echo ""
echo "Next steps:"
echo "  1. Set CORTEX_API_URL and CORTEX_API_TOKEN in your environment"
echo "  2. Register hooks in your .claude/settings.json (see examples/)"
