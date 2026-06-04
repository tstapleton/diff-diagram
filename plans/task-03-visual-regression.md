# Task 3: Visual Regression Tests

## Goal
Catch unintended rendering changes with pixel-level SVG snapshot tests. Uses
`resvg-js` to rasterize SVG server-side and `pixelmatch` to compare against
reference PNGs stored in git LFS.

## Tools
- `@resvg/resvg-js` — Node.js binding for resvg; renders SVG → PNG buffer
- `pixelmatch` — pixel-by-pixel PNG comparison; returns diff pixel count
- `pngjs` — encode/decode PNG buffers for pixelmatch
- Git LFS — stores binary reference PNGs without bloating git history

## Setup steps

### 1. Git LFS
```bash
git lfs install
git lfs track "test/snapshots/*.png"
git add .gitattributes
```

### 2. Package additions
```bash
npm install --save-dev @resvg/resvg-js pixelmatch pngjs
```
Add to `package.json` scripts:
```json
"test:visual": "vitest run src/renderer/visual.test.ts",
"test:visual:approve": "UPDATE_SNAPSHOTS=1 vitest run src/renderer/visual.test.ts"
```

**Do NOT add `visual.test.ts` to the normal `npm test` run.** The visual tests
are a separate gate run explicitly. The default vitest config should exclude
`src/renderer/visual.test.ts` (add it to the `exclude` list in vitest.config.ts
if one exists, or use a vitest workspace config).

### 3. Snapshot directory
`test/snapshots/` — PNG reference files tracked by git LFS.

## Test file: `src/renderer/visual.test.ts`

The test file runs the **full pipeline internally** — it does not depend on
pre-built CLI output. It calls `analyze → addContext → diffGraphs → computeLayout
→ toSvg` directly, using the fake-angular-app fixtures.

Two test cases:
1. `diff-focused mode renders correctly` — runs full pipeline with diff-focused
   layout, rasterizes the SVG, compares against `test/snapshots/diff-focused.png`
2. `all-nodes mode renders correctly` — same but all-nodes layout

No "dimensions" test — that's not a visual regression requirement.

### Update mode
When `process.env.UPDATE_SNAPSHOTS === '1'`, write the rasterized PNG to disk
instead of comparing. Run `npm run test:visual:approve` after intentional visual
changes.

### Comparison logic
```typescript
import { Resvg } from '@resvg/resvg-js';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

const SNAPSHOTS_DIR = path.resolve('test/snapshots');

function rasterize(svg: string): { data: Buffer; width: number; height: number } {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
  const rendered = resvg.render();
  return { data: rendered.asPng(), width: rendered.width, height: rendered.height };
}

function compareWithSnapshot(svg: string, name: string): number {
  const snapshotPath = path.join(SNAPSHOTS_DIR, `${name}.png`);
  const { data, width, height } = rasterize(svg);
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(snapshotPath)) {
    mkdirSync(SNAPSHOTS_DIR, { recursive: true });
    writeFileSync(snapshotPath, data);
    return 0;
  }
  const ref = PNG.sync.read(readFileSync(snapshotPath));
  const actual = PNG.sync.read(data);
  const diff = new PNG({ width, height });
  return pixelmatch(ref.data, actual.data, diff.data, width, height, { threshold: 0.1 });
}
```

Test assertion: `expect(pixelDiff).toBe(0)`.

### Full pipeline in test
```typescript
import { analyze } from '../analyzer.js';
import { addContext } from '../filter.js';
import { diffGraphs } from '../diff-parser.js';
import { computeViewNodes } from './graph-helpers.js';
import { computeLayout } from './layout.js';
import { toSvg } from './draw.js';
import path from 'path';

const REPO_ROOT = path.resolve('fake-angular-app');
const BASE_ROOT = path.resolve('fake-angular-app-base');
const SCOPE = path.resolve('fake-angular-app/src/app/features/users');
const BASE_SCOPE = path.resolve('fake-angular-app-base/src/app/features/users');

async function buildSvg(mode: 'all' | 'diff-focused'): Promise<string> {
  const [base, current] = await Promise.all([
    analyze(BASE_SCOPE, { repoRoot: BASE_ROOT }).then(addContext),
    analyze(SCOPE, { repoRoot: REPO_ROOT }).then(addContext),
  ]);
  const diffed = diffGraphs(base, current);
  const { nodes, edges } = computeViewNodes(diffed, mode);
  const layout = await computeLayout(nodes, edges);
  return toSvg(layout, nodes, edges, 'users');
}
```

## Validation
1. `npm run test:visual:approve` — generates reference PNGs
2. `npm run test:visual` — passes (0 diff pixels)
3. Make a deliberate visual change, re-run — fails with diff > 0
4. Revert, passes again

## Files touched
- `src/renderer/visual.test.ts` (new)
- `test/snapshots/diff-focused.png` (new, git LFS)
- `test/snapshots/all-nodes.png` (new, git LFS)
- `.gitattributes` (git LFS tracking rule)
- `package.json` (devDependencies + scripts)
- possibly `vitest.config.ts` or similar to exclude visual tests from normal run

## Do NOT touch
- Any existing source or test files
