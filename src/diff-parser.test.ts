import { describe, it, expect } from 'vitest';
import { diffGraphs } from './diff-parser.js';
import type { GraphEdge, GraphNode } from './types.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function makeFullGraph(scopeDir: string, nodes: Partial<GraphNode>[] = [], edges: Partial<GraphEdge>[] = []) {
  return {
    meta: { repoRoot: '/repo', scopeDir, nodeCount: nodes.length, edgeCount: edges.length, generatedAt: '' },
    nodes,
    edges,
  };
}

function gNode(file: string, overrides: Record<string, unknown> = {}) {
  const id = file.replace(/\.ts$/, '').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
  return { id, label: id, file, type: 'component', scope: 'in-scope', diff: null, ...overrides };
}

function gEdge(fromFile: string, toFile: string, importedNames?: string[]) {
  const fromId = fromFile.replace(/\.ts$/, '').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
  const toId = toFile.replace(/\.ts$/, '').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
  return {
    from: fromId,
    to: toId,
    kind: 'import' as const,
    ...(importedNames ? { importedNames } : {}),
  };
}

// ─── diffGraphs ──────────────────────────────────────────────────────────────

describe('diffGraphs', () => {
  describe('node diff states', () => {
    it('marks a node in current but not base as added', () => {
      const base = makeFullGraph('src/users', []);
      const current = makeFullGraph('src/users', [gNode('src/users/foo.component.ts')]);
      const result = diffGraphs(base, current);
      expect(result.nodes[0].diff).toBe('added');
    });

    it('marks a node in base but not current as removed-ghost', () => {
      const base = makeFullGraph('src/users', [gNode('src/users/foo.component.ts')]);
      const current = makeFullGraph('src/users', []);
      const result = diffGraphs(base, current);
      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0].scope).toBe('removed-ghost');
      expect(result.nodes[0].diff).toBe('removed');
    });

    it('marks a node in both with unchanged edges as unchanged', () => {
      const n = gNode('src/users/foo.component.ts');
      const base = makeFullGraph('src/users', [n]);
      const current = makeFullGraph('src/users', [n]);
      const result = diffGraphs(base, current);
      expect(result.nodes[0].diff).toBe('unchanged');
    });

    it('marks a node as modified when an outgoing edge is added', () => {
      const foo = gNode('src/users/foo.component.ts');
      const bar = gNode('src/users/bar.component.ts');
      const base = makeFullGraph('src/users', [foo, bar], []);
      const current = makeFullGraph('src/users', [foo, bar], [gEdge('src/users/foo.component.ts', 'src/users/bar.component.ts')]);
      const result = diffGraphs(base, current);
      expect(result.nodes.find(n => n.file === 'src/users/foo.component.ts')?.diff).toBe('modified');
    });

    it('marks a node as modified when an outgoing edge is removed', () => {
      const foo = gNode('src/users/foo.component.ts');
      const bar = gNode('src/users/bar.component.ts');
      const base = makeFullGraph('src/users', [foo, bar], [gEdge('src/users/foo.component.ts', 'src/users/bar.component.ts')]);
      const current = makeFullGraph('src/users', [foo, bar], []);
      const result = diffGraphs(base, current);
      expect(result.nodes.find(n => n.file === 'src/users/foo.component.ts')?.diff).toBe('modified');
    });

    it('does not create a ghost node for a removed out-of-scope node', () => {
      const oos = gNode('src/shared/api.service.ts', { scope: 'out-of-scope' });
      const base = makeFullGraph('src/users', [oos]);
      const current = makeFullGraph('src/users', []);
      const result = diffGraphs(base, current);
      expect(result.nodes).toHaveLength(0);
    });
  });

  describe('edge diff states', () => {
    it('marks an edge in current but not base as added', () => {
      const foo = gNode('src/users/foo.component.ts');
      const bar = gNode('src/users/bar.component.ts');
      const base = makeFullGraph('src/users', [foo, bar], []);
      const current = makeFullGraph('src/users', [foo, bar], [gEdge('src/users/foo.component.ts', 'src/users/bar.component.ts')]);
      const result = diffGraphs(base, current);
      expect(result.edges[0].diff).toBe('added');
    });

    it('marks an edge in both as unchanged', () => {
      const foo = gNode('src/users/foo.component.ts');
      const bar = gNode('src/users/bar.component.ts');
      const e = gEdge('src/users/foo.component.ts', 'src/users/bar.component.ts');
      const base = makeFullGraph('src/users', [foo, bar], [e]);
      const current = makeFullGraph('src/users', [foo, bar], [e]);
      const result = diffGraphs(base, current);
      expect(result.edges[0].diff).toBe('unchanged');
    });

    it('adds a removed edge with diff: removed', () => {
      const foo = gNode('src/users/foo.component.ts');
      const bar = gNode('src/users/bar.component.ts');
      const e = gEdge('src/users/foo.component.ts', 'src/users/bar.component.ts');
      const base = makeFullGraph('src/users', [foo, bar], [e]);
      const current = makeFullGraph('src/users', [foo, bar], []);
      const result = diffGraphs(base, current);
      expect(result.edges.find(e => e.diff === 'removed')).toBeDefined();
    });

    it('includes removed edges involving ghost nodes', () => {
      const foo = gNode('src/users/foo.component.ts');
      const bar = gNode('src/users/bar.component.ts');
      const e = gEdge('src/users/foo.component.ts', 'src/users/bar.component.ts');
      const base = makeFullGraph('src/users', [foo, bar], [e]);
      const current = makeFullGraph('src/users', [foo]);
      const result = diffGraphs(base, current);
      expect(result.edges.find(e => e.diff === 'removed')).toBeDefined();
    });
  });

  describe('output shape', () => {
    it('updates meta nodeCount', () => {
      const base = makeFullGraph('src/users', []);
      const current = makeFullGraph('src/users', [gNode('src/users/foo.component.ts')]);
      const result = diffGraphs(base, current);
      expect(result.meta.nodeCount).toBe(1);
    });

    it('does not mutate input graphs', () => {
      const n = gNode('src/users/foo.component.ts');
      const base = makeFullGraph('src/users', [n]);
      const current = makeFullGraph('src/users', [n]);
      diffGraphs(base, current);
      expect(base.nodes[0].diff).toBeNull();
      expect(current.nodes[0].diff).toBeNull();
    });
  });
});

