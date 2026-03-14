#!/usr/bin/env bash
# ============================================================================
# observe-first.sh — Claude Code Hook
# ============================================================================
# Event:    PreToolUse (Write, Edit)
# Purpose:  Reminds agents to call observe() or query() before writing to
#           memory directories (Mind/, Journal/, memory/).
# How:      Checks the file path of Write/Edit operations. If targeting a
#           memory directory, injects a system message reminder.
# Disable:  Delete this file from .claude/hooks/ — no other config needed.
# Part of:  fozikio — portable, no project-specific paths.
# ============================================================================

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)

if echo "$FILE_PATH" | grep -qiE '(Mind|Journal|memory)'; then
  cat <<'EOF'
{
  "systemMessage": "**[fozikio: observe-first]**\nWriting to a memory directory. Have you called observe() or query() first? Memory writes should be grounded in cortex context."
}
EOF
else
  echo '{}'
fi
