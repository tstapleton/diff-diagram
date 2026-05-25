import { execSync } from 'child_process';
import { readFileSync } from 'fs';

function classifyByFilename(filePath) {
  const base = filePath.split('/').at(-1);
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

// Maps git status codes to diff states
const STATUS_MAP = {
  A: 'added',
  M: 'modified',
  D: 'removed',
  C: 'modified', // copy treated as modified for display
};

// Parse a git unified diff / format-patch string.
// Returns Map<repoRelativePath, 'added'|'modified'|'removed'>.
export function parseDiffOutput(diffStr) {
  const result = new Map();

  for (const line of diffStr.split('\n')) {
    // git diff --name-status format: "M\tpath" or "R100\told\tnew"
    const nsMatch = line.match(/^([AMDCRT])(\d*)\t(.+?)(?:\t(.+))?$/);
    if (nsMatch) {
      const [, code, , oldPath, newPath] = nsMatch;
      if (code === 'R') {
        // Rename: old path removed, new path added
        if (oldPath) result.set(normalizePath(oldPath), 'removed');
        if (newPath) result.set(normalizePath(newPath), 'added');
      } else if (STATUS_MAP[code]) {
        const p = newPath || oldPath;
        result.set(normalizePath(p), STATUS_MAP[code]);
      }
      continue;
    }

    // git unified diff / format-patch: "diff --git a/path b/path"
    const diffMatch = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (diffMatch) {
      const [, aPath, bPath] = diffMatch;
      // Status is determined by subsequent --- and +++ lines; set provisional 'modified'
      result.set(normalizePath(bPath), result.get(normalizePath(bPath)) || 'modified');
      continue;
    }

    // new file mode → added
    if (line.startsWith('new file mode')) {
      // The last diff --git entry is the added file
      const lastKey = [...result.keys()].at(-1);
      if (lastKey) result.set(lastKey, 'added');
      continue;
    }

    // deleted file mode → removed
    if (line.startsWith('deleted file mode')) {
      const lastKey = [...result.keys()].at(-1);
      if (lastKey) result.set(lastKey, 'removed');
      continue;
    }

    // rename from/to: "rename from old\nrename to new"
    const renameFrom = line.match(/^rename from (.+)$/);
    if (renameFrom) {
      // Mark old path as removed (the next "rename to" will add the new path)
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

// Parse a patch file from disk.
export function parsePatchFile(patchPath) {
  return parseDiffOutput(readFileSync(patchPath, 'utf8'));
}

// Run git diff --name-status between two refs and return the status map.
export function getDiffStatus(repoRoot, base, head = 'HEAD') {
  const out = execSync(`git -C "${repoRoot}" diff --name-status "${base}" "${head}"`, {
    encoding: 'utf8',
  });
  return parseDiffOutput(out);
}

// Overlay diff status onto a graph.
// fileStatus: Map<repoRelativePath, diffState>
// scopeDir: path of scope directory relative to repo root (e.g. "src/app/features/users")
// Adds ghost nodes for deleted in-scope files that aren't already in the graph.
export function applyDiff(graph, fileStatus, scopeDir) {
  const repoRoot = graph.meta.repoRoot;
  const nodeByFile = new Map(graph.nodes.map(n => [n.file, n]));

  // Apply diff state to existing nodes
  const updatedNodes = graph.nodes.map(n => {
    const status = fileStatus.get(n.file);
    return status ? { ...n, diff: status } : { ...n, diff: n.diff ?? 'unchanged' };
  });

  // Add nodes for files in the patch that aren't in the graph
  const ghostNodes = [];
  for (const [filePath, status] of fileStatus) {
    if (nodeByFile.has(filePath)) continue; // already present

    const inScope = filePath.startsWith(scopeDir + '/') || filePath === scopeDir;
    if (!inScope) continue;

    const base = filePath.split('/').at(-1).replace(/\.ts$/, '');
    const label = base.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
    const id = filePath.replace(/\.ts$/, '').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

    if (status === 'removed') {
      ghostNodes.push({ id, label, file: filePath, type: 'component', scope: 'removed-ghost', diff: 'removed' });
    } else if (status === 'added') {
      ghostNodes.push({ id, label, file: filePath, type: classifyByFilename(filePath), scope: 'in-scope', diff: 'added' });
    }
  }

  const allNodes = [...updatedNodes, ...ghostNodes];

  // Set unchanged diff on any node still null
  const finalNodes = allNodes.map(n => n.diff === null ? { ...n, diff: 'unchanged' } : n);

  return {
    ...graph,
    meta: { ...graph.meta, nodeCount: finalNodes.length },
    nodes: finalNodes,
    edges: graph.edges,
  };
}

function normalizePath(p) {
  return p.replace(/\\/g, '/').replace(/^\/+/, '');
}