// ─── diffGraphs — edge modified state ────────────────────────────────────────

describe('diffGraphs — edge modified state', () => {
  const foo = gNode('src/users/foo.component.ts');
  const bar = gNode('src/users/bar.component.ts');

  it('edge with same importedNames in both graphs is unchanged', () => {
    const e = gEdge('src/users/foo.component.ts', 'src/users/bar.component.ts', ['A']);
    const base = makeFullGraph('src/users', [foo, bar], [e]);
    const current = makeFullGraph('src/users', [foo, bar], [e]);
    const result = diffGraphs(base, current);
    expect(result.edges[0].diff).toBe('unchanged');
  });

  it('edge with different importedNames (base [A], current [A, B]) is modified', () => {
    const eBase = gEdge('src/users/foo.component.ts', 'src/users/bar.component.ts', ['A']);
    const eCurrent = gEdge('src/users/foo.component.ts', 'src/users/bar.component.ts', ['A', 'B']);
    const base = makeFullGraph('src/users', [foo, bar], [eBase]);
    const current = makeFullGraph('src/users', [foo, bar], [eCurrent]);
    const result = diffGraphs(base, current);
    expect(result.edges[0].diff).toBe('modified');
  });

  it('edge only in current is added', () => {
    const eCurrent = gEdge('src/users/foo.component.ts', 'src/users/bar.component.ts', ['A']);
    const base = makeFullGraph('src/users', [foo, bar], []);
    const current = makeFullGraph('src/users', [foo, bar], [eCurrent]);
    const result = diffGraphs(base, current);
    expect(result.edges[0].diff).toBe('added');
  });

  it('edge only in base is removed', () => {
    const eBase = gEdge('src/users/foo.component.ts', 'src/users/bar.component.ts', ['A']);
    const base = makeFullGraph('src/users', [foo, bar], [eBase]);
    const current = makeFullGraph('src/users', [foo, bar], []);
    const result = diffGraphs(base, current);
    expect(result.edges.find(e => e.diff === 'removed')).toBeDefined();
  });

  it('node whose only outgoing edge changed importedNames gets diff modified', () => {
    const eBase = gEdge('src/users/foo.component.ts', 'src/users/bar.component.ts', ['A']);
    const eCurrent = gEdge('src/users/foo.component.ts', 'src/users/bar.component.ts', ['A', 'B']);
    const base = makeFullGraph('src/users', [foo, bar], [eBase]);
    const current = makeFullGraph('src/users', [foo, bar], [eCurrent]);
    const result = diffGraphs(base, current);
    expect(result.nodes.find(n => n.file === 'src/users/foo.component.ts')?.diff).toBe('modified');
  });
});
