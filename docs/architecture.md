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
  ├─ computeViewNodes(diffed, 'all') → { nodes, edges }
  │    computeLayout(nodes, edges) → Layout (all-mode positions)
  │
  ├─ computeViewNodes(diffed, 'diff-focused') → { nodes, edges }
  │    computeLayout(nodes, edges) → Layout (diff-mode positions)
  │
  ├─ toSvg(allLayout, ...) → SVG string → diagram-all.svg
  ├─ toSvg(diffLayout, ...) → SVG string → diagram-diff.svg (only when --base-repo-root given)
  ├─ buildHtml(data, template) → HTML string → diagram.html
  └─ graph.json
```

## Module responsibilities

### `src/types.ts`

Canonical TypeScript types shared across all modules. Always import types from here — do not redeclare.

Key types:
- `GraphNode` — `{ id, label, file, type: NodeType | 'stub', scope: NodeScope, diff: DiffState | null, typeOnly?: boolean, hasTests?: boolean, hasStories?: boolean, linesChanged?: number, magnitude?: number, _content?: string }` (`linesChanged`/`magnitude` are set by `diffGraphs`/`applyChangeMagnitude` — see below; `_content` is internal only — raw file text used by `diffGraphs` to detect content changes, stripped from `graph.json` before it's written)
- `GraphEdge` — `{ from, to, kind: EdgeKind, diff?: DiffState, importedNames?: string[], typeOnly?: boolean }`
- `Graph` — `{ meta: GraphMeta, nodes, edges, _oosEdges? }`
- `GraphMeta` — `{ scopeDir, repoRoot?: string, generatedAt, nodeCount, edgeCount }` (`scopeDir` is the JSON field name for the feature directory path)
- `DiffState` — `'added' | 'modified' | 'removed' | 'unchanged'`
- `NodeScope` — `'in-scope' | 'out-of-scope' | 'removed-ghost'`
- `NodeType` — `'component' | 'service' | 'pipe' | 'guard' | 'resolver' | 'interceptor' | 'routing' | 'module' | 'model' | 'constants'` (Angular file types only; `'stub'` is a separate rendering-layer value on `GraphNode.type`)

### `src/analyzer.ts`

Runs ts-morph on a directory. Produces a `Graph` with:
- `nodes[]` — one per `.ts` file (excluding `.spec.ts`, `.stories.ts`, `.d.ts`, `node_modules`)
- `edges[]` — import edges between in-scope files
- `_oosEdges` — edges to out-of-scope files (consumed by `addContext`, then dropped)

The `analyze()` function takes:
- `scopeDir` — absolute path to the feature directory
- `options.repoRoot` — absolute path to repo root (used to compute relative file paths for node IDs)

The tsconfig is auto-detected by walking up from `scopeDir`, stopping at `repoRoot`; each analysis pass therefore resolves imports against its own checkout's tsconfig.

Exports: `analyze`, `classifyByFilename`, `labelFromFile`, `toNodeId`, `dedupeId`, `oosDisplayPath`

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
- `'all'` — returns `{ nodes: graph.nodes, edges: graph.edges }` unchanged
- `'diff-focused'` — applies collapse rules:
  1. Group in-scope nodes by immediate subdirectory (1 level below the feature directory; `graph.meta.scopeDir` is the JSON field name)
  2. If ALL nodes in a group are `unchanged` → collapse to a stub node
  3. If ANY node is `added/modified/removed` → expand the entire group individually
  4. Nodes at the scope root level (no subdirectory) are always shown individually
  5. Group out-of-scope nodes by their parent directory (1 level up from file)
  6. Same collapse logic: all-unchanged → stub
  7. Remap edges: if a node was collapsed, redirect its edges to the stub ID
  8. Deduplicate edges (multiple original edges may map to the same stub→stub edge)
  9. Drop self-loops (both endpoints collapsed to the same stub)

Stub nodes have `type: 'stub'`, `diff: 'unchanged'`. They are a rendering abstraction — they represent a directory, not a real file.

### `src/renderer/layout.ts`

**`computeLayout(nodes, edges, sourceRoot?, scopeDir?)`** — async elkjs wrapper. Takes `GraphNode[]` and `GraphEdge[]`, returns `Layout` with `{ nodes: LayoutNode[], edges: LayoutEdge[], width, height, container?, subdirContainers? }`.

ELK settings: `layered` algorithm, `RIGHT` direction, 20px node spacing, 40px layer spacing. Root graph padding is `[top=20,left=20,bottom=20,right=20]`, or `[top=55,left=40,bottom=35,right=35]` when the in-scope/out-of-scope partitioning below is active (extra room for the outer container's label). Each subdirectory compound node (see below) uses its own smaller padding, `[top=16,left=6,bottom=6,right=6]`.

Node dimensions: regular nodes 140×40px, stub nodes 120×32px.

Uses `createRequire` to import elkjs (CJS module in an ESM project).

LayoutEdge sections contain `startPoint`, `endPoint`, and optional `bendPoints` — these are the raw ELK output coordinates used for bezier path rendering.

**Subdirectory grouping (`scopeDir` parameter, issue #28):** when given, each in-scope node's first-level subdirectory under `scopeDir` becomes a real ELK compound node (`children: [...]`), instead of a flat sibling of the root graph. A node one directory deeper still (e.g. `data-access/store/user.actions.ts`) additionally nests inside a second compound node for its own subdirectory (`store`), capped at 2 levels total — deeper nesting folds into that second-level key, the same simplification the first level already makes one level up. Grouping keys reuse the same relative-path computation, extended here to the second segment (`computeViewNodes` still groups on the first segment only). ELK's hierarchical layout sizes and positions each compound node from its own children, so non-overlap between subdir boxes — including a second-level box nested inside its parent's box — is a structural guarantee, not inferred from post-layout positions. Two things this depends on:
- **Edge placement follows ELK's lowest-common-ancestor rule.** In this up-to-3-level hierarchy (root → first-level container → second-level container → file), an edge whose endpoints share both subdirectory levels is declared on the second-level container's `edges` array; an edge whose endpoints share only the first level is declared on that first-level container's `edges` array; every other edge (cross-subdirectory, touching a root-level node, or touching an out-of-scope node) is declared on the root graph's `edges` array.
- **`elk.hierarchyHandling: INCLUDE_CHILDREN`** must be set on the root graph whenever subdir groups are used, or ELK silently returns 0 sections (no routing at all) for any edge crossing a subdirectory boundary — this applies uniformly regardless of how many hierarchy levels an edge crosses.

See `docs/superpowers/specs/2026-08-06-second-level-subdir-grouping-design.md` for the second-level extension's design.

**Clustered view mode (`computeViewNodes(graph, "clustered")` + `computeClusteredLayout`):** a third view mode, entirely separate from the diff-focused stub-collapsing above — it collapses every in-scope subdirectory (up to 2 levels deep, same cap) and every out-of-scope parent directory to one synthetic `GraphNode` (`type: "directory"`), regardless of diff state, for high-level orientation on features with many files. A directory node's `diff` is the dominant state among every real file it represents (added > removed > modified > unchanged priority, `graph-helpers.ts`'s exported `diffPriority`). `computeClusteredLayout` reuses the same ELK compound/hierarchical-layout technique as the subdirectory-grouping boxes above, but a level1 directory node's own ELK node *is* the rendered box — it becomes a compound node containing its level2 child (if one exists) rather than a separate wrapper, so `draw.ts`/`renderer.html` need no rendering-code changes at all: a directory node is drawn exactly like any other node, just with `type: "directory"` instead of a real file's type. See `docs/superpowers/specs/2026-08-07-clustered-view-design.md`.

After `elk.layout()`, the result tree is flattened recursively back to absolute canvas coordinates — ELK returns each child's `x`/`y` relative to its own parent's origin, and edge sections declared on a compound node are in that same local frame, so both need the accumulated parent offset added during the walk.

An ELK-partitioning-based alternative (one partition per subdirectory, reusing the in-scope/out-of-scope partition trick below) was tried first and rejected: it only reliably orders nodes when there are 2 partitions and a guaranteed direction between them; with N independent subdirectories and no such direction, weakly-connected nodes fall back to normal longest-path layering and partition membership stops correlating with position, producing boxes that overlapped and enclosed unrelated nodes. See `docs/superpowers/specs/2026-07-30-subdir-grouping-design.md` for the full comparison.

When both in-scope and out-of-scope nodes exist, ELK partitioning is enabled for the outer container: in-scope nodes (and any subdirectory container) get partition 0, out-of-scope partition 1. This forces ELK to place in-scope content in earlier (leftward) layers than oos nodes, guaranteeing no oos node falls inside the in-scope bounding box. This part is unchanged by subdirectory grouping.

### `src/renderer/draw.ts`

**`toSvg(layout, nodes, edges)`** — pure function, no DOM, no side effects. Produces an SVG string from pre-computed layout positions.

Color scheme:
- Node fill by diff: `added=#14532d`, `modified=#78350f`, `removed=#7f1d1d`, `unchanged=#1e293b`
- Node stroke by diff: `added=#22c55e`, `modified=#f59e0b`, `removed=#ef4444`, `unchanged=#475569`
- Out-of-scope fill: `#0a1829`, stroke: `#1e3a5f`
- Stub: fill `#0f172a`, stroke `#334155`, dashed border
- Edge stroke same as node stroke; removed edges are dashed + 50% opacity
- **Change magnitude:** when a node has a `magnitude` (in-scope and removed-ghost changed nodes — see `diffGraphs` above), its fill is `lerpHex(unchangedFill, diffStateFill, magnitude)` — an sRGB per-channel lerp — instead of the flat diff-state fill. Stroke is unaffected by magnitude; it always renders at full diff-state intensity, so even a barely-changed node's diff state stays unambiguous.

