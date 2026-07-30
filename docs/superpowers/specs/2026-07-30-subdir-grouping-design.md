# Subdirectory grouping inside scope container

## Problem

[Issue #28](https://github.com/tstapleton/diff-diagram/issues/28): within the in-scope container box, visually group nodes by their first-level subdirectory under the scope dir (e.g. `user-list/`, `user-settings/`). Each group renders as a subtle background rect with a label. Files at the scope root get no group box.

The issue was originally deferred because ELK's layered algorithm doesn't guarantee nodes from the same subdirectory land near each other spatially — it optimizes for minimal edge crossings, so bounding boxes computed from final node positions overlapped or merged into the outer container.

## Options considered (spiked before writing this spec)

- **Option A — ELK compound/hierarchical layout.** Model each subdirectory as a real ELK compound node containing its files. **Chosen.**
- **Option B — two-pass layout.** Lay out subdirs as units, then lay out each subdir's contents, compose positions. Not attempted — A was validated first and worked.
- **Option C — ELK partitioning per subdir.** Extend the existing in-scope/oos partition trick to one partition per subdir, then compute a bounding box from final positions (same technique as the existing outer container). **Tried first and rejected**: on the fake-angular-app fixture (9 subdirs, real cross-subdir dependencies), resulting boxes covered up to 78% of the canvas width and routinely enclosed unrelated nodes from other groups. It broke even in the simplest case — an orphan node with zero in-scope edges landed in a completely different column than its own sibling. Root cause: ELK's partition constraint only reliably dominates layer assignment with 2 partitions and one guaranteed direction between them (in-scope → oos); with N independent partitions and no such direction, weakly-connected nodes fall back to normal longest-path layering and partition membership stops correlating with position.
- **Option D — label-only, no boxes.** Rejected per user: a real bounding box is a correctness requirement ("a file is only in one directory... boxes should not be overlapping"), not a nice-to-have; a label-only treatment doesn't communicate that same-directory grouping.

## Design

### Why Option A is correct where C wasn't

ELK's hierarchical layout makes non-overlap a *structural* guarantee rather than an inferred one. A compound node's children are laid out in their own recursive sub-layout; the compound node is then sized to fit them and treated as one opaque box among its siblings at the parent level. A child cannot end up outside its parent's box, because the parent's box is computed *from* its children's final positions — this is true regardless of edge direction or connectivity between groups, which is exactly the class of case that broke Option C.

This was verified on both fixtures after implementation: zero box overlaps (checked pairwise across all 9 subdirs in fake-angular-app, and the 2-subdir sample-app fixture), including the orphan-node case that broke C.

### Layout model (`src/renderer/layout.ts`)

`computeLayout(nodes, edges, sourceRoot, scopeDir?)` gains a 4th optional parameter, `scopeDir` (repo-relative path, same value as `graph.meta.scopeDir`). Omitting it reproduces today's flat-layout behavior exactly — this is what all existing callers/tests do, so the change is additive only.

When `scopeDir` is given:

1. Each in-scope node's first-level subdirectory is computed the same way `computeViewNodes` already does (`path.relative(scopeDir, node.file)`, first path segment). Files directly at the scope root get key `""` and are never boxed, matching the issue's spec. A file nested two-or-more directories deep still groups under its first-level subdir (e.g. `settings/preferences/x.ts` groups under `settings`) — this is a deliberate simplification; deeper per-level nesting is not attempted.
2. One ELK compound node is created per subdirectory key (`children: [...]` = that subdirectory's nodes), alongside root-level file nodes and out-of-scope nodes as flat siblings of the root graph — same shape as today, just with subdir nodes now wrapped.
3. **Edge placement (LCA rule):** ELK requires an edge to be declared on the graph node that is the lowest common ancestor of its endpoints. With a 2-level hierarchy (root → subdir container → file) this reduces to: an edge whose endpoints share the same subdirectory goes on that subdirectory's own `edges` array; every other edge (cross-subdirectory, touching a root-level node, or touching an out-of-scope node) goes on the root graph's `edges` array.
4. **`elk.hierarchyHandling: INCLUDE_CHILDREN`** must be set on the root graph whenever subdir groups are in use. Without it, ELK treats each compound subgraph as an independent, isolated layout run and silently fails to route any edge crossing a subdirectory boundary (0 sections returned — nothing drawn). This was caught during spiking: the sample diagram was initially missing the edge from the feature's root component into a newly-added subdirectory file. Discovered by inspecting `layout.edges` directly (section count) rather than guessing from the rendering.
5. After `elk.layout()`, the result tree (at most 2 levels deep, given (3)) is flattened recursively back to absolute canvas coordinates: ELK returns each child's `x`/`y` relative to its immediate parent's own origin, and edge sections declared on a compound node are in that same local frame, so both need the accumulated parent offset added during the walk.
6. The existing in-scope/out-of-scope partitioning and outer container-box computation are unchanged — they operate on the flattened absolute node positions exactly as before, so nothing about the outer box's behavior changes.

`Layout` gains an optional `subdirContainers: LayoutSubdirContainer[]` field (`{ x, y, width, height, label }`), one entry per subdirectory that has at least one member, populated directly from each compound node's own ELK-computed size and position (no ad-hoc bounding-box math needed, unlike the rejected Option C).

### Rendering

Both rendering paths need the same treatment — the project intentionally keeps `src/renderer/draw.ts` (server-side SVG) and `src/renderer.html` (client-side interactive HTML) as parallel, non-shared implementations (see `docs/architecture.md`); this feature is not an exception.

- **`draw.ts`**: draw one subtle dashed rect + small label per entry in `layout.subdirContainers`, before edges/nodes, after the outer container rect.
- **`src/cli.ts`**: `computeLayout` calls gain `diffed.meta.scopeDir` as the 4th argument (both `all` and `diff-focused` views). `ModeData`/`buildModeData` gains `subdirContainers` so the HTML-embedded JSON carries it.
- **`renderer.html`**: `renderSvg()` reads `subdirContainers` from the mode data and renders the same rect+label treatment as `draw.ts`, using the same style constants.

### Visual style

Match the existing outer container's visual language but subordinate to it: smaller label font, a more subdued stroke color, dashed rather than solid, so nesting reads as "grouping within the feature," not a second feature boundary. Exact values (color, padding, label font size) are a rendering-polish decision made during implementation/PR review, not fixed by this spec — the spike used `stroke: #2d3f5c`, dashed, 8px label as a starting point.

### Sample fixture change

`sample-app`'s `dashboard` feature (used by `npm run diagram:sample` / `docs/sample.svg`) is currently flat (no subdirectories), so it can't demonstrate this feature. It's restructured to:

- 3 files at the feature root (`dashboard.component.ts`, `dashboard-stats.component.ts`, and `dashboard-nav.component.ts` — the last existing only in the base branch, rendering as a removed ghost)
- `widgets/` — 2 files at its root (`dashboard-card.component.ts`, `dashboard-chart.component.ts`, both added)
- `settings/` — 1 file at its root (`dashboard-settings.component.ts`, added) plus a nested `settings/preferences/dashboard-notification-prefs.component.ts` (added), which exercises the "nested two levels deep still groups under the first-level subdir" case.

`sample-app-base` is untouched except deleting its root-level `dashboard-card.component.ts`, so `dashboard-card` becomes a clean "added" file at its new path rather than registering as a spurious move (remove at old path + add at new path — `diffGraphs` matches by exact file path, so relocating a file without a matching base-side move always reads as remove+add; that's expected/documented `diffGraphs` behavior, not something this feature changes).

## Non-goals

- **Deeper hierarchical grouping** (a box per nested subdirectory level, not just the first). Out of scope per the issue; first-level-only matches what was asked for.
- **Changing `renderer.html`'s and `draw.ts`'s shared-code structure.** They stay intentionally parallel implementations, consistent with the rest of the codebase.
- **Compound layout for anything other than subdir grouping** (e.g. modeling the whole in-scope/oos split as compound nodes too). The existing partition-based outer container is untouched and works fine as-is.

## Test fixtures

`fake-angular-app` / `fake-angular-app-base` already have real first-level subdirectories (`user-list/`, `user-settings/`, `data-access/`, etc. — 9 total) with genuine cross-subdirectory dependencies in both directions, so the existing integration fixtures exercise this feature for free once `computeLayout` is wired to receive `scopeDir` in `cli.ts` — no fixture change needed there. `sample-app` needed the restructuring above because it was flat.
