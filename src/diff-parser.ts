import { classifyByFilename, labelFromFile } from './analyzer.js';
import type { Graph, GraphEdge, GraphNode, NodeType } from './types.js';

// ─── Status code mapping ──────────────────────────────────────────────────────

const STATUS_MAP: Record<string, 'added' | 'modified' | 'removed'> = {
  A: 'added',
  M: 'modified',
  D: 'removed',
  C: 'modified',
};

// ─── parseDiffOutput ──────────────────────────────────────────────────────────

export function parseDiffOutput(diffStr: string): Map<string, 'added' | 'modified' | 'removed'> {
  const result = new Map<string, 'added' | 'modified' | 'removed'>();

  for (const line of diffStr.split('\n')) {
    const nsMatch = line.match(/^([AMDCRT])(\d*)\t(.+?)(?:\t(.+))?$/);
    if (nsMatch) {
      const [, code, , oldPath, newPath] = nsMatch;
      if (code === 'R') {
        if (oldPath) result.set(normalizePath(oldPath), 'removed');
        if (newPath) result.set(normalizePath(newPath), 'added');
      } else if (STATUS_MAP[code]) {
        const p = newPath || oldPath;
        result.set(normalizePath(p), STATUS_MAP[code]);
      }
      continue;
    }

    const diffMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (diffMatch) {
      const [, , bPath] = diffMatch;
      result.set(normalizePath(bPath), result.get(normalizePath(bPath)) ?? 'modified');
      continue;
    }

    if (line.startsWith('new file mode')) {
      const lastKey = [...result.keys()].at(-1);
      if (lastKey) result.set(lastKey, 'added');
      continue;
    }

    if (line.startsWith('deleted file mode')) {
      const lastKey = [...result.keys()].at(-1);
      if (lastKey) result.set(lastKey, 'removed');
      continue;
    }

    const renameFrom = line.match(/^rename from (.+)$/);
    if (renameFrom) {
      result.set(normalizePath(renameFrom[1]), 'removed');
      continue;
    }
    const renameTo = line.match(/^rename to (.+)$/);
    if (renameTo) {
      result.set(normalizePath(renameTo[1]), 'added');
      continue;
    }
  }

  return result;
}

// ─── applyDiff ────────────────────────────────────────────────────────────────
// Overlays diff status from a patch onto a graph.
// Will be replaced by diffGraphs() in a future task once edge-level diffing lands.

