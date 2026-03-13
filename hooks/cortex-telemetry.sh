#!/usr/bin/env bash
# ============================================================================
# cortex-telemetry.sh — Claude Code Hook
# ============================================================================
# Event:    PostToolUse
# Purpose:  Tracks cortex retrieval tool usage and detects retries (repeat
#           retrieval calls within 60s), sending feedback to the cortex API
#           for retrieval quality improvement.
# How:      Logs each cortex retrieval call (query, recall, wander, etc.) to
#           .claude/state/cortex-calls.log. If two calls happen within 60s,
#           POSTs a "retry" signal to CORTEX_API_URL/api/v2/retrieval-feedback.
# Env:      CORTEX_API_URL, CORTEX_API_TOKEN (optional — skips API call if unset)
# Disable:  Delete this file from .claude/hooks/ — no other config needed.
# Part of:  cortex-kit — portable, fire-and-forget HTTP calls.
# ============================================================================

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)
TIMESTAMP=$(date +%s)
STATE_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude/state"
LOG_FILE="$STATE_DIR/cortex-calls.log"

# Only track cortex retrieval tools
case "$TOOL_NAME" in
  mcp__cortex__query|mcp__cortex__recall|mcp__cortex__wander|mcp__cortex__neighbors|mcp__cortex__surface|mcp__cortex__retrieve)
    mkdir -p "$STATE_DIR"

    # Read previous entry BEFORE appending current
    PREV=$(tail -1 "$LOG_FILE" 2>/dev/null || echo "")
    PREV_TS=$(echo "$PREV" | cut -d' ' -f1)
    PREV_TOOL=$(echo "$PREV" | cut -d' ' -f2-)

    # Log current call
    echo "$TIMESTAMP $TOOL_NAME" >> "$LOG_FILE"

    # Check if this is a retry (another cortex call within 60s)
    if [ -n "$PREV_TS" ] && [ "$((TIMESTAMP - PREV_TS))" -lt 60 ] 2>/dev/null; then
      # Post feedback to cortex API (fire and forget)
      CORTEX_API_URL="${CORTEX_API_URL:-}"
      CORTEX_API_TOKEN="${CORTEX_API_TOKEN:-}"
      if [ -n "$CORTEX_API_URL" ] && [ -n "$CORTEX_API_TOKEN" ]; then
        curl -s --max-time 3 "$CORTEX_API_URL/api/v2/retrieval-feedback" \
          -H "x-cortex-token: $CORTEX_API_TOKEN" \
          -H "Content-Type: application/json" \
          -d "{\"original_tool\":\"$PREV_TOOL\",\"retry_tool\":\"$TOOL_NAME\",\"signal\":\"retry\",\"timestamp\":$TIMESTAMP}" \
          > /dev/null 2>&1 &
      fi
    fi
    ;;
esac

# Always output empty JSON (non-blocking hook)
echo '{}'
