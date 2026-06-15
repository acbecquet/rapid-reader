---
description: Create a handoff document to transfer work to a fresh session
---

# Create Handoff

You are tasked with writing a handoff document to hand your work off to another agent in a new session. Make it **thorough but concise** — compact your context without losing the key details of what you're working on.

## Process

### 1. Filepath & metadata
- Save under `thoughts/shared/handoffs/general/YYYY-MM-DD_HH-MM-SS_description.md`, where `YYYY-MM-DD` is today's date, `HH-MM-SS` is the current 24-hour time, and `description` is a brief kebab-case summary.
- Run `scripts/spec_metadata.sh` to get the date, git commit, branch, and repo name for the frontmatter.
- Example: `thoughts/shared/handoffs/general/2026-06-15_21-54-45_transcript-and-backlog.md`

### 2. Write the handoff
Using the path above, write the document with this YAML frontmatter + structure:

```markdown
---
date: [ISO date/time with timezone]
researcher: [your name / owner]
git_commit: [current commit hash]
branch: [current branch]
repository: [repo name]
topic: "[Feature/Task] Implementation Strategy"
tags: [implementation, relevant-components]
status: [complete | in_progress]
last_updated: [YYYY-MM-DD]
type: implementation_strategy
---

# Handoff: {concise description}

## Task(s)
{The task(s) you were working on + the status of each (completed / in progress / planned). If you're on an implementation plan, name the phase. Reference the plan/spec/research docs you worked from.}

## Critical References
{The 2-3 most important spec/design/architecture docs that must be followed — file paths. Leave blank if none.}

## Recent changes
{Recent codebase changes you made, in `file:line` syntax.}

## Learnings
{Important things you learned — patterns, root causes of bugs, gotchas — that whoever picks this up should know. Include explicit file paths.}

## Artifacts
{An exhaustive list of artifacts you produced/updated (file paths, file:line) that should be read to resume — plans, specs, PRs, etc.}

## Action Items & Next Steps
{Action items and next steps for the next agent, based on the task statuses.}

## Other Notes
{Anything else useful — where relevant code/docs live, environment notes, etc.}
```

### 3. Save
Save the file at the path above and `git add` it; commit when you're ready (no external sync service).

Then respond to the user with the following (do NOT include the XML tags):

<template_response>
Handoff created. Resume from it in a fresh session with:

```bash
/resume_handoff thoughts/shared/handoffs/general/<filename>.md
```
</template_response>

## Notes
- **More information, not less** — this is the minimum a handoff should be; add more when useful.
- **Be thorough and precise** — capture both the top-level objectives and the lower-level details.
- **Avoid large code blocks/diffs.** Prefer `path/to/file.ext:line` references the next agent can follow.
