#!/usr/bin/env node
import path from 'path';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { analyze } from './analyzer.js';
import { addContext } from './filter.js';
import { diffGraphs } from './diff-parser.js';
import { computeViewNodes } from './renderer/graph-helpers.js';
import { computeLayout } from './renderer/layout.js';
import { toSvg } from './renderer/draw.js';
import type { Graph, GraphNode, GraphEdge } from './types.js';
import type { Layout } from './renderer/layout.js';

// ─── Args ─────────────────────────────────────────────────────────────────────

interface Args {
  baseDir: string | null;
  baseRepoRoot: string | null;
  outDir: string;
  tsConfig: string | null;
  repoRoot: string | null;
  scopeDir: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { baseDir: null, baseRepoRoot: null, outDir: 'dist', tsConfig: null, repoRoot: null, scopeDir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base-dir')        { args.baseDir      = argv[++i]; continue; }
    if (argv[i] === '--base-repo-root')  { args.baseRepoRoot = argv[++i]; continue; }
    if (argv[i] === '--out-dir')         { args.outDir       = argv[++i]; continue; }
    if (argv[i] === '--tsconfig')        { args.tsConfig     = argv[++i]; continue; }
    if (argv[i] === '--repo-root')       { args.repoRoot     = argv[++i]; continue; }
    if (!argv[i].startsWith('-'))        { args.scopeDir     = argv[i]; }
  }
  return args;
}

// ─── Repo root detection ──────────────────────────────────────────────────────

function detectRepoRoot(startDir: string): string {
  let dir = startDir;
  while (path.dirname(dir) !== dir) {
    if (existsSync(path.join(dir, '.git'))) return dir;
    dir = path.dirname(dir);
  }
  return startDir;
}

// ─── Diagram data builder ────────────────────────────────────────────────────

interface ModeData {
  nodes: Array<{ id: string; x: number; y: number; width: number; height: number; label: string; type: string; diff: string | null; scope: string }>;
  edges: Array<{ from: string; to: string; sections: Layout['edges'][number]['sections']; diff?: string }>;
  width: number;
  height: number;
}

interface DiagramData {
  meta: Omit<Graph['meta'], 'repoRoot'>;
  modes: { all: ModeData; diffFocused: ModeData };
}

function buildModeData(
  viewNodes: GraphNode[],
  viewEdges: GraphEdge[],
  layout: Layout,
): ModeData {
  const nodeById = new Map(viewNodes.map(n => [n.id, n]));
  const edgeByKey = new Map(viewEdges.map(e => [`${e.from}→${e.to}`, e]));

  const nodes = layout.nodes.map(ln => {
    const gn = nodeById.get(ln.id);
    return {
      ...ln,
      label: gn?.label ?? ln.id,
      type: gn?.type ?? 'constants',
      diff: gn?.diff ?? null,
      scope: gn?.scope ?? 'in-scope',
    };
  });

  const edges = layout.edges.map(le => {
    const ge = edgeByKey.get(`${le.from}→${le.to}`);
    return ge?.diff ? { ...le, diff: ge.diff } : { ...le };
  });

  return { nodes, edges, width: layout.width, height: layout.height };
}

// ─── HTML builder ────────────────────────────────────────────────────────────

async function buildHtml(data: DiagramData, templatePath: string): Promise<string> {
  const template = await readFile(templatePath, 'utf8');
  return template.replace('__DIFF_DIAGRAM_DATA__', JSON.stringify(data));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.scopeDir) {
    console.error('Usage: node dist/cli.js [--base-dir <path>] [--base-repo-root <path>] [--repo-root <path>] [--out-dir <dir>] [--tsconfig <file>] <scope-dir>');
    process.exit(1);
  }

  const scopeDir  = path.resolve(args.scopeDir);
  const outDir    = path.resolve(args.outDir);
  const repoRoot  = args.repoRoot ? path.resolve(args.repoRoot) : detectRepoRoot(scopeDir);

  console.log(`Analyzing ${path.relative(repoRoot, scopeDir)} ...`);
  const current = addContext(await analyze(scopeDir, { repoRoot, tsConfigPath: args.tsConfig }));
  console.log(`  ${current.nodes.filter(n => n.scope === 'in-scope').length} in-scope nodes, ${current.edges.length} edges`);
  console.log(`  +${current.nodes.filter(n => n.scope === 'out-of-scope').length} out-of-scope context nodes`);

  let diffed: Graph = current;

  if (args.baseDir) {
    const baseScopeDir = path.resolve(args.baseDir);

    // Derive base repo root: strip the same number of path segments as scopeDir is from repoRoot
    let baseRepoRoot: string;
    if (args.baseRepoRoot) {
      baseRepoRoot = path.resolve(args.baseRepoRoot);
    } else {
      const depth = path.relative(repoRoot, scopeDir).split(path.sep).length;
      baseRepoRoot = baseScopeDir;
      for (let i = 0; i < depth; i++) baseRepoRoot = path.dirname(baseRepoRoot);
    }

    console.log(`Analyzing base at ${path.relative(baseRepoRoot, baseScopeDir)} ...`);
    const base = addContext(await analyze(baseScopeDir, { repoRoot: baseRepoRoot, tsConfigPath: args.tsConfig }));
    console.log(`  ${base.nodes.filter(n => n.scope === 'in-scope').length} in-scope nodes`);

    diffed = diffGraphs(base, current);
    const added    = diffed.nodes.filter(n => n.diff === 'added').length;
    const modified = diffed.nodes.filter(n => n.diff === 'modified').length;
    const removed  = diffed.nodes.filter(n => n.diff === 'removed').length;
    console.log(`  Diff: ${added} added, ${modified} modified, ${removed} removed`);
  }

  // Compute layouts for both view modes in parallel
  console.log('Computing layouts...');
  const allView  = computeViewNodes(diffed, 'all');
  const diffView = computeViewNodes(diffed, 'diff-focused');

  const [allLayout, diffLayout] = await Promise.all([
    computeLayout(allView.nodes, allView.edges),
    computeLayout(diffView.nodes, diffView.edges),
  ]);

  await mkdir(outDir, { recursive: true });

  // diagram.svg — diff-focused, real layout
  const svg = toSvg(diffLayout, diffView.nodes, diffView.edges);
  const svgPath = path.join(outDir, 'diagram.svg');
  await writeFile(svgPath, svg);
  console.log(`Wrote ${svgPath}`);

  // diagram.html — interactive, all modes embedded
  const { repoRoot: _root, ...metaWithoutRoot } = diffed.meta;
  const diagramData: DiagramData = {
    meta: metaWithoutRoot,
    modes: {
      all:          buildModeData(allView.nodes,  allView.edges,  allLayout),
      diffFocused:  buildModeData(diffView.nodes, diffView.edges, diffLayout),
    },
  };
  const templatePath = new URL('../src/renderer.html', import.meta.url).pathname;
  const html = await buildHtml(diagramData, templatePath);
  const htmlPath = path.join(outDir, 'diagram.html');
  await writeFile(htmlPath, html);
  console.log(`Wrote ${htmlPath}`);

  // graph.json
  const { _oosEdges, ...graphOut } = diffed;
  const jsonPath = path.join(outDir, 'graph.json');
  await writeFile(jsonPath, JSON.stringify(graphOut, null, 2));
  console.log(`Wrote ${jsonPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
