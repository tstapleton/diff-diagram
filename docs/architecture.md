# Architecture

Internal reference for agents and contributors. Describes the pipeline, module responsibilities, data contracts, and how to add new features.

For term definitions, see [glossary.md](./glossary.md).

## Pipeline overview

```
CLI args
  │
  ├─ analyze(baseScopeDir, { repoRoot: baseRoot }) → Graph (base)
  │    addContext(base) → Graph (base + OOS nodes)
  │
  ├─ analyze(currentScopeDir, { repoRoot }) → Graph (current)
  │    addContext(current) → Graph (current + OOS nodes)
  │
  ├─ diffGraphs(base, current) → Graph (diffed)
  │
  ├─ computeViewNodes(diffed, 'expanded') → { nodes, edges }
  │    computeLayout(nodes, edges) → Layout (expanded-mode positions)
  │
  ├─ computeViewNodes(diffed, 'focused') → { nodes, edges }
  │    computeLayout(nodes, edges) → Layout (focused-mode positions)
  │
  ├─ computeViewNodes(diffed, 'collapsed') → { nodes, edges }
  │    computeClusteredLayout(nodes, edges) → Layout (collapsed-mode positions)
  │
  ├─ toSvg(allLayout, ...) → SVG string → diagram-expanded.svg
  ├─ toSvg(diffLayout, ...) → SVG string → diagram-focused.svg (only when --base-repo-root given)
  ├─ toSvg(clusteredLayout, ...) → SVG string → diagram-collapsed.svg (always written)
  ├─ buildHtml(data, template) → HTML string → diagram.html (embeds all three modes)
  └─ graph.json
```

## Module responsibilities

### `src/types.ts`

Canonical TypeScript types shared across all modules. Always import types from here — do not redeclare.

