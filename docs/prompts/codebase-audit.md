## Task

Perform a read-only audit of this codebase: `diff-diagram`.

**This is an audit only. Do not modify, refactor, or fix anything.** Your job is to find and document issues, not resolve them. If you notice something you'd normally just fix in passing, log it as a finding instead.

Before starting, read the following as required context and treat them as the standard this codebase is meant to meet — findings under "Doc misalignment" should be measured against these, not against generic best practices:

- `docs/core-beliefs.md`
- `docs/spec.md`
- `docs/architecture.md`
- `docs/initial-design.md`
- `docs/glossary.md`

## Scope

Look across the whole codebase for:

- **Bugs** — logic errors, incorrect assumptions, race conditions, edge cases that aren't handled, anything that will misbehave.
- **Performance problems** — unnecessary re-renders/recomputation, N+1 patterns, missing memoization, inefficient data structures, anything that'll bite at scale even if it's fine today.
- **Gaps** — missing error handling, missing tests, missing validation, untested edge cases, dead ends in the code that assume something upstream guarantees safety without checking.
- **Doc misalignment** — places where the code contradicts, ignores, or has drifted from the conventions/architecture docs above.
- **Improvements** — things that work but could be clearer, more consistent, or more maintainable given the patterns already established elsewhere in the codebase.
- **Feature ideas** — anything that occurs to you as a natural extension or missing capability. These can be speculative; see the lighter-weight format below.

Prioritize breadth first, then depth on anything that looks serious. It's fine if this takes a while — thoroughness matters more than speed here.

## Output

Write your findings to `docs/audit/YYYY-MM-DD-codebase-audit.md` **as you go, not only at the end**. Treat it as a living document: append findings as you discover them so partial progress is never lost if the session ends early.

The person picking up these findings to implement fixes may be a less capable model with no memory of this audit and no context beyond what's in the document. Each finding must stand alone — assume zero shared context.

### Structure

Start the document with:

- One paragraph on what was reviewed and at what depth (skimmed vs. deeply traced).
- A flat table of contents: category, count, and how many are Critical/High.

Then, for every **bug / performance / gap / doc-misalignment / improvement** finding, use this template:

```
### [CATEGORY]-[NUMBER]: <short descriptive title>

**Severity:** Critical | High | Medium | Low
**Confidence:** High | Medium | Low  (how sure you are this is actually a problem, not a false read)
**Location:** `path/to/file.ts:123` (function/component name)

**What's wrong:**
<Concrete description of the issue. Not "consider improving error handling" — say
exactly what happens, under what conditions, and why it matters.>

**Suggested approach:**
<The actual shape of the fix. Enough that someone unfamiliar with this specific
code could implement it without re-deriving the diagnosis. Reference the specific
pattern to follow if one exists elsewhere in the codebase.>

**Verification:**
<How to confirm the fix worked — a test to add, a repro to check against, a
metric to watch.>
```

For **feature ideas**, use a lighter format — no need for severity/confidence/verification:

```
### FEATURE-[NUMBER]: <short title>

<2-4 sentences: what it is, why it'd help, roughly how big a lift it looks like.>
```

### Rules for good findings

- One finding per issue. Don't bundle three unrelated problems into one entry because they're in the same file.
- Cite exact file paths and line numbers or function names — never "somewhere in the auth module."
- If you're not sure something is actually a bug versus intentional, say so in Confidence rather than omitting it or overstating it.
- Skip filler like "this is important because code quality matters" — get straight to the specific mechanism.
- Don't pad the feature ideas section with the same density as the ticket-shaped findings above it; keep it scannable.

## When you're done

Close with a short "if I only fixed five things" list pointing back to the five highest-severity/highest-confidence findings by ID — the thing you'd say if someone asked for the TL;DR.