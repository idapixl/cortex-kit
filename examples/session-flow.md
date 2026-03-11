# Example Session Flow with Cortex

## Session Start

1. Hooks fire: session-lifecycle clears state, cognitive-grounding loads
2. Agent queries cortex for current context: `query("what was I working on")`
3. Agent reads cortex results and picks up where they left off

## During Work

1. Before any design/review: `query()` fires automatically via hookify rule
2. Interesting observations captured: `observe("noticed X pattern")`
3. Telemetry hook tracks which cortex tools are being called

## Session End

1. Final observations captured
2. Telemetry data persists in `.claude/state/`
3. Cortex context carries forward to next session