Key types:
- `GraphNode` — `{ id, label, file, type: 'file' | 'stub' | 'directory', scope: NodeScope, diff: DiffState | null, typeOnly?: boolean, hasTests?: boolean, hasStories?: boolean, linesChanged?: number, magnitude?: number, _content?: string }` (`linesChanged`/`magnitude` are set by `diffGraphs`/`applyChangeMagnitude` — see below; `_content` is internal only — raw file text used by `diffGraphs` to detect content changes, stripped from `graph.json` before it's written). `type` is structural only — `'file'` for any real source file regardless of its Angular role, `'stub'`/`'directory'` for the rendering layer's synthesized collapsed-directory nodes; no per-role classification (component/service/pipe/etc.) is tracked, since nothing in the renderer varies by it.
- `GraphEdge` — `{ from, to, kind: EdgeKind, diff?: DiffState, importedNames?: string[], typeOnly?: boolean }`
- `Graph` — `{ meta: GraphMeta, nodes, edges, _oosEdges? }`
- `GraphMeta` — `{ scopeDir, repoRoot?: string, generatedAt, nodeCount, edgeCount }` (`scopeDir` is the JSON field name for the feature directory path)
- `DiffState` — `'added' | 'modified' | 'removed' | 'unchanged'`
- `NodeScope` — `'in-scope' | 'out-of-scope' | 'removed-ghost'`

### `src/analyzer.ts`

Runs ts-morph on a directory. Produces a `Graph` with:
- `nodes[]` — one per `.ts` file (excluding `.spec.ts`, `.stories.ts`, `.d.ts`, `node_modules`)
- `edges[]` — import edges between in-scope files
- `_oosEdges` — edges to out-of-scope files (consumed by `addContext`, then dropped)

The `analyze()` function takes:
- `scopeDir` — absolute path to the feature directory
- `options.repoRoot` — absolute path to repo root (used to compute relative file paths for node IDs)

The tsconfig is auto-detected by walking up from `scopeDir`, stopping at `repoRoot`; each analysis pass therefore resolves imports against its own checkout's tsconfig.

Exports: `analyze`, `labelFromFile`, `toNodeId`, `dedupeId`, `oosDisplayPath`

**Node ID** — derived from the file path relative to `repoRoot`, without `.ts` extension, with non-alphanumeric chars replaced by `_`, deduplicated underscores stripped.

**`dedupeId(id, sourceKey, seen)`** — this sanitization can map two distinct inputs to the same id (e.g. `user-list.component.ts` and `user.list.component.ts` both → `user_list_component`). `dedupeId` guards against that: given a `Map<id, sourceKey>` tracked by the caller across one node-construction pass, a genuine collision (same `id`, different `sourceKey`) gets a short deterministic hash of `sourceKey` appended (`_${hash.slice(0,6)}`, extending the hash length in the astronomically unlikely case that also collides). The same `sourceKey` always maps to the same id, independent of the `seen` map's prior contents, so scope-boundary checks and diffing (which matches by `node.file`, not `node.id` — see below) are unaffected. Both `analyze()` (node ids) and `computeViewNodes()` (stub ids, for the same reason — see `src/renderer/graph-helpers.ts`) use it.

**`labelFromFile`** — splits basename on `-` and `.` separators, capitalizes each part. E.g. `user-list.component.ts` → `UserListComponent`.

### `src/filter.ts`

Adds one-hop out-of-scope context to a Graph. Reads `_oosEdges`, creates `GraphNode`s with `scope: 'out-of-scope'`, and adds edges. Deduplicates edges. Clears `_oosEdges` from the result.

### `src/diff-parser.ts`

**`diffGraphs(base, current)`** — the core diff function. Compares two fully-expanded graphs (both passed through `addContext`).

Algorithm:
1. Index base and current nodes by `node.file` (repo-relative path — stable across branches)
2. Index base and current edges by `"fromFile→toFile"` key
3. Current nodes not in base → `diff: 'added'`, `linesChanged` = the file's own line count
4. Current nodes in base → `diff: 'modified'` if the node's `_content` differs from its base counterpart (else `'unchanged'`); `linesChanged` = a real line-level diff count (via the `diff` npm package's `diffLines`) between base and current content, or 0 if unchanged
5. Base in-scope nodes not in current → ghost node, `scope: 'removed-ghost'`, `diff: 'removed'`, `linesChanged` = the base file's own line count
   - Out-of-scope removed nodes are dropped (no ghost)
6. Current edges not in base → `diff: 'added'`
7. Current edges in base → compare imported-name sets: `diff: 'modified'` if the set changed, else `'unchanged'`
8. Base edges not in current → re-keyed to current/ghost node IDs, `diff: 'removed'`
9. `applyChangeMagnitude(nodes)` scales each node's `linesChanged` into `magnitude` ∈ [0, 1], relative to the 80th percentile of `linesChanged` among in-scope and removed-ghost nodes, clamping anything above that percentile to 1 (out-of-scope nodes are excluded from this computation, and never receive a `magnitude`, so an unrelated large OOS diff can't flatten every in-scope node's magnitude toward zero). Percentile-clamping, not the max, is used because a single outlier file dominating the max was found to crush most other changed files' magnitude toward zero in real PRs — see the design spec's "Revision: percentile-clamped scaling" section. With 5 or fewer eligible nodes this is identical to scaling by the max, since the 80th percentile of a small set is always its largest value.

### `src/renderer/graph-helpers.ts`

**`computeViewNodes(graph, mode)`** — produces the node and edge sets for a given view mode.

