---
name: note-about-doing
enabled: true
event: prompt
strength: nudge
category: training
conditions:
  - field: user_prompt
    operator: regex_match
    pattern: (?i)(I should|I need to|I want to|let me|I'll)
---

Gentle reminder: If this is a new thread of thought, consider capturing it with `thread_create()` rather than just noting it and moving on.
