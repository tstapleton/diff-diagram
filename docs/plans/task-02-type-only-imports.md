# Task 2: Type-Only Import Detection and Node Styling

## ⚠️ Important caveat before implementing

`imp.isTypeOnly()` only detects the explicit `import type { X }` syntax (TypeScript
3.8+). It does NOT detect `import { X }` where X happens to be a type alias or
interface. Most Angular codebases use the latter form. **Before implementing, check
the real codebase for `import type` usage** — if none exist, this feature is a
no-op on real code and should be deferred.

```bash
grep -r "import type" src/app/features/profile-edit --include="*.ts" | head -20
```

## Goal
Detect `import type { X }` declarations and style nodes that are reached *only*
via type-only imports differently: italic label + lighter fill (`#0d1f3c`) + dotted
border (`stroke-dasharray="4,2"`). This tells the reviewer "this is a compile-time
dependency that vanishes at runtime."

## Changes required

### 1. `src/types.ts`
Add `typeOnly?: boolean` to `GraphEdge`:
```typescript
typeOnly?: boolean;
```
Add `typeOnly?: boolean` to `GraphNode`:
```typescript
typeOnly?: boolean;
```
Add `typeOnly?: boolean` to the `_oosEdges` shape in `Graph`:
```typescript
_oosEdges?: Array<{ from: string; toFile: string; typeOnly?: boolean }>;
```

### 2. `src/analyzer.ts`

Move exclusion patterns to a named constant at the top of the file (above the
`classifyByFilename` function):
```typescript
const EXCLUDED_GLOB_PATTERNS = [
  '**/*.spec.ts',
  '**/*.stories.ts',
  '**/*.d.ts',
  '**/node_modules/**',
];
```
Use them in `addSourceFilesAtPaths`:
```typescript
project.addSourceFilesAtPaths([
  path.join(scopeDir, '**/*.ts'),
  ...EXCLUDED_GLOB_PATTERNS.map(p => `!${path.join(scopeDir, p)}`),
]);
```

In the `addEdge` helper, add a `typeOnly` parameter:
```typescript
const addEdge = (targetPath: string, names: string[] = [], typeOnly = false) => { ... }
```
When emitting `GraphEdge`: include `...(typeOnly ? { typeOnly: true } : {})`.
When pushing to `oosEdges`: include `typeOnly` too.

In the import loop:
```typescript
const isTypeOnly = imp.isTypeOnly();
```
Pass `isTypeOnly` to `addEdge` (and to the barrel-resolved calls too).
Decorator imports: always `typeOnly = false`.

Edge deduplication (combined with Task 9's importedNames merge):
- Merge importedNames by union
- Merge typeOnly with AND: `existing.typeOnly = existing.typeOnly && e.typeOnly`

After dedup, compute `node.typeOnly` for in-scope nodes: every incoming edge must
have `typeOnly === true` (and at least one edge must exist).

### 3. `src/filter.ts`

Forward `typeOnly` from `_oosEdges` entries to emitted `GraphEdge` objects.
After building context nodes, compute `node.typeOnly` for OOS nodes: every
incoming edge has `typeOnly === true`.

### 4. `src/renderer/draw.ts`

In `renderNode()`, add a `node.typeOnly` branch after the stub check, before the
isOos check:

```typescript
if (node.typeOnly) {
  const typeOnlyFill = '#0d1f3c';
  if (isOos) {
    return [
      `  <rect ... fill="${typeOnlyFill}" ... stroke-dasharray="4,2"/>`,
      `  <text ... font-style="italic">${label}</text>`,
      `  <text ... fill="${META_COLOR}">${path.dirname(node.file)}</text>`,
    ].join('\n');
  }
  const cy = ly + lh / 2 + 4;
  return [
    `  <rect ... fill="${typeOnlyFill}" ... stroke-dasharray="4,2"/>`,
    `  <text ... y="${cy}" font-style="italic">${label}</text>`,
  ].join('\n');
}
```

Note: this must be applied on top of Task 1/7/8's renderNode (which already has
the isOos and in-scope-centered branches). The typeOnly branch sits between stub
and isOos.

### 5. `src/renderer.html`

Same branching order: stub → typeOnly → isOos → default. For typeOnly:
- isOos typeOnly: dotted border, italic, dirPath subtitle, centered
- in-scope typeOnly: dotted border, italic, label at `n.y + n.height/2 + 4`

### 6. `src/cli.ts`

In `ModeData` node type: add `typeOnly?: boolean`.
In `buildModeData()`: include `...(gn?.typeOnly ? { typeOnly: true } : {})`.
Also include `file: gn?.file ?? ''` (Task 1/7/8 added this — combine both).

### 7. Tests

#### `src/analyzer.test.ts`
Fixture with `import type { X }` statement. Test:
- Edge has `typeOnly: true`
- Node reached only by type-only imports has `typeOnly: true`
- Value import: `typeOnly` absent or false

#### `src/renderer/draw.test.ts`
- Type-only node: rect has `stroke-dasharray`, label has `font-style="italic"`
- Non-type-only: neither attribute present

## Validation
- `npm test` — all tests pass
- Run CLI, check `dist/graph.json` — edges have `typeOnly: true` where expected
- Open `dist/diagram.html` — type-only nodes show dashed border + italic

## Files touched
- `src/types.ts`, `src/analyzer.ts`, `src/filter.ts`
- `src/renderer/draw.ts`, `src/renderer.html`, `src/cli.ts`
- `src/analyzer.test.ts`, `src/renderer/draw.test.ts`