Modes:
- `'expanded'` — returns `{ nodes: graph.nodes, edges: graph.edges }` unchanged
- `'collapsed'` — delegates to `computeClusteredNodes` (same file), which collapses every subdirectory (up to 2 levels) and out-of-scope parent directory into a synthetic `type: 'directory'` node regardless of diff state — described together with `computeClusteredLayout` under `layout.ts` below, since the two were designed and documented as one feature
- `'focused'` — applies collapse rules:
  1. Group in-scope nodes by immediate subdirectory (1 level below the feature directory; `graph.meta.scopeDir` is the JSON field name)
  2. A node is `isVisible` if it changed itself (`diffPriority(n.diff) > 0`) or is touched, as either endpoint, by an edge with `diffPriority(e.diff) > 0` — either reason is independently sufficient
  3. No visible member in a group → collapse to one stub node
  4. Every member visible → group renders exactly as `'expanded'` would for it
  5. Some but not all visible ("partial") → only the visible members are shown; the rest are dropped entirely (no stand-in node) — lossless, since a hidden member has, by construction, no diff-relevant changes of its own or edges touching it. Re-run per level-2 bucket (1 level deeper) instead of flattening the whole level-1 group, so the layout's 2-level box cap (`layout.ts`'s `subdirOf`) isn't forced open by an unrelated nested subdirectory
  6. Nodes at the scope root level (no subdirectory) are always shown individually
  7. Group out-of-scope nodes by directory, capped at `OOS_GROUP_DEPTH` (3) segments below `sourceRoot` rather than each file's exact immediate parent (`oosGroupDir`) — the same `isVisible` check the in-scope loop uses (any member changed itself, or is touched by a changed edge) decides whether the group shows individually or collapses to a stub, but only rules 3/4 apply here (all-visible or none) — the partial case doesn't extend to out-of-scope grouping yet
  8. Remap edges: if a node was collapsed, redirect its edges to the stub ID; an edge touching a dropped partial member (no stub, no collapsedMap entry) is dropped instead
  9. Deduplicate edges (multiple original edges may map to the same stub→stub edge)
  10. Drop self-loops (both endpoints collapsed to the same stub)

Stub nodes have `type: 'stub'`, `diff: 'unchanged'`. They are a rendering abstraction — they represent a directory, not a real file.

### `src/renderer/layout.ts`

**`computeLayout(nodes, edges, sourceRoot?, scopeDir?)`** — async elkjs wrapper. Takes `GraphNode[]` and `GraphEdge[]`, returns `Layout` with `{ nodes: LayoutNode[], edges: LayoutEdge[], width, height, container?, subdirContainers? }`.

