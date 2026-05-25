#!/usr/bin/env node
import path from 'path';
import { mkdir, writeFile, readFile } from 'fs/promises';
import { analyze } from './analyzer.js';
import { addContext } from './filter.js';
import { parsePatchFile, applyDiff } from './diff-parser.js';

function parseArgs(argv) {
  const args = { patch: null, outDir: 'dist', tsConfig: null, repoRoot: null, scopeDir: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--patch')      { args.patch     = argv[++i]; continue; }
    if (argv[i] === '--out-dir')    { args.outDir    = argv[++i]; continue; }
    if (argv[i] === '--tsconfig')   { args.tsConfig  = argv[++i]; continue; }
    if (argv[i] === '--repo-root')  { args.repoRoot  = argv[++i]; continue; }
    if (!argv[i].startsWith('-'))   { args.scopeDir  = argv[i]; }
  }
  return args;
}

async function buildHtml(graphJson, rendererPath) {
  const renderer = await readFile(rendererPath, 'utf8');
  // Replace the GRAPH_DATA block with actual graph data
  return renderer.replace(
    /window\.GRAPH_DATA\s*=\s*\{[\s\S]*?\}\s*;(\s*\/\/[^\n]*)?\n(?=\n\/\/ ─── Constants)/,
    `window.GRAPH_DATA = ${JSON.stringify(graphJson, null, 2)};\n`
  );
}

async function buildSvg(graphJson) {
  // Minimal SVG: just the node list as a static fallback (no layout)
  // Full SVG generation would require running elkjs in Node — deferred to Phase 6
  const nodes = graphJson.nodes.filter(n => n.scope !== 'removed-ghost');
  const lines = nodes.map((n, i) => {
    const x = 20, y = 20 + i * 44;
    const colors = { added: '#14532d', modified: '#78350f', removed: '#7f1d1d', unchanged: '#1e293b' };
    const strokes = { added: '#22c55e', modified: '#f59e0b', removed: '#ef4444', unchanged: '#475569' };
    const fill = n.scope === 'out-of-scope' ? '#0a1829' : (colors[n.diff] || colors.unchanged);
    const stroke = n.scope === 'out-of-scope' ? '#1e3a5f' : (strokes[n.diff] || strokes.unchanged);
    return `  <rect x="${x}" y="${y}" width="240" height="34" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
  <text x="${x + 8}" y="${y + 15}" font-family="monospace" font-size="10" fill="#e2e8f0">${n.label}</text>
  <text x="${x + 8}" y="${y + 27}" font-family="monospace" font-size="8" fill="#64748b">${n.type} · ${n.diff ?? 'unchanged'}</text>`;
  });
  const h = 20 + nodes.length * 44 + 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="${h}" style="background:#0f172a">
${lines.join('\n')}
</svg>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.scopeDir) {
    console.error('Usage: node src/cli.js [--patch <file>] [--out-dir <dir>] [--tsconfig <file>] <scope-dir>');
    process.exit(1);
  }

  const scopeDir = path.resolve(args.scopeDir);
  const outDir = path.resolve(args.outDir);

  // Detect repo root: explicit flag > .git walk-up from scopeDir
  let repoRoot;
  if (args.repoRoot) {
    repoRoot = path.resolve(args.repoRoot);
  } else {
    repoRoot = scopeDir;
    let dir = scopeDir;
    while (path.dirname(dir) !== dir) {
      dir = path.dirname(dir);
      try {
        const { existsSync } = await import('fs');
        if (existsSync(path.join(dir, '.git'))) { repoRoot = dir; break; }
      } catch { /* ignore */ }
    }
  }

  console.log('Analyzing', path.relative(repoRoot, scopeDir), '...');
  let graph = await analyze(scopeDir, { repoRoot, tsConfigPath: args.tsConfig });
  console.log(`  ${graph.nodes.length} in-scope nodes, ${graph.edges.length} edges`);

  graph = addContext(graph);
  console.log(`  +${graph.nodes.filter(n => n.scope === 'out-of-scope').length} out-of-scope context nodes`);

  if (args.patch) {
    const patchPath = path.resolve(args.patch);
    const fileStatus = parsePatchFile(patchPath);
    const scopeRelative = path.relative(repoRoot, scopeDir);
    graph = applyDiff(graph, fileStatus, scopeRelative);
    const changed = graph.nodes.filter(n => n.diff !== 'unchanged').length;
    console.log(`  Patch applied: ${changed} changed nodes`);
  }

  await mkdir(outDir, { recursive: true });

  // graph.json
  const graphJson = { ...graph };
  delete graphJson.meta.repoRoot; // internal, not needed in output
  await writeFile(path.join(outDir, 'graph.json'), JSON.stringify(graphJson, null, 2));
  console.log('Wrote', path.join(outDir, 'graph.json'));

  // diagram.html — renderer with embedded data
  const rendererPath = new URL('../src/renderer.html', import.meta.url).pathname;
  const html = await buildHtml(graphJson, rendererPath);
  await writeFile(path.join(outDir, 'diagram.html'), html);
  console.log('Wrote', path.join(outDir, 'diagram.html'));

  // diagram.svg — static list (full elkjs layout in Node requires extra setup)
  const svg = await buildSvg(graphJson);
  await writeFile(path.join(outDir, 'diagram.svg'), svg);
  console.log('Wrote', path.join(outDir, 'diagram.svg'));
}

main().catch(err => { console.error(err); process.exit(1); });