export function applyDiff(
  graph: Graph,
  fileStatus: Map<string, 'added' | 'modified' | 'removed'>,
  scopeDir: string,
): Graph {
  const nodeByFile = new Map<string, GraphNode>(graph.nodes.map(n => [n.file, n]));

  const updatedNodes = graph.nodes.map(n => {
    const status = fileStatus.get(n.file);
    return status ? { ...n, diff: status } : { ...n, diff: n.diff ?? 'unchanged' };
  });

  const ghostNodes: GraphNode[] = [];
  for (const [filePath, status] of fileStatus) {
    if (!filePath.endsWith('.ts')) continue;
    if (nodeByFile.has(filePath)) continue;

    const inScope = filePath.startsWith(scopeDir + '/') || filePath === scopeDir;
    if (!inScope) continue;

    const id = filePath.replace(/\.ts$/, '').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const label = labelFromFile(filePath);
    const type: NodeType = classifyByFilename(filePath) ?? classifyByFilenameFallback(filePath);

    if (status === 'removed') {
      ghostNodes.push({ id, label, file: filePath, type, scope: 'removed-ghost', diff: 'removed' });
    } else if (status === 'added') {
      ghostNodes.push({ id, label, file: filePath, type, scope: 'in-scope', diff: 'added' });
    }
  }

  const allNodes = [...updatedNodes, ...ghostNodes];
  const finalNodes = allNodes.map(n => n.diff === null ? { ...n, diff: 'unchanged' as const } : n);

  return {
    ...graph,
    meta: { ...graph.meta, nodeCount: finalNodes.length },
    nodes: finalNodes,
    edges: graph.edges,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function classifyByFilenameFallback(filePath: string): NodeType {
  const base = filePath.split('/').at(-1) ?? '';
  if (base.endsWith('.service.ts'))   return 'service';
  if (base.endsWith('.component.ts')) return 'component';
  if (base.endsWith('.pipe.ts'))      return 'pipe';
  return 'constants';
}

// ─── diffGraphs ───────────────────────────────────────────────────────────────
// Compares two fully-expanded graphs (base vs current) and produces a single
// diffed graph where every node and edge carries a diff state.

export function diffGraphs(base: Graph, current: Graph): Graph {
  // Canonical key for a node: its file path (repo-relative, same structure in both)
  const baseByFile = new Map(base.nodes.map(n => [n.file, n]));
  const currentByFile = new Map(current.nodes.map(n => [n.file, n]));

  // Map node id → file path for edge lookups
  const baseIdToFile = new Map(base.nodes.map(n => [n.id, n.file]));
  const currentIdToFile = new Map(current.nodes.map(n => [n.id, n.file]));

  // Edge sets keyed by "fromFile→toFile" for cross-graph comparison
  const baseEdgeKeys = new Set<string>();
  for (const e of base.edges) {
    const f = baseIdToFile.get(e.from), t = baseIdToFile.get(e.to);
    if (f && t) baseEdgeKeys.add(`${f}→${t}`);
  }
  const currentEdgeKeys = new Set<string>();
  for (const e of current.edges) {
    const f = currentIdToFile.get(e.from), t = currentIdToFile.get(e.to);
    if (f && t) currentEdgeKeys.add(`${f}→${t}`);
  }

  // ── Diff nodes ────────────────────────────────────────────────────────────
  const diffedNodes: GraphNode[] = [];

  for (const node of current.nodes) {
    if (!baseByFile.has(node.file)) {
      diffedNodes.push({ ...node, diff: 'added' });
    } else {
      const baseNode = baseByFile.get(node.file)!;

      const outgoingAdded = current.edges
        .filter(e => e.from === node.id)
        .some(e => {
          const toFile = currentIdToFile.get(e.to);
          return toFile && !baseEdgeKeys.has(`${node.file}→${toFile}`);
        });

      const outgoingRemoved = base.edges
        .filter(e => e.from === baseNode.id)
        .some(e => {
          const toFile = baseIdToFile.get(e.to);
          return toFile && !currentEdgeKeys.has(`${node.file}→${toFile}`);
        });

      diffedNodes.push({ ...node, diff: outgoingAdded || outgoingRemoved ? 'modified' : 'unchanged' });
    }
  }

  // Ghost nodes for removed in-scope files (not out-of-scope — those just disappear)
  for (const node of base.nodes) {
    if (node.scope === 'out-of-scope') continue;
    if (!currentByFile.has(node.file)) {
      diffedNodes.push({ ...node, scope: 'removed-ghost', diff: 'removed' });
    }
  }

  // ── Diff edges ────────────────────────────────────────────────────────────
  const diffedEdges: GraphEdge[] = [];

  for (const e of current.edges) {
    const fromFile = currentIdToFile.get(e.from);
    const toFile = currentIdToFile.get(e.to);
    const key = fromFile && toFile ? `${fromFile}→${toFile}` : null;
    diffedEdges.push({ ...e, diff: key && baseEdgeKeys.has(key) ? 'unchanged' : 'added' });
  }

  // Removed edges: in base but not in current — rendered using current/ghost node ids
  const currentFileToId = new Map(current.nodes.map(n => [n.file, n.id]));
  const ghostFileToId = new Map(
    diffedNodes.filter(n => n.scope === 'removed-ghost').map(n => [n.file, n.id]),
  );

  for (const e of base.edges) {
    const fromFile = baseIdToFile.get(e.from);
    const toFile = baseIdToFile.get(e.to);
    if (!fromFile || !toFile) continue;
    if (currentEdgeKeys.has(`${fromFile}→${toFile}`)) continue;

    const fromId = currentFileToId.get(fromFile) ?? ghostFileToId.get(fromFile);
    const toId = currentFileToId.get(toFile) ?? ghostFileToId.get(toFile);
    if (fromId && toId) {
      diffedEdges.push({ from: fromId, to: toId, kind: e.kind, diff: 'removed' });
    }
  }

  return {
    ...current,
    meta: { ...current.meta, nodeCount: diffedNodes.length, edgeCount: diffedEdges.length },
    nodes: diffedNodes,
    edges: diffedEdges,
  };
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}
