import { classifyByFilename, labelFromFile } from './analyzer.js';
import type { Graph, GraphNode, NodeType } from './types.js';

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

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}
