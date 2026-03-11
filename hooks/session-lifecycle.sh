#!/usr/bin/env bash
# session-lifecycle.sh — SessionStart hook
# Clears cortex telemetry state for new session.

STATE_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude/state"
mkdir -p "$STATE_DIR"

# Clear call log from previous session
> "$STATE_DIR/cortex-calls.log" 2>/dev/null

echo '{}'
