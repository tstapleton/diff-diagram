# Node diff state: content-based instead of import-based

## Problem

Today, `docs/spec.md` defines node diff state like this:

- `added` — file exists in current, not in base
- `removed` — file exists in base, not in current
- `modified` — file exists in both, but its **outgoing import set changed**
- `unchanged` — file exists in both, with the same import set

`added` and `removed` are genuine file-level facts: they describe whether the file itself exists. `modified` is not — it's a proxy computed from the file's *edges*, not the file itself. A file whose logic, template, or styles changed substantially but whose imports didn't stays `unchanged` — an amber-shaped hole in the diagram's core promise of showing reviewers what changed.

This was flagged in [issue #41](https://github.com/tstapleton/diff-diagram/issues/41), filed from PR #39 review. It reverses a decision that has been in the spec since the project's first commit — this design intentionally revisits it rather than treating it as a bug fix.

## Design

### New semantics

- **Node diff state** becomes a file-level fact, symmetric with `added`/`removed`: a node in both branches is `modified` if its own raw content differs between base and current, else `unchanged`. Import changes are irrelevant to node color.
- **Edge diff state is unchanged.** It continues to reflect import-set changes exactly as it does today (`added`/`removed`/`modified`/`unchanged` per edge, based on the imported-name set). Edge color and node color are now fully decoupled — each answers a different question ("did this file's content change" vs. "did this specific import relationship change").

This is a superset relationship, not a conflicting one: any node that would have been `modified` under the old (edge-based) logic is still `modified` under the new (content-based) logic, because an edited import statement is itself a content change. The new logic only adds cases the old logic missed (content changed, imports didn't) — it never removes a case the old logic caught.

### Detection mechanism

No hashing. The analyzer already reads each file's full text via ts-morph to parse imports. `diffGraphs` compares the base and current raw text directly (string equality) for any node whose `file` path exists in both graphs. Rationale for skipping hashing: files here are small (per the `#27` change-magnitude backlog notes, typical components are 10–30 lines), a hash buys nothing at this scale, and a future magnitude feature (`#27`) will need the raw text anyway to compute a line-level diff — a hash would have to be thrown away and redone as text. Comparing text directly now is strictly simpler and doesn't foreclose that later work.

No normalization (line endings, trailing whitespace) is applied before comparison — text is compared exactly as read from disk. This matches the tool's existing posture: both checkouts are assumed to come from the same repo/toolchain (the tool already never touches git state or manages checkouts, per existing non-goals), so cross-checkout line-ending drift is not a case this design needs to guard against.

### Plumbing

- **`src/analyzer.ts`** and **`src/filter.ts`** (`addContext`, which builds out-of-scope `GraphNode`s): each attaches the file's raw text to the `GraphNode` it constructs, as a new internal-only field. Out-of-scope nodes need this too, since they carry the same diff states as in-scope nodes today (`docs/architecture.md` line 76) and that doesn't change.
- The new field is **not part of the public graph schema** — it follows the existing `_oosEdges` convention (underscore-prefixed, pipeline-internal, dropped before serialization), so it never appears in `graph.json`. `src/types.ts`'s `GraphNode` type gains this internal field.
- **`src/diff-parser.ts`**: node classification (currently `diffGraphs` step 4 — "based on outgoing edges", see `docs/architecture.md` line 79) switches to comparing the internal raw-text field between the base and current node matched by `node.file`. Edge classification (steps 6–8) is untouched.
- **`src/cli.ts`**: strip the internal content field from every node before writing `graph.json`, same spirit as the existing `meta.repoRoot` strip (`docs/architecture.md` line 164).

### Docs to update

- `docs/spec.md` — rewrite the `modified` node bullet (line 58) and the "Modification is detected at the import level..." paragraph (line 67); rewrite the "File content diff" non-goal (line 117) — it's no longer a non-goal that the tool detects content changes, only that it doesn't measure *how much* changed (magnitude, tracked separately as `#27`).
- `docs/glossary.md` — wherever `modified` is defined for nodes.
- `docs/architecture.md` — `diffGraphs` algorithm description (step 4) and the "Modification is detected..." cross-reference.
- `README.md` — legend text for the amber node (currently: "File modified in this PR (its imports changed)" → becomes content-based).

### Test fixtures

The current fixtures (`fake-angular-app` / `fake-angular-app-base`) only exercise "imports changed" as the trigger for `modified`. This design needs a fixture case that's new: **a file with unchanged imports but a changed body** (e.g. a template or method-body edit with no new import). Today that case is invisible (renders `unchanged`); after this change it must render `modified`. This is the regression test that actually proves the fix, not just a passing side effect.

The existing "imports changed → modified" fixture cases should keep passing under the new logic — as established above, changing an import statement always changes the file's own text, so those cases are still correctly `modified`, just via the new mechanism rather than the old one.

## Non-goals (unaffected by this change)

- **Change magnitude** (`#27`) — this design produces a boolean (identical / not identical), not a measure of how much changed. Magnitude is a separate, already-tracked backlog item; this design's choice to store raw text (not a hash) is deliberately compatible with it but does not implement it.
- **Rename tracking** — still out of scope; a renamed file is still removed + added.
- **Git management** — still out of scope; comparing two strings in memory requires no git access, history, or checkout, consistent with the existing non-goal that the tool never touches git state.
- **Runtime dependency analysis** — unaffected.
