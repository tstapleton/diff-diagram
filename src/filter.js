import path from 'path';
import { toNodeId, labelFromFile } from './analyzer.js';

function classifyByFilename(filePath) {
  const base = path.basename(filePath);
  if (base.endsWith('.routes.ts'))      return 'routing';
  if (base.endsWith('.guard.ts'))       return 'guard';
  if (base.endsWith('.resolver.ts'))    return 'resolver';
  if (base.endsWith('.interceptor.ts')) return 'interceptor';
  if (base.endsWith('.model.ts') || base.endsWith('.interface.ts')) return 'model';
  if (base.endsWith('.service.ts'))     return 'service';
  if (base.endsWith('.component.ts'))   return 'component';
  if (base.endsWith('.pipe.ts'))        return 'pipe';
  return 'constants';
}

// Expands the in-scope graph with 1-hop out-of-scope context nodes.
// Uses _oosEdges recorded by the analyzer — no additional ts-morph resolution.
export function addContext(graph) {
  const repoRoot = graph.meta.repoRoot;
  const oosEdges = graph._oosEdges || [];

  const contextById = new Map(); // id → node (for dedup)
  const newEdges = [];

  for (const { from, toFile } of oosEdges) {
    // Skip npm packages (no absolute path on disk — ts-morph returns undefined for those)
    if (!toFile || !path.isAbsolute(toFile)) continue;

    const id = toNodeId(toFile, repoRoot);
    if (!contextById.has(id)) {
      contextById.set(id, {
        id,
        label: labelFromFile(toFile),
        file: path.relative(repoRoot, toFile),
        type: classifyByFilename(toFile),
        scope: 'out-of-scope',
        diff: null,
      });
    }

    newEdges.push({ from, to: id, kind: 'import' });
  }

  // Deduplicate new edges
  const edgeSet = new Set(graph.edges.map(e => `${e.from}→${e.to}:${e.kind}`));
  const dedupedNew = newEdges.filter(e => {
    const k = `${e.from}→${e.to}:${e.kind}`;
    return edgeSet.has(k) ? false : (edgeSet.add(k), true);
  });

  const allNodes = [...graph.nodes, ...contextById.values()];
  const allEdges = [...graph.edges, ...dedupedNew];

  return {
    ...graph,
    meta: { ...graph.meta, nodeCount: allNodes.length, edgeCount: allEdges.length },
    nodes: allNodes,
    edges: allEdges,
    _oosEdges: undefined,
  };
}
