# Core Beliefs

These are the operating principles that govern how this codebase should work.
They represent durable decisions, not implementation details, which live in
domain docs.

---

## Code is a liability, not an asset

Prefer deleting code over adding it. A feature that does not exist cannot break.
When given a choice between two implementations, choose the one that is easier
to remove. Resist the urge to generalize before a second use case exists.

## Simple systems first

A complex system that works almost always evolved from a simple system that
worked. Do not design for the final state — build the minimal version that
solves the immediate problem, confirm it works, then extend it. A scaffold that
handles one case cleanly is a better foundation than a framework that handles
ten cases in theory.

## Start with the data

Spend time on interfaces, types, and schemas before writing logic. A
well-designed model makes the code obvious; a poor one makes it permanently
difficult. Where you face a choice between complexity in data structures and
complexity in code, prefer the former. Make invalid states unrepresentable: if a
state should not exist, the type system should make it impossible to construct,
not catch it at runtime. For runtime input, validate at the boundary, then
convert into narrower types.

## Name things what the business calls them

Types, fields, and functions should use domain language consistently. Code that
matches the business's nomenclature means everyone is speaking the same
language. It eliminates the constant translation between what the system calls
something and what the team calls it.

## Duplication before abstraction

Repeating yourself is the best way to discover which abstractions you actually
need. Tolerate duplication early. When in doubt, keep behaviors separate until
enough common patterns emerge to justify coupling. A premature abstraction is
harder to untangle than the duplication it replaced.

## Explicit over implicit

Frameworks that rely on reflection, decorators, or implicit wiring are powerful
and easy to abuse. Prefer explicit imports, typed tokens, and named injection
over ambient magic. If a reader has to infer runtime behavior to understand
code, the code is not good enough yet.

## TypeScript strictness is non-negotiable

Code follows strict TypeScript practices. No `any`. No non-null assertions. Type
narrowing is preferred over casting. When the types fight back, that is signal,
not noise to suppress.

## Boundaries are architecture

This codebase enforces domain boundaries through folder structure and linting
rules. Do not import across domain boundaries without going through a public API
surface. Cross-cutting concerns are handled through designated providers. A
"quick import" that crosses a boundary is not quick — it is debt.

## Functional patterns reduce surprise

Prefer pure functions and immutable data. Side effects belong at the edges
(resolvers, effects, services). Business logic inside components is a smell.
Avoid shared mutable state. When state must be shared, it is explicit and typed.

## Guardrails must be mechanical, not social

If a rule matters, there is a lint rule or a structural test for it. Do not rely
on code review to catch violations of core patterns. If you identify a pattern
that keeps being violated, the fix is a new enforcer — not a reminder.

## Reviewability is a first-class constraint

Commits should be readable top-to-bottom without context-switching into an
abundance of files. Prefer many small, coherent commits over one large change.
When a change is large by necessity, structure it so diffs are easy to scan:
structure first, behavior second, style last — in separate commits where
possible.

## Asking is better than assuming

If a task is ambiguous at a decision point that has architectural consequences,
stop and ask. A wrong assumption that becomes 500 lines of code costs more to
undo than the time it takes to clarify. This applies especially to: where state
lives, which domain owns a new concept, and whether a component is shared or
local.
