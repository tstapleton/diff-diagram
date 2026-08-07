# Clustered view mode

## Problem

The existing "All nodes" and "Diff-focused" views both show individual files. On a feature with many files across several subdirectories, both get busy — even diff-focused mode, once more than a couple of subdirectories have any change in them, since a partially-changed subdirectory renders fully expanded (see `src/renderer/graph-helpers.ts`'s all-or-nothing collapse rule).

This adds a third view mode — **Clustered** — that shows only directories and the import relationships between them, for high-level orientation. This is the "Clustered view mode" already named in `docs/spec.md`'s Planned list ("a third view that collapses every directory to a single box regardless of diff state, for high-level orientation in large features"), refined here with diff-state coloring per directory rather than fully neutral boxes.

## Design

### Grouping and nesting depth

One synthetic node per in-scope first-level subdirectory (e.g. `data-access`), and one nested synthetic node per *its* second-level subdirectories (e.g. `data-access/store`) — same 2-level cap the box-grouping feature uses elsewhere in this codebase (`src/renderer/layout.ts`'s `computeLayout`). A file 3+ directories deep folds into its level-2 node, same simplification. Files directly in a level-1 directory (not in a further subdirectory) are absorbed into that directory's node, not shown separately. Files at the feature root (no subdirectory at all) stay as individual real nodes — consistent with the existing rule in both other view modes (`docs/spec.md`: "Nodes at the feature directory root ... are always shown individually").

Out-of-scope nodes collapse to one node per immediate parent directory (`path.dirname(node.file)`, same grouping key `computeViewNodes` already uses for its diff-focused OOS stub collapsing) — flat, no second level. OOS context is already shallow (`src/filter.ts` adds only one hop of context), so a second level there isn't worth the complexity.

### Diff coloring

Each directory node's `diff` is the *dominant* state among the real files it represents, using added > removed > modified > unchanged priority — the same `diffPriority` ordering `src/renderer/graph-helpers.ts` already uses to dedupe edges onto a stub. That local function is exported and reused here rather than duplicated, so directory-node coloring and edge-aggregation coloring share one source of truth for "which state wins."

### Data model

A new `GraphNode.type` value, `"directory"` (extending the existing `NodeType | "stub"` union to `NodeType | "stub" | "directory"`), used only for these synthetic nodes. This is deliberately not `"stub"`: `nodeColor()` in `src/renderer/draw.ts` special-cases `type === "stub"` to always render neutral gray regardless of `diff`, which is correct for today's "collapsed because fully unchanged" stubs but wrong here — a directory node needs the normal diff-colored fill/stroke path (reusing the existing `NODE_FILL`/`NODE_STROKE` palette as-is; no new colors). A `"directory"` node's `file` field is set to the directory's own repo-relative path (used for grouping/labeling, not resolved to a real file on disk).

A new `computeViewNodes` mode, `"clustered"`, builds this synthetic node list and remaps edges: an edge between two files is redirected to an edge between their directory nodes (or a directory node and a root-level file node, or two root-level file nodes — unchanged from today when neither endpoint collapses). Edges where both endpoints remap to the same directory node are dropped, same as the existing stub-collapse edge remap already does for same-stub edges. Edges are then deduplicated per `(from, to)` pair using the same dominant-priority rule, keeping them direction-sensitive (an edge `a→b` and an edge `b→a` between the same two directories, if both exist, both survive as two separate directed edges — this mirrors how real per-file edges already work, just aggregated).

### Layout and rendering

This needs new code, not a call into the existing `computeLayout(..., scopeDir)` path as-is. That path's compound-node boxes are structural *wrappers*: `subdirContainers` are drawn as an outline separate from the real leaf files laid out inside them, and the box itself carries no diff color. Here, the directory box *is* the rendered content — it needs its own fill/stroke/label, with a level-2 directory's box nested visually inside its level-1 parent's box. Reusing `computeLayout`'s contract as-is would mean drawing a redundant outline wrapper around a single synthetic leaf node, which produces two boxes for one concept.

Instead, a new function (working name `computeClusteredLayout`, in `src/renderer/layout.ts` or a new sibling file — finalized during planning) builds a 2-level ELK compound-node tree using the *same proven pattern* as the existing subdir-grouping code: a compound node per level-1 directory, containing a nested compound node per level-2 directory when one exists (an ELK compound node with zero children just becomes a plain sized box, which is exactly what a flat, no-nesting directory needs); `elk.hierarchyHandling: INCLUDE_CHILDREN` on the root graph so cross-directory edges route correctly regardless of which level either endpoint is nested at; and the same lowest-common-ancestor edge-placement rule already established (an edge goes on the deepest compound node that is an ancestor of both endpoints). What's different from the existing code is that every compound/leaf node in this tree carries diff color, sizing driven by label width like a normal node (`nodeDims`) rather than by aggregate content, and the output needs to tell `draw.ts`/`renderer.html` to render each entry as a filled, colored, labeled box rather than as a dashed outline.

Explicitly rejected: inferring level-2 position after a flat (non-hierarchical) layout, e.g. computing a level-2 bounding box from post-layout leaf positions. This is the same approach ("Option C") the original subdir-grouping design spec already tried and rejected for the same reason — on a realistic fixture it produced boxes covering up to 78% of the canvas and enclosing unrelated content, because ELK's ordinary layered algorithm doesn't keep a loosely-connected group spatially together without real hierarchical structure.

### Visual encoding

Directory nodes reuse the existing diff-state fill/stroke palette (`NODE_FILL`/`NODE_STROKE` in `draw.ts`) — no new colors. A directory node's label is just the directory's own name (last path segment), matching the label convention already used for subdir-group boxes and stubs. Exact stroke width, corner radius, and any visual cue distinguishing "this is a directory, not a file" (e.g. a folder-style label prefix) are rendering-polish decisions made during implementation, not fixed by this spec — consistent with how the original subdir-grouping spec treated equivalent visual details.

### Wiring

- `src/renderer.html`: a third mode button, "Clustered", alongside the existing "All nodes" / "Diff-focused" toggle.
- `src/cli.ts`: a third `buildModeData` call for the clustered view; `DiagramData.modes` gains a `clustered: ModeData` entry (or the type is generalized — exact shape decided at planning time).
- CLI output: a third static file, `diagram-clustered.svg`, alongside the existing `diagram-diff.svg` / `diagram-all.svg`.

### Sample fixture

No fixture change needed to demonstrate 2-level directory nesting in this view — `sample-app`'s `settings/preferences/` (added in the second-level subdirectory grouping work) already gives a level-1 directory with a nested level-2 directory. The fixture's existing diff mix should be checked during implementation to confirm at least one directory node renders in each of the colors this view can produce (added/modified/removed/unchanged as dominant states), and `docs/sample-diff.svg`/`docs/sample-all.svg`/`docs/sample-clustered.svg` (new) get regenerated together.

## Non-goals

- **More than 2 levels of directory nesting.** Same cap used throughout this codebase; a file 3+ directories deep folds into its level-2 node.
- **Per-file detail inside a directory node** (e.g. a hover tooltip listing files). Out of scope for this pass — the whole point is a zoomed-out view; a richer summary can be a follow-up if it turns out to be needed.
- **Out-of-scope directory nesting.** OOS collapses to one flat node per immediate parent directory only, no second level.
- **Changing the existing "All nodes" / "Diff-focused" modes' behavior.** This is purely additive — a third mode, not a replacement or a change to the other two.

## Open questions for the implementation plan

- Exact new-function name/location and exact `ModeData`/`DiagramData` type changes.
- Whether `draw.ts`/`renderer.html` need a shared helper for "render this as a filled directory box" or whether the existing `renderNode`-style code can be extended with a `type === "directory"` branch that reuses most of the existing in-scope-node rendering path (label + fill/stroke), since a directory node has no `typeOnly`/OOS-path/sidecar-dot concerns to special-case.
