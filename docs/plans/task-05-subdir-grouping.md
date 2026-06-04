# Task 5: Subdirectory Grouping Inside Scope Container

## Goal
Within the in-scope container box, visually group nodes by their first-level
subdirectory under the scope dir (e.g. `user-list/`, `user-settings/`). Files
at the root of the scope dir get no group box. Deep files use only the first
segment.

## Grouping rule

Given scope dir `src/app/features/users/`:
- `src/app/features/users/user-list/user-card.component.ts` → group `user-list`
- `src/app/features/users/user-settings/user-security.component.ts` → group `user-settings`
- `src/app/features/users/user-list/detail/foo.ts` → group `user-list` (first segment only)
- `src/app/features/users/users.routes.ts` → **no group** (file is at scope root)

Compute with:
```typescript
const rel = path.relative(scopeDirAbs, path.resolve(repoRoot, node.file));
const segments = rel.split('/');
const subdir = segments.length > 1 ? segments[0] : null; // null = at scope root
```

A group box is rendered for every subdir that has ≥1 node (no minimum threshold).
Single-node groups still get a box.

## Design
- Subdir box: `fill="#0b1420"`, `stroke="#1e3a5f"`, `rx="4"`, `stroke-width="1"` (vs outer `1.5`)
- Subdir label: monospace, font-size 9, `fill="#475569"` — top-left corner of box
- Padding around nodes in subdir: 10px, 18px top (for label)
- Nodes not in any subdir (scope root files): no group box, rendered normally

## Changes required

### 1. `src/renderer/layout.ts`

Update `LayoutContainer` to include an optional label:
```typescript
export interface LayoutContainer {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
}
```

Add `subdirs` to `Layout`:
```typescript
export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  container?: LayoutContainer;
  subdirs?: Array<LayoutContainer & { label: string }>;
}
```

`computeLayout` receives `nodes: GraphNode[]` — which includes `node.file` and
`node.scope`. The scope dir is not directly available in layout, so pass it as a
parameter:

```typescript
export async function computeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  scopeDir?: string,  // optional: repo-relative scope dir path for subdir grouping
): Promise<Layout>
```

If `scopeDir` is provided, compute subdir groups. Otherwise skip.

After the existing bounding box computation for the in-scope container, compute
per-subdir bounding boxes:

```typescript
const SUB_PAD = 10;
const SUB_LABEL_H = 18;
const subdirMap = new Map<string, string[]>(); // subdir label → node ids

if (scopeDir && usePartitions) {
  for (const n of nodes) {
    if (n.scope !== 'in-scope' && n.scope !== 'removed-ghost') continue;
    const rel = n.file.startsWith(scopeDir + '/')
      ? n.file.slice(scopeDir.length + 1)
      : n.file;
    const firstSeg = rel.split('/')[0];
    const isRootFile = !rel.includes('/');
    if (isRootFile) continue;
    if (!subdirMap.has(firstSeg)) subdirMap.set(firstSeg, []);
    subdirMap.get(firstSeg)!.push(n.id);
  }
}

const subdirs: Array<LayoutContainer & { label: string }> = [];
for (const [label, ids] of subdirMap) {
  const pts = layoutNodes.filter(n => ids.includes(n.id));
  if (pts.length === 0) continue;
  const minX = Math.min(...pts.map(n => n.x));
  const minY = Math.min(...pts.map(n => n.y));
  const maxX = Math.max(...pts.map(n => n.x + n.width));
  const maxY = Math.max(...pts.map(n => n.y + n.height));
  subdirs.push({
    label,
    x: minX - SUB_PAD,
    y: minY - SUB_PAD - SUB_LABEL_H,
    width:  maxX - minX + SUB_PAD * 2,
    height: maxY - minY + SUB_PAD * 2 + SUB_LABEL_H,
  });
}
```

Return `subdirs` (empty array if none) in `Layout`.

### 2. `src/cli.ts`

Pass `scopeDir` to `computeLayout`. The scope dir value is repo-relative (matches
how `node.file` is stored). Derive it as:
```typescript
const relScopeDir = path.relative(repoRoot, scopeDir);
```
Pass to both `computeLayout` calls:
```typescript
computeLayout(allView.nodes, allView.edges, relScopeDir),
computeLayout(diffView.nodes, diffView.edges, relScopeDir),
```

Include `subdirs: layout.subdirs` in `buildModeData()` return.
Update `ModeData` type to include `subdirs?: Array<{x,y,width,height,label}>`.

### 3. `src/renderer/draw.ts`

In `toSvg()`, render subdir boxes between container rect and nodes:

```typescript
const subdirRects = (layout.subdirs ?? []).map(sd => [
  `  <rect x="${sd.x}" y="${sd.y}" width="${sd.width}" height="${sd.height}" rx="4" fill="#0b1420" stroke="#1e3a5f" stroke-width="1"/>`,
  `  <text x="${sd.x + 8}" y="${sd.y + 12}" font-family="monospace" font-size="9" fill="#475569">${sd.label}</text>`,
].join('\n'));
```

Render order: background → container → subdirRects → edges → nodes.

### 4. `src/renderer.html`

In `renderSvg()`, read `modeData.subdirs` and render the same subdir boxes.

### 5. Tests

#### `src/renderer/layout.test.ts`
- Two nodes from different subdirs (file paths like `scope/foo/a.ts`, `scope/bar/b.ts`):
  layout returns `subdirs` with 2 entries
- Node at scope root (`scope/c.ts`) is not in any subdir group
- Deep file (`scope/foo/bar/a.ts`) groups under `foo`, not `bar`
- Single node in a subdir still gets a group box

#### `src/renderer/draw.test.ts`
- When `layout.subdirs` is non-empty, SVG contains `fill="#0b1420"`

## Validation
- `npm test` — all tests pass
- Run CLI — `dist/diagram.html`: subdir boxes visible inside scope container
- Hover still works; subdir boxes are subtle background elements

## Files touched
- `src/renderer/layout.ts`, `src/renderer/draw.ts`, `src/renderer.html`, `src/cli.ts`
- `src/renderer/layout.test.ts`, `src/renderer/draw.test.ts`

## Do NOT touch
- `src/types.ts`, `src/analyzer.ts`, `src/diff-parser.ts`, `src/filter.ts`