Exports: `toSvg`, `nodeColor`, `edgeStroke`, `truncateLabel`, `lerpHex`

**`truncateLabel(label, maxWidth)`** — uses approx 7px/char at 11px monospace font, leaves 16px padding. Returns label with `…` if truncated.

### `src/renderer.html`

Browser-side thin shell. No external CDN. Reads `window.DIFF_DIAGRAM` (replaced by CLI with actual JSON).

Data structure embedded by CLI:
```typescript
{
  meta: { scopeDir, generatedAt, nodeCount, edgeCount },
  modes: {
    all:          { nodes: ModeNode[], edges: ModeEdge[], width, height },
    diffFocused:  { nodes: ModeNode[], edges: ModeEdge[], width, height },
  }
}
```

Where `ModeNode` augments `LayoutNode` with `{ label, type, diff, scope }` and `ModeEdge` augments `LayoutEdge` with `{ diff? }`.

Client-side renderer: builds SVG string from layout positions using the same color palette and magnitude-fill logic (`lerpHex`, mirrored from `draw.ts`) as `draw.ts`. Adds `data-id` to node groups and `data-from`/`data-to` to edge paths for hover event delegation.

Hover: `mouseover` on `[data-id]` → connected edges keep full opacity (1), all other edges dim to opacity 0.2. `mouseleave` restores.

