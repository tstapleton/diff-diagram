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
  ├─ toSvg(diffLayout, ...) → SVG string → diagram.svg
  ├─ buildHtml(data, template) → HTML string → diagram.html
  └─ graph.json
```

## Module responsibilities

### `src/types.ts`

Canonical TypeScript types shared across all modules. Always import types from here — do not redeclare.

Key types:
- `GraphNode` — `{ id, label, file, type: NodeType | 'stub', scope: NodeScope, diff: DiffState | null, typeOnly?: boolean, hasTests?: boolean, hasStories?: boolean }`
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

Exports: `analyze`, `classifyByFilename`, `labelFromFile`, `toNodeId`, `oosDisplayPath`

**Node ID** — derived from the file path relative to `repoRoot`, without `.ts` extension, with non-alphanumeric chars replaced by `_`, deduplicated underscores stripped.

**`labelFromFile`** — splits basename on `-` and `.` separators, capitalizes each part. E.g. `user-list.component.ts` → `UserListComponent`.

### `src/filter.ts`

Adds one-hop out-of-scope context to a Graph. Reads `_oosEdges`, creates `GraphNode`s with `scope: 'out-of-scope'`, and adds edges. Deduplicates edges. Clears `_oosEdges` from the result.

### `src/diff-parser.ts`

**`diffGraphs(base, current)`** — the core diff function. Compares two fully-expanded graphs (both passed through `addContext`).

Algorithm:
1. Index base and current nodes by `node.file` (repo-relative path — stable across branches)
2. Index base and current edges by `"fromFile→toFile"` key
3. Current nodes not in base → `diff: 'added'`
4. Current nodes in base → `diff: 'modified'` if any outgoing edge was added, removed, or changed its imported-name set, else `'unchanged'`
5. Base in-scope nodes not in current → ghost node, `scope: 'removed-ghost'`, `diff: 'removed'`
   - Out-of-scope removed nodes are dropped (no ghost)
6. Current edges not in base → `diff: 'added'`
7. Current edges in base → compare imported-name sets: `diff: 'modified'` if the set changed, else `'unchanged'`
8. Base edges not in current → re-keyed to current/ghost node IDs, `diff: 'removed'`

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

**`computeLayout(nodes, edges)`** — async elkjs wrapper. Takes `GraphNode[]` and `GraphEdge[]`, returns `Layout` with `{ nodes: LayoutNode[], edges: LayoutEdge[], width, height }`.

ELK settings: `layered` algorithm, `RIGHT` direction, 20px node spacing, 40px layer spacing, 20px padding.

Node dimensions: regular nodes 140×40px, stub nodes 120×32px.

Uses `createRequire` to import elkjs (CJS module in an ESM project).

LayoutEdge sections contain `startPoint`, `endPoint`, and optional `bendPoints` — these are the raw ELK output coordinates used for bezier path rendering.

### `src/renderer/draw.ts`

**`toSvg(layout, nodes, edges)`** — pure function, no DOM, no side effects. Produces an SVG string from pre-computed layout positions.

Color scheme:
- Node fill by diff: `added=#14532d`, `modified=#78350f`, `removed=#7f1d1d`, `unchanged=#1e293b`
- Node stroke by diff: `added=#22c55e`, `modified=#f59e0b`, `removed=#ef4444`, `unchanged=#475569`
- Out-of-scope fill: `#0a1829`, stroke: `#1e3a5f`
- Stub: fill `#0f172a`, stroke `#334155`, dashed border
- Edge stroke same as node stroke; removed edges are dashed + 50% opacity

Exports: `toSvg`, `nodeColor`, `edgeStroke`, `truncateLabel`

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

Client-side renderer: builds SVG string from layout positions using the same color palette as `draw.ts`. Adds `data-id` to node groups and `data-from`/`data-to` to edge paths for hover event delegation.

Hover: `mouseover` on `[data-id]` → connected edges keep full opacity (1), all other edges dim to opacity 0.2. `mouseleave` restores.

### `src/cli.ts`

Orchestrates the full pipeline. Entry point: `node dist/cli.js`.

Key flags: `--base-repo-root`, `--repo-root`, `--out-dir`, `--source-root`, positional `<feature-dir>`.

When `--base-repo-root` is omitted, diff mode is skipped — the CLI runs current-branch-only analysis.

Writes three files:
- `diagram.svg` — `toSvg(diffLayout, diffView.nodes, diffView.edges)` — diff-focused, real layout
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

Node IDs must be stable across the base and current analysis runs so that `diffGraphs` can match them by `node.file` (not `node.id`). The ID is derived from `path.relative(repoRoot, filePath)`, which is deterministic for the same file in both base and current as long as `repoRoot` is consistent.

If a file moves (rename), `diffGraphs` treats it as removed + added. Rename tracking via git is a future enhancement.

## Test fixtures

`fake-angular-app/` — 79 .ts files, represents the "after PR" state.
`fake-angular-app-base/` — 76 .ts files, represents the "before PR" state.

Fixture diff:
- Added: `user-settings/user-security.component.ts`, `user-settings/user-notification-prefs.component.ts`; also current-only: `user-list/user-card.stories.ts` (Storybook sidecar, excluded from the graph) and `shared/services/index.ts` (out-of-scope barrel)
- Removed: `user-list/user-search-results.component.ts`
- Modified: `user-settings/user-settings.component.ts` (new imports), `user-list/users-list.component.ts` (new OOS dep `AnalyticsService`, dropped import of the removed component), `user-detail/user-detail.component.ts` (dropped `CacheService`)

Integration tests in `src/integration.test.ts` run the full analyze→addContext→diffGraphs pipeline against these fixtures and assert all 5 node diff states and 3 edge diff states.
