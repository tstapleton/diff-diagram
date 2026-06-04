# Task 4: Change Magnitude Styling (Lines Changed)

## Goal
Show how much a node changed, not just that it changed. Use **fill intensity**
to convey magnitude: nodes with more lines changed appear with a more vivid fill,
nodes with fewer lines changed appear with a more muted fill.

## Design

Fill intensity approach — same hue as the diff-state color, but desaturated/darker
for small changes and full-saturation for large changes:

| Lines changed | Fill style |
|---|---|
| 0 (unchanged) | existing unchanged fill (`#1e293b`) |
| 1–15 (minor) | diff color at 30% opacity blend |
| 16–50 (moderate) | diff color at 60% opacity blend |
| 51–150 (significant) | diff color at 85% opacity blend |
| 151+ (major) | diff color at full intensity (current behavior) |

Concretely: the `NODE_FILL` color for each diff state represents "major" change.
For smaller buckets, interpolate between `#1e293b` (unchanged dark) and the full
diff fill color.

Hardcode the four fill levels per diff state rather than computing at runtime:

```typescript
const NODE_FILL_MAJOR: Record<DiffState, string> = {
  added:    '#14532d',
  modified: '#78350f',
  removed:  '#7f1d1d',
  unchanged:'#1e293b',
};
const NODE_FILL_SIGNIFICANT: Record<DiffState, string> = {
  added:    '#0f3d20',
  modified: '#5a270b',
  removed:  '#5e1616',
  unchanged:'#1e293b',
};
const NODE_FILL_MODERATE: Record<DiffState, string> = {
  added:    '#092614',
  modified: '#3d1a07',
  removed:  '#3f0f0f',
  unchanged:'#1e293b',
};
const NODE_FILL_MINOR: Record<DiffState, string> = {
  added:    '#051509',
  modified: '#220e04',
  removed:  '#220808',
  unchanged:'#1e293b',
};
```

Apply magnitude only to in-scope, non-stub nodes. OOS nodes are unaffected (their
changes are not being measured). Removed-ghost nodes use the `removed` fill at
their original `linesChanged` magnitude.

## Changes required

### 1. `src/types.ts`
Add to `GraphNode`:
```typescript
lineCount?: number;     // line count in this snapshot (absent for stubs/oos)
linesChanged?: number;  // set by diffGraphs; 0 for unchanged
```

### 2. `src/analyzer.ts`
After building each in-scope node, read its line count:
```typescript
import { readFileSync } from 'fs';
// inside the in-scope node loop, after classifyFile:
const lineCount = readFileSync(fp, 'utf-8').split('\n').length;
nodes.push({ ..., lineCount });
```

### 3. `src/diff-parser.ts — diffGraphs()`
Set `linesChanged` on each diffed node:
- `added`: `linesChanged = node.lineCount ?? 0`
- `removed` ghost: `linesChanged = baseNode.lineCount ?? 0`
- `modified`: `linesChanged = Math.abs((node.lineCount ?? 0) - (baseNode.lineCount ?? 0))`
- `unchanged`: `linesChanged = 0`

### 4. `src/renderer/draw.ts`
Replace the single `NODE_FILL` lookup with a magnitude-aware function:

```typescript
function magnitudeFill(diff: DiffState, linesChanged: number | undefined): string {
  const n = linesChanged ?? 0;
  if (diff === 'unchanged' || n === 0) return NODE_FILL_MINOR[diff];
  if (n <= 15)  return NODE_FILL_MINOR[diff];
  if (n <= 50)  return NODE_FILL_MODERATE[diff];
  if (n <= 150) return NODE_FILL_SIGNIFICANT[diff];
  return NODE_FILL_MAJOR[diff];
}
```

Update `nodeColor()` to use `magnitudeFill` for in-scope nodes:
```typescript
const diff = node.diff ?? 'unchanged';
return { fill: magnitudeFill(diff, node.linesChanged), stroke: NODE_STROKE[diff] };
```

### 5. `src/renderer.html`
Add the same four fill maps as JS constants. Add `magnitudeFill(diff, linesChanged)`
function. Update `nodeFill(n)` to use it for in-scope nodes.

Include `linesChanged` in the embedded node JSON.

### 6. `src/cli.ts`
In `buildModeData()`, include `linesChanged: gn?.linesChanged` in node data.

### 7. Tests

#### `src/analyzer.test.ts`
- Node from `analyze()` has `lineCount > 0`

#### `src/diff-parser.test.ts`
- Added node: `linesChanged === node.lineCount`
- Removed ghost: `linesChanged === baseNode.lineCount`
- Modified node: `linesChanged === |current - base|`
- Unchanged: `linesChanged === 0`

#### `src/renderer/draw.test.ts`
- Node with `linesChanged: 200` gets `NODE_FILL_MAJOR` fill
- Node with `linesChanged: 5` gets `NODE_FILL_MINOR` fill
- Both tested via the fill hex value in SVG output

## Validation
- `npm test` — all tests pass
- Run CLI — inspect `dist/diagram.html`: nodes with more changes should appear more vivid

## Files touched
- `src/types.ts`, `src/analyzer.ts`, `src/diff-parser.ts`
- `src/renderer/draw.ts`, `src/renderer.html`, `src/cli.ts`
- `src/analyzer.test.ts`, `src/diff-parser.test.ts`, `src/renderer/draw.test.ts`