### `src/cli.ts`

Orchestrates the full pipeline. Entry point: `node dist/cli.js`.

Key flags: `--base-repo-root`, `--repo-root`, `--out-dir`, `--source-root`, positional `<feature-dir>`.

When `--base-repo-root` is omitted, diff mode is skipped — the CLI runs current-branch-only analysis.

Writes three or four files:
- `diagram-all.svg` — `toSvg(allLayout, allView.nodes, allView.edges)` — all-nodes, real layout. Always written.
- `diagram-diff.svg` — `toSvg(diffLayout, diffView.nodes, diffView.edges)` — diff-focused, real layout. Only written when `--base-repo-root` is given.
- `diagram.html` — `src/renderer.html` with `__DIFF_DIAGRAM_DATA__` replaced by JSON
- `graph.json` — full diffed graph without internal `_oosEdges` and without `meta.repoRoot` (an absolute local path that must not leak into output)

## Adding a new view mode

1. Add the mode name to `computeViewNodes`'s `mode` parameter union type
2. Implement collapse/expand logic in `computeViewNodes` (return `{ nodes, edges }`)
3. Add layout + SVG generation in `src/cli.ts` (follow the existing pattern)
4. Embed the new mode's data in `diagramData.modes` in `cli.ts`
5. Add a button in `renderer.html`'s `.mode-group` and a case in `setMode()`
6. Write tests in `graph-helpers.test.ts`

## Adding a new node type

1. Add to `NodeType` union in `src/types.ts` (note: `'stub'` is a rendering-layer sentinel on `GraphNode.type` and is intentionally not in `NodeType`)
2. Handle classification in `src/analyzer.ts` `classifyFile()` and/or `classifyByFilename()`
3. Add color logic in `src/renderer/draw.ts` `nodeColor()` (currently all types share diff-state colors; add a special case if needed)
4. Update `src/renderer.html` client-side colors if they diverge from `draw.ts`

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