ELK settings: `layered` algorithm, `RIGHT` direction, 20px node spacing, 40px layer spacing. Root graph padding is `[top=20,left=20,bottom=20,right=20]`, or `[top=55,left=40,bottom=35,right=35]` when the in-scope/out-of-scope partitioning below is active (extra room for the outer container's label). Each subdirectory compound node (see below) uses its own smaller padding, `[top=16,left=6,bottom=6,right=6]`.

Node dimensions: regular nodes 140×40px, in-scope stub nodes 120×32px. An out-of-scope stub (or a Collapsed-view out-of-scope directory box) uses the regular 140×40px sizing instead of the compact stub size, since it needs room for a path subtitle the way an out-of-scope file does — see `nodeDims` in `layout.ts`.

Uses `createRequire` to import elkjs (CJS module in an ESM project).

LayoutEdge sections contain `startPoint`, `endPoint`, and optional `bendPoints` — these are the raw ELK output coordinates used for bezier path rendering.

**Subdirectory grouping (`scopeDir` parameter, issue #28):** when given, each in-scope node's first-level subdirectory under `scopeDir` becomes a real ELK compound node (`children: [...]`), instead of a flat sibling of the root graph. A node one directory deeper still (e.g. `data-access/store/user.actions.ts`) additionally nests inside a second compound node for its own subdirectory (`store`), capped at 2 levels total — deeper nesting folds into that second-level key, the same simplification the first level already makes one level up. Grouping keys reuse the same relative-path computation, extended here to the second segment (`computeViewNodes` still groups on the first segment only). ELK's hierarchical layout sizes and positions each compound node from its own children, so non-overlap between subdir boxes — including a second-level box nested inside its parent's box — is a structural guarantee, not inferred from post-layout positions. Two things this depends on:
- **Edge placement follows ELK's lowest-common-ancestor rule.** In this up-to-3-level hierarchy (root → first-level container → second-level container → file), an edge whose endpoints share both subdirectory levels is declared on the second-level container's `edges` array; an edge whose endpoints share only the first level is declared on that first-level container's `edges` array; every other edge (cross-subdirectory, touching a root-level node, or touching an out-of-scope node) is declared on the root graph's `edges` array.
- **`elk.hierarchyHandling: INCLUDE_CHILDREN`** must be set on the root graph whenever subdir groups are used, or ELK silently returns 0 sections (no routing at all) for any edge crossing a subdirectory boundary — this applies uniformly regardless of how many hierarchy levels an edge crosses.

See `docs/superpowers/specs/2026-08-06-second-level-subdir-grouping-design.md` for the second-level extension's design.

**Collapsed view mode (`computeViewNodes(graph, "collapsed")` + `computeClusteredLayout`):** a third view mode, entirely separate from the focused stub-collapsing above — it collapses every in-scope subdirectory (up to 2 levels deep, same cap) and every out-of-scope directory (grouped the same depth-capped way as Focused view's out-of-scope stubs — see above) to one synthetic `GraphNode` (`type: "directory"`), regardless of diff state, for high-level orientation on features with many files. A directory node's `diff` is `added`/`removed`/`unchanged` only when every real file it represents unanimously agrees on that state; any other mix (e.g. some added, some unchanged) is `modified` — a single added file among twenty unchanged siblings shouldn't paint the whole directory green (`graph-helpers.ts`'s `aggregateDiff`, distinct from `diffPriority`'s highest-wins reduction used for edge dedup). `computeClusteredLayout` reuses the same ELK compound/hierarchical-layout technique as the subdirectory-grouping boxes above, but a level1 directory node's own ELK node *is* the rendered box — it becomes a compound node containing its level2 child (if one exists) rather than a separate wrapper, so `draw.ts`/`renderer.html` need no rendering-code changes at all: a directory node is drawn exactly like any other node, just with `type: "directory"` instead of a real file's type. See `docs/superpowers/specs/2026-08-07-clustered-view-design.md`.

After `elk.layout()`, the result tree is flattened recursively back to absolute canvas coordinates — ELK returns each child's `x`/`y` relative to its own parent's origin, and edge sections declared on a compound node are in that same local frame, so both need the accumulated parent offset added during the walk.

An ELK-partitioning-based alternative (one partition per subdirectory, reusing the in-scope/out-of-scope partition trick below) was tried first and rejected: it only reliably orders nodes when there are 2 partitions and a guaranteed direction between them; with N independent subdirectories and no such direction, weakly-connected nodes fall back to normal longest-path layering and partition membership stops correlating with position, producing boxes that overlapped and enclosed unrelated nodes. See `docs/superpowers/specs/2026-07-30-subdir-grouping-design.md` for the full comparison.

When both in-scope and out-of-scope nodes exist, ELK partitioning is enabled for the outer container: in-scope nodes (and any subdirectory container) get partition 0, out-of-scope partition 1. This forces ELK to place in-scope content in earlier (leftward) layers than oos nodes, guaranteeing no oos node falls inside the in-scope bounding box. This part is unchanged by subdirectory grouping.

### `src/renderer/render.ts`

Canonical node/edge/marker markup builder — palette constants, `lerpHex`, `nodeColor`, `edgeStroke`, and the actual `<rect>`/`<text>`/`<path>` string templates (`renderNodeMarkup`, `renderEdgeMarkup`, `renderDiagramSvg`). Ordinary strict TypeScript, no Node APIs — `draw.ts` imports it directly, and `buildHtml` (in `cli.ts`) reads the *compiled* `dist/renderer/render.js` (type-stripped, no leftover `import`s since its only import is `import type`) and splices it verbatim into `renderer.html`'s `<script>`. This is the single source of truth for how a diagram looks; `draw.ts` and `renderer.html` no longer have independent rendering logic to keep in sync (issue #50). Because it reads compiled output rather than the `.ts` source, generating `diagram.html` requires a prior `npm run build` — same precondition `dist/cli.js`-subprocess tests already have (`src/cli.test.ts`).

**Color and magnitude:** `nodeColor(node)` returns the fixed out-of-scope palette (`OOS_FILL`/`OOS_STROKE`) for out-of-scope nodes, and — for an in-scope stub — a depth-stepped structural fill (`containerFill(node.depth)`, tiers 0–2 in `CONTAINER_FILL_BY_DEPTH`) plus the faint `CONTAINER_STROKE` rim, the same treatment `renderContainerMarkup`/`renderSubdirMarkup` give the whole-feature boundary and subdirectory group boxes (issue #90 — a filled tinted region reads as a group via Gestalt enclosure, without a contrasting border that competes with edges). A stub's `depth` is threaded from `graph-helpers.ts`'s `makeStub` call sites (`1` for a level-1 subdir, `2` for a level-2 one); a subdirectory group box's from `layout.ts`'s `LayoutSubdirContainer.depth`. For every other node, fill is `lerpHex(NODE_FILL.unchanged, NODE_FILL[diff], magnitude)` when the node has a `magnitude` (in-scope/removed-ghost changed nodes, plus collapsed-view directory nodes — see `makeDirNode` in `graph-helpers.ts`) — an sRGB per-channel lerp — else the flat diff-state fill. Stroke always stays at full diff-state intensity regardless of magnitude, so a barely-changed node's diff state is never ambiguous. No dashed borders anywhere (issue #63/#72 removed dash entirely; it previously meant two unrelated things depending on element type, and removed edges triple-encoded the same fact via color + dash + opacity).

Opacity is a separate channel from color, and nodes and edges use two different rules for it. Edge opacity: `computeChangedNodeIds(nodes)` builds the set of node ids that are "changed" — a node whose own diff state is added/modified/removed. `edgeOpacity(edge, changedIds)` renders an edge at `EDGE_OPACITY_FULL` if either endpoint is a changed node OR the edge's own diff state is added/modified/removed (covering the rare case, e.g. a barrel re-export change, where an edge's resolution changes without either endpoint file's own content changing), else `EDGE_OPACITY_DIMMED`. This is deliberately narrower than the "touched" definition below — that broader definition was tried for edge opacity first and rejected, because it over-spreads: one added/removed edge into an existing, otherwise-untouched node made every other edge on that node light up too, well beyond the actual change.

Node opacity: `computeTouchedNodeIds(nodes, edges)` builds the broader "touched" set — a node whose own diff state changed, or that is an endpoint of some *other* edge whose diff state changed (the same "touched" notion `graph-helpers.ts`'s `touchedIds`/`isVisible` use to decide Focused-view visibility). `nodeOpacity(node, touchedIds)` renders a node at `NODE_OPACITY_FULL` if it's in that set, else `NODE_OPACITY_DIMMED` — so a content-unchanged file that just gained a new caller elsewhere stays at full opacity, unlike a purely-own-diff-state rule that would dim it. Node opacity is applied via `renderNodeMarkup` as an `opacity` attribute on the outer `<g class="node-group">` wrapper, dimming the rect/text/dots as one unit. Only a genuine out-of-scope leaf file (`type: "file"`) is exempt (mirroring `nodeColor()`'s early return for out-of-scope/stub nodes, but narrower): it represents surrounding context rather than a node with a genuine diff state of its own. A collapsed directory box is never exempt just for being out-of-scope or a stub — an out-of-scope stub (Focused view) and an out-of-scope directory box (Collapsed view) both follow the same touched-based rule as any in-scope collapsed directory, since a stub's `diff` field being hardcoded `"unchanged"` is an accurate signal, not a placeholder (a directory only collapses to a stub when nothing inside it changed at either the file or edge level).

Both `computeChangedNodeIds` and `computeTouchedNodeIds` are reimplemented locally in `render.ts` rather than imported from `graph-helpers.ts`, because that module pulls in `node:path`, which would break `render.ts`'s compiled output as a plain browser `<script>` (see the file's header comment).

Edge paths are also rendered as a locally-rounded curve through ELK's bend points rather than sharp straight-line corners (`buildEdgePath`), to reduce the tracing effort of following a bent edge — this is corner-rounding, not a spline through every point, since ELK's orthogonal routing can produce very short stair-step segments that a spline's extrapolated tangents would overshoot. `layout.ts` also opens up `elk.spacing.edgeNode`/`elk.spacing.edgeEdge` beyond ELK's default, giving routed edges more room around nodes and each other. Exact hex values and every other color/width/typography decision are tracked in `docs/visual-encoding-reference.md`, the living source of truth for the rendered visual language — update it in the same PR as any rendering change rather than duplicating hex codes elsewhere.

### `src/renderer/draw.ts`

**`toSvg(layout, nodes, edges)`** — pure function, no DOM, no side effects. Merges layout positions with node/edge diff data and calls `render.ts`'s `renderDiagramSvg`. Produces an SVG string from pre-computed layout positions. Re-exports `nodeColor`, `edgeStroke`, and `lerpHex` from `render.ts` (see above) — it owns no color logic of its own.

Exports: `toSvg`, `nodeColor`, `edgeStroke`, `truncateLabel`, `lerpHex`

**`truncateLabel(label, maxWidth)`** — uses approx 7px/char at 11px monospace font, leaves 16px padding. Returns label with `…` if truncated.

### `src/renderer.html`

Browser-side thin shell. No external CDN. Reads `window.DIFF_DIAGRAM` (replaced by CLI with actual JSON).

Data structure embedded by CLI:
```typescript
{
  meta: { scopeDir, generatedAt, nodeCount, edgeCount },
  sourceRoot: string,
  initialMode?: 'expanded' | 'focused' | 'collapsed', // set to 'expanded' in single-branch mode; otherwise omitted so the template's own default ('focused') applies
  modes: {
    expanded:  { nodes: ModeNode[], edges: ModeEdge[], width, height, container?, subdirContainers? },
    focused:   { nodes: ModeNode[], edges: ModeEdge[], width, height, container?, subdirContainers? },
    collapsed: { nodes: ModeNode[], edges: ModeEdge[], width, height, container?, subdirContainers? },
  }
}
```

Where `ModeNode` augments `LayoutNode` with `{ label, type, diff, scope, file, hasTests?, hasStories?, linesChanged?, magnitude? }` and `ModeEdge` augments `LayoutEdge` with `{ diff? }`.

Client-side renderer: calls `renderDiagramSvg` from the compiled `render.js` (spliced in verbatim by `buildHtml`, replacing the `__DIFF_DIAGRAM_RENDER_JS__` placeholder ahead of `__DIFF_DIAGRAM_DATA__`) — not a hand-mirrored copy. `data-id` on node groups and `data-from`/`data-to` on edge paths (added by `render.ts`) drive hover event delegation below.

Hover: `mouseover` on `[data-id]` → connected edges keep full opacity (1), all other edges dim to opacity 0.2. `mouseleave` restores.

### `src/cli.ts`

Orchestrates the full pipeline. Entry point: `node dist/cli.js`.

Key flags: `--base-repo-root`, `--repo-root`, `--out-dir`, `--source-root`, positional `<feature-dir>`.

When `--base-repo-root` is omitted, diff mode is skipped — the CLI runs current-branch-only analysis.

Writes four or five files:
- `diagram-expanded.svg` — `toSvg(allLayout, allView.nodes, allView.edges)` — expanded, real layout. Always written.
- `diagram-collapsed.svg` — `toSvg(clusteredLayout, clusteredView.nodes, clusteredView.edges)` — collapsed, directory-only layout. Always written — directory coloring is still meaningful (all "unchanged") without a base to diff against.
- `diagram-focused.svg` — `toSvg(diffLayout, diffView.nodes, diffView.edges)` — focused, real layout. Only written when `--base-repo-root` is given.
- `diagram.html` — `src/renderer.html` with `__DIFF_DIAGRAM_RENDER_JS__` replaced by the compiled `render.js`'s source and `__DIFF_DIAGRAM_DATA__` replaced by JSON; embeds all three modes
- `graph.json` — full diffed graph without internal `_oosEdges` and without `meta.repoRoot` (an absolute local path that must not leak into output)

### `src/action/`

Packages the CLI as a GitHub composite action (`action.yml`, consumed as `tstapleton/diff-diagram@main`). The action itself is shell steps — checkout is the *consuming* workflow's job (see `docs/action-usage.yml`); this action builds and runs the CLI, uploads `diagram.html` as an unarchived workflow artifact, then runs the one step that's compiled JS: `dist/action/comment.js`.

**`comment.ts`** — the action's entry point (`node dist/action/comment.js`). Reads `GITHUB_TOKEN`/`ARTIFACT_URL`/`GRAPH_JSON` from env (set by the preceding action.yml steps), loads `graph.json`, and uses `@actions/github`'s octokit client to post a new PR comment or update an existing one.

**`comment-body.ts`** — pure, no GitHub API calls. `commentMarker(scopeDir)` returns the HTML comment embedded in the body, used both to render and to locate an existing comment to update (`findExistingCommentId`) — keyed by scope directory so multiple diagrammed directories in one PR each keep their own comment. `buildCommentBody(graph, ctx)` renders the markdown body: added/modified/removed counts for in-scope files, out-of-scope files, and imports, a changed-file list, and a link to the artifact.

## Adding a new view mode

1. Add the mode name to `computeViewNodes`'s `mode` parameter union type
2. Implement collapse/expand logic in `computeViewNodes` (return `{ nodes, edges }`)
3. Add layout + SVG generation in `src/cli.ts` (follow the existing pattern)
4. Embed the new mode's data in `diagramData.modes` in `cli.ts`
5. Add a button in `renderer.html`'s `.mode-group` and a case in `setMode()`
6. Write tests in `graph-helpers.test.ts`

## Graph node ID stability

`diffGraphs` matches nodes between base and current by `node.file` (repo-relative path), not `node.id` — see its algorithm above. This means the two analysis passes do **not** need to assign the same id to the same file; each pass's ids only need to be internally consistent (same file → same id, distinct files → distinct ids) within that pass, which `dedupeId` guarantees deterministically regardless of source-file iteration order. The id itself is derived from `path.relative(repoRoot, filePath)`, sanitized and, on collision, disambiguated by `dedupeId` (see `src/analyzer.ts`).

If a file moves (rename), `diffGraphs` treats it as removed + added. Rename tracking via git is a future enhancement.

## Test fixtures

`fixtures/integration-app/` — 80 .ts files, represents the "after PR" state.
`fixtures/integration-app-base/` — 76 .ts files, represents the "before PR" state.

Fixture diff:
- Added: `user-settings/user-security.component.ts`, `user-settings/user-notification-prefs.component.ts`, `user-settings/security-session.model.ts` (a deliberately tiny 5-line model, next to the two ~35-line components above — gives the change-magnitude gradient visible range on the `added` side); also current-only: `user-list/user-card.stories.ts` (Storybook sidecar, excluded from the graph) and `shared/services/index.ts` (out-of-scope barrel)
- Removed: `user-list/user-search-results.component.ts`
- Modified: `user-settings/user-settings.component.ts` (new imports), `user-list/users-list.component.ts` (wires up the previously-unused `SortStateService`/`sortComparator` and adds row-selection UI — a substantially larger rewrite than the other three modified files, deliberately the "hottest" node, to give the change-magnitude gradient visible range on the `modified` side), `user-detail/user-detail.component.ts` (dropped `CacheService`), `user-list/user-table-header.component.ts` (template content changed, imports unchanged — demonstrates node diff is content-based, not import-based)

Integration tests in `src/integration.test.ts` run the full analyze→addContext→diffGraphs pipeline against these fixtures and assert all 5 node diff states and 3 edge diff states.
