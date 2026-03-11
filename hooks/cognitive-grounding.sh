#!/usr/bin/env bash
# cognitive-grounding.sh — UserPromptSubmit hook
# Reminds agents to call cortex query() before substantive cognitive work.
# Part of cortex-kit — portable, no project-specific paths.

INPUT=$(cat)
PROMPT=$(echo "$INPUT" | jq -r '.user_prompt // ""' 2>/dev/null)

# Check if prompt involves evaluation/design/review work
if echo "$PROMPT" | grep -qiE '(evaluat|review|design|assess|analyz|creat|build|architect|plan|propos|critique|audit|diagnos)'; then
  cat <<'EOF'
{
  "systemMessage": "**[cortex-kit: cognitive-grounding]**\nThis prompt involves substantive cognitive work. Before responding, call `query()` on the topic to ground your work in accumulated experience.\n\n```\nmcp__cortex__query({ text: \"[the topic]\" })\n```"
}
EOF
else
  echo '{}'
fi
