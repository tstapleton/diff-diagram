import { describe, it, expect } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { analyze } from '../analyzer.js';
import { addContext } from '../filter.js';
import { diffGraphs } from '../diff-parser.js';
import { computeViewNodes } from './graph-helpers.js';
import { computeLayout } from './layout.js';
import { toSvg } from './draw.js';

const SNAPSHOTS_DIR = path.resolve('test/snapshots');
const REPO_ROOT = path.resolve('fake-angular-app');
const BASE_ROOT = path.resolve('fake-angular-app-base');
const SCOPE = path.resolve('fake-angular-app/src/app/features/users');
const BASE_SCOPE = path.resolve('fake-angular-app-base/src/app/features/users');

function rasterize(svg: string): { data: Buffer; width: number; height: number } {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
  const rendered = resvg.render();
  return { data: Buffer.from(rendered.asPng()), width: rendered.width, height: rendered.height };
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

async function buildSvg(mode: 'all' | 'diff-focused'): Promise<string> {
  const [base, current] = await Promise.all([
    analyze(BASE_SCOPE, { repoRoot: BASE_ROOT }).then(addContext),
    analyze(SCOPE, { repoRoot: REPO_ROOT }).then(addContext),
  ]);
  const diffed = diffGraphs(base, current);
  const { nodes, edges } = computeViewNodes(diffed, mode === 'diff-focused' ? 'diff-focused' : 'all');
  const layout = await computeLayout(nodes, edges, 'src/app');
  return toSvg(layout, nodes, edges, 'users', 'src/app');
}

describe('visual regression', () => {
  it('diff-focused mode renders correctly', async () => {
    const svg = await buildSvg('diff-focused');
    const diff = compareWithSnapshot(svg, 'diff-focused');
    expect(diff).toBe(0);
  });

  it('all-nodes mode renders correctly', async () => {
    const svg = await buildSvg('all');
    const diff = compareWithSnapshot(svg, 'all-nodes');
    expect(diff).toBe(0);
  });
});
