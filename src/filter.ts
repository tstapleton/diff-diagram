import path from 'path';
import { toNodeId, labelFromFile, classifyByFilename } from './analyzer.js';
import type { Graph, GraphNode, GraphEdge } from './types.js';

function classifyOutOfScope(filePath: string): GraphNode['type'] {
  const byFilename = classifyByFilename(filePath);
  if (byFilename) return byFilename;
  const base = path.basename(filePath);
  if (base.endsWith('.service.ts'))   return 'service';
  if (base.endsWith('.component.ts')) return 'component';
  if (base.endsWith('.pipe.ts'))      return 'pipe';
  return 'constants';
}

export function addContext(graph: Graph): Graph {
  const repoRoot = graph.meta.repoRoot ?? '';
  const oosEdges = graph._oosEdges ?? [];

  const contextById = new Map<string, GraphNode>();
  const newEdges: GraphEdge[] = [];

  for (const { from, toFile } of oosEdges) {
    if (!toFile || !path.isAbsolute(toFile)) continue;

    const id = toNodeId(toFile, repoRoot);
    if (!contextById.has(id)) {
      contextById.set(id, {
        id,
        label: labelFromFile(toFile),
        file: path.relative(repoRoot, toFile),
        type: classifyOutOfScope(toFile),
        scope: 'out-of-scope',
        diff: null,
      });
    }

    newEdges.push({ from, to: id, kind: 'import' });
  }

  const edgeSet = new Set<string>(graph.edges.map(e => `${e.from}→${e.to}:${e.kind}`));
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
