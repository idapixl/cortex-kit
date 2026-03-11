---
name: cognitive-grounding
enabled: true
event: prompt
strength: enforce
category: production
conditions:
  - field: user_prompt
    operator: regex_match
    pattern: (?i)(evaluat|review|design|assess|analyz|creat|build|architect|plan|propos|critique|audit|diagnos)
---

**COGNITIVE GROUNDING REQUIRED**

This prompt asks for substantive cognitive work. Before responding, call `query()` on the topic:

```
mcp__cortex__query({ text: "[the topic you're about to think about]" })
```

Grounding evaluations in accumulated experience produces measurably better results than generating from context alone.
