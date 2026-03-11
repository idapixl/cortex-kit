---
name: observe-first
enabled: true
event: file
action: warn
strength: enforce
category: production
conditions:
  - field: file_path
    operator: regex_match
    pattern: (Mind|Journal|memory)
---

**Writing to a memory directory — have you observed first?**

Call observe() or query() before writing to memory directories. Writing into a vacuum means the memory graph doesn't know what triggered this.
