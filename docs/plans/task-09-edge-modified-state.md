# Task 9: Edge Modified State with Symbol Tracking

## Goal
Replace naive edge presence diffing with symbol-aware diffing so edges can be
`added`, `removed`, `modified`, or `unchanged`. One rendered edge per A→B pair.
"Modified" means the import relationship exists in both base and current, but the
set of imported symbols changed.

## Problem with current state
`diffGraphs` currently keyed edges by `fromFile→toFile` presence only. Multiple
parallel import statements between the same two files (e.g. named + default) can
produce duplicate edges in the graph. There is no "modified" edge state — an edge
is either present in current (added/unchanged) or missing (removed).

## Changes required

### 1. `src/types.ts`
Add `importedNames?: string[]` to `GraphEdge`:
```typescript
export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  diff?: DiffState;
  importedNames?: string[];   // ← new
}
```

### 2. `src/analyzer.ts`
In the `addEdge` helper, collect imported symbol names and carry them on the edge.
When processing imports (after barrel resolution), call `addEdge(targetPath, names)`
where `names` is the array of named import strings for that import declaration.

For the import resolution loop:
- Non-barrel: `names = imp.getNamedImports().map(n => n.getName())` — fall back to
  `['*']` for namespace/default imports
- Barrel: per resolved named import, `names = [exportName]`

`GraphEdge` emitted from analyzer gets `importedNames: names`.

Edge deduplication at end of `analyze()`: when two edges have same from/to, merge
their `importedNames` arrays (union). Emit one edge per from/to pair.

### 3. `src/diff-parser.ts — diffGraphs()`
Change edge diff strategy:

**Current edge map key**: `fromFile→toFile` (set, no names)
**New edge map key**: `fromFile→toFile` → `Set<string>` of imported names

Build `baseEdgeNames: Map<string, Set<string>>` and `currentEdgeNames: Map<string, Set<string>>`.

For each `fromFile→toFile` pair that exists in current:
- Not in base → `diff: 'added'`
- In base, same name set → `diff: 'unchanged'`
- In base, different name set → `diff: 'modified'`

For each `fromFile→toFile` pair that exists in base but not current → `diff: 'removed'`.

One edge emitted per unique `fromFile→toFile` pair in the output graph.

Node `modified` classification: a node is `modified` if any edge from it changed
(added, removed, or modified). Update the node diffing logic accordingly.

### 4. `src/renderer/layout.ts`
The edge deduplication that already exists in `computeLayout` (seen set on from→to)
is now redundant because `diffGraphs` ensures one edge per pair. Keep it as a safety
guard but it should never fire.

### 5. Tests

#### `src/diff-parser.test.ts`
Add tests for the new `modified` edge state using fixture graphs built inline:
- Edge present in both with same names → `unchanged`
- Edge present in both, names differ (e.g. `['A']` vs `['A', 'B']`) → `modified`
- Edge only in current → `added`
- Edge only in base → `removed`
- Node with only a modified edge → node diff = `modified`

#### `src/integration.test.ts`
The barrel test `edge users-list → analytics.service is added` verifies a correctly
diffed edge — no change needed. Add one test that verifies no duplicate edges exist
in diffed output (each from→to pair appears at most once).

## Validation
- `npm test` — all tests pass
- `node dist/cli.js --base-dir fake-angular-app-base --out-dir dist fake-angular-app/src/app/features/users`
  — verify edge counts, no duplicates in dist/graph.json

## Files touched
- `src/types.ts`
- `src/analyzer.ts`
- `src/diff-parser.ts`
- `src/diff-parser.test.ts`
- `src/integration.test.ts`

## Do NOT touch
- `src/renderer/` — layout and draw are unaffected
- `src/cli.ts`
- `src/filter.ts`
