#!/usr/bin/env bash
# ============================================================================
# session-lifecycle.sh — Claude Code Hook
# ============================================================================
# Event:    SessionStart
# Purpose:  Resets session-scoped state files at the start of each session.
#           Clears cortex telemetry logs and push-gate state so hooks start
#           fresh without stale data from previous sessions.
# How:      Truncates .claude/state/cortex-calls.log and push-gate-state.txt.
# Disable:  Delete this file from .claude/hooks/ — no other config needed.
# Part of:  cortex-kit — supports cortex-telemetry.sh and project-board-gate.sh.
# ============================================================================

STATE_DIR="${CLAUDE_PROJECT_DIR:-.}/.claude/state"
mkdir -p "$STATE_DIR"

# Clear session-scoped state from previous session
> "$STATE_DIR/cortex-calls.log" 2>/dev/null
> "$STATE_DIR/push-gate-state.txt" 2>/dev/null

echo '{}'
