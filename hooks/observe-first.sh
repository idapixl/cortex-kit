#!/usr/bin/env bash
# observe-first.sh — PreToolUse hook (Write|Edit)
# Reminds agents to call observe() before writing to memory directories.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)

if echo "$FILE_PATH" | grep -qiE '(Mind|Journal|memory)'; then
  cat <<'EOF'
{
  "systemMessage": "**[cortex-kit: observe-first]**\nWriting to a memory directory. Have you called observe() or query() first? Memory writes should be grounded in cortex context."
}
EOF
else
  echo '{}'
fi
