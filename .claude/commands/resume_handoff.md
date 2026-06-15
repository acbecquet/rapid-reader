---
description: Resume work from a handoff document (read, validate, continue)
---

# Resume from a handoff

You are resuming work from a handoff document. It holds the critical context, learnings, and next steps from a previous session.

## Initial response

When invoked:

1. **If a handoff path was provided** (e.g. `/resume_handoff thoughts/shared/handoffs/general/<file>.md`):
   - Read the handoff document FULLY (Read tool, no limit/offset).
   - Read — directly, yourself, **no sub-agents** — every plan/spec/research/artifact it links to (e.g. under `docs/` or `thoughts/shared/`).
   - Then propose a course of action and confirm with the user.

2. **If no path was provided**, respond:
   ```
   I'll resume from a handoff. Point me at one:
   /resume_handoff thoughts/shared/handoffs/general/<YYYY-MM-DD_HH-MM-SS_description>.md
   ```
   Then list `thoughts/shared/handoffs/general/` and offer the most recent (by the `YYYY-MM-DD_HH-MM-SS` filename). Wait for the user.

## Steps

### 1. Read & analyze
- Read the handoff completely. Extract: Task(s) + statuses, Recent changes, Learnings, Artifacts, Action items, Other notes.
- Read the artifacts and files it references **directly** (do not delegate to sub-agents).
- Read the files named under "Learnings" and "Recent changes" to understand the modifications.

### 2. Validate current state
- Verify the changes the handoff describes still exist (git may have moved on).
- Note any regressions, conflicts, or drift since the handoff was written.

### 3. Present analysis & confirm
Present a short synthesis, then get confirmation before doing work:
```
I've analyzed the handoff from [date]. Current situation:

**Tasks:** [task] — [handoff status] → [current state]
**Learnings validated:** [learning w/ file:line] — [still valid / changed]
**Recent changes:** [change] — [present / missing / modified]
**Recommended next actions:** 1) … 2) …
**Issues found:** [conflicts/regressions, if any]

Shall I proceed with [action 1], or adjust the approach?
```

### 4. Plan & begin
- Use TodoWrite to turn the action items (+ anything new you found) into a task list, prioritized by dependencies.
- Start the first approved task. Apply the patterns/learnings from the handoff; avoid the mistakes it flags. Reference the handoff in commits. Consider writing a new handoff (`/create_handoff`) when you stop.

## Guidelines
- Read the whole handoff first; never assume its state matches the current code — verify file references and check for breaking changes since.
- Be interactive: present findings, get buy-in, allow course corrections.
- Lean on the "Learnings" section and build on what's already there.
