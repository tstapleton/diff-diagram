import { describe, it, expect } from 'vitest';
import { computeViewNodes } from './graph-helpers.js';
import type { DiffState, Graph, GraphNode, GraphEdge } from '../types.js';

// ─── helpers ────────────────────────────────────────────────────────────────

const SCOPE = 'src/app/features/users';

function makeGraph(nodes: GraphNode[], edges: GraphEdge[] = []): Graph {
  return {
    meta: {
      scopeDir: SCOPE,
      repoRoot: '/repo',
      generatedAt: '2024-01-01T00:00:00.000Z',
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
    nodes,
    edges,
  };
}

function node(
  id: string,
  file: string,
  scope: GraphNode['scope'],
  diff: GraphNode['diff'],
): GraphNode {
  return { id, label: id, file, type: 'component', scope, diff };
}

function edge(from: string, to: string, diff?: DiffState): GraphEdge {
  return diff
    ? { from, to, kind: 'import', diff }
    : { from, to, kind: 'import' };
}

// ─── 'all' mode ─────────────────────────────────────────────────────────────

describe("computeViewNodes 'all' mode", () => {
  it('returns all nodes and edges unchanged', () => {
    const n1 = node('a', `${SCOPE}/user-list/user-card.component.ts`, 'in-scope', 'unchanged');
    const n2 = node('b', `${SCOPE}/user-list/users-list.component.ts`, 'in-scope', 'modified');
    const e1 = edge('a', 'b');
    const g = makeGraph([n1, n2], [e1]);
    const { nodes, edges } = computeViewNodes(g, 'all');
    expect(nodes).toEqual([n1, n2]);
    expect(edges).toEqual([e1]);
  });

  it('does not collapse unchanged subdirs in all mode', () => {
    const n1 = node('a', `${SCOPE}/data-access/users.service.ts`, 'in-scope', 'unchanged');
    const n2 = node('b', `${SCOPE}/data-access/users-cache.service.ts`, 'in-scope', 'unchanged');
    const g = makeGraph([n1, n2]);
    const { nodes } = computeViewNodes(g, 'all');
    expect(nodes).toHaveLength(2);
    expect(nodes.find(n => n.type === 'stub')).toBeUndefined();
  });
});

// ─── collapse rules — in-scope ───────────────────────────────────────────────

describe("computeViewNodes 'diff-focused' — in-scope collapse", () => {
  it('collapses an unchanged in-scope subdir to a stub', () => {
    const n1 = node('a', `${SCOPE}/data-access/users.service.ts`, 'in-scope', 'unchanged');
    const n2 = node('b', `${SCOPE}/data-access/users-cache.service.ts`, 'in-scope', 'unchanged');
    const g = makeGraph([n1, n2]);
    const { nodes } = computeViewNodes(g, 'diff-focused');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('stub');
    expect(nodes[0].label).toBe('data-access');
    expect(nodes[0].scope).toBe('in-scope');
    expect(nodes[0].diff).toBe('unchanged');
  });

  it('expands a subdir when any node is modified', () => {
    const n1 = node('a', `${SCOPE}/user-list/user-card.component.ts`, 'in-scope', 'unchanged');
    const n2 = node('b', `${SCOPE}/user-list/users-list.component.ts`, 'in-scope', 'modified');
    const g = makeGraph([n1, n2]);
    const { nodes } = computeViewNodes(g, 'diff-focused');
    expect(nodes).toHaveLength(2);
    expect(nodes.find(n => n.type === 'stub')).toBeUndefined();
  });

  it('expands a subdir when any node is added', () => {
    const n1 = node('a', `${SCOPE}/user-settings/user-settings.component.ts`, 'in-scope', 'unchanged');
    const n2 = node('b', `${SCOPE}/user-settings/user-security.component.ts`, 'in-scope', 'added');
    const g = makeGraph([n1, n2]);
    const { nodes } = computeViewNodes(g, 'diff-focused');
    expect(nodes).toHaveLength(2);
    expect(nodes.every(n => n.type !== 'stub')).toBe(true);
  });

  it('expands a subdir containing a removed-ghost', () => {
    const n1 = node('a', `${SCOPE}/user-list/users-list.component.ts`, 'in-scope', 'unchanged');
    const n2 = node('b', `${SCOPE}/user-list/user-search-results.component.ts`, 'removed-ghost', 'removed');
    const g = makeGraph([n1, n2]);
    const { nodes } = computeViewNodes(g, 'diff-focused');
    expect(nodes).toHaveLength(2);
    expect(nodes.find(n => n.type === 'stub')).toBeUndefined();
  });

  it('collapses multiple unchanged subdirs independently', () => {
    const n1 = node('a', `${SCOPE}/data-access/users.service.ts`, 'in-scope', 'unchanged');
    const n2 = node('b', `${SCOPE}/models/user.model.ts`, 'in-scope', 'unchanged');
    const g = makeGraph([n1, n2]);
    const { nodes } = computeViewNodes(g, 'diff-focused');
    expect(nodes).toHaveLength(2);
    expect(nodes.every(n => n.type === 'stub')).toBe(true);
    const labels = nodes.map(n => n.label).sort();
    expect(labels).toEqual(['data-access', 'models']);
  });

  it('shows root-level nodes individually even if unchanged', () => {
    const n1 = node('root', `${SCOPE}/users-page.component.ts`, 'in-scope', 'unchanged');
    const g = makeGraph([n1]);
    const { nodes } = computeViewNodes(g, 'diff-focused');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).not.toBe('stub');
    expect(nodes[0].id).toBe('root');
  });
});

// ─── collapse rules — out-of-scope ──────────────────────────────────────────

describe("computeViewNodes 'diff-focused' — out-of-scope collapse", () => {
  it('collapses an unchanged OOS parent dir to a stub', () => {
    const n1 = node('oos_a', 'src/app/shared/services/auth.service.ts', 'out-of-scope', 'unchanged');
    const n2 = node('oos_b', 'src/app/shared/services/cache.service.ts', 'out-of-scope', 'unchanged');
    const g = makeGraph([n1, n2]);
    const { nodes } = computeViewNodes(g, 'diff-focused');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('stub');
    expect(nodes[0].scope).toBe('out-of-scope');
    expect(nodes[0].label).toBe('services');
  });

  it('expands OOS group when any node is added', () => {
    const n1 = node('oos_a', 'src/app/shared/services/auth.service.ts', 'out-of-scope', 'unchanged');
    const n2 = node('oos_b', 'src/app/shared/services/analytics.service.ts', 'out-of-scope', 'added');
    const g = makeGraph([n1, n2]);
    const { nodes } = computeViewNodes(g, 'diff-focused');
    expect(nodes).toHaveLength(2);
    expect(nodes.find(n => n.type === 'stub')).toBeUndefined();
  });

  it('collapses different OOS parent dirs independently', () => {
    const n1 = node('oos_a', 'src/app/shared/services/auth.service.ts', 'out-of-scope', 'unchanged');
    const n2 = node('oos_b', 'src/app/shared/components/pagination.component.ts', 'out-of-scope', 'unchanged');
    const g = makeGraph([n1, n2]);
    const { nodes } = computeViewNodes(g, 'diff-focused');
    expect(nodes).toHaveLength(2);
    expect(nodes.every(n => n.type === 'stub')).toBe(true);
  });
});

// ─── edge preservation ────────────────────────────────────────────────────────

describe("computeViewNodes 'diff-focused' — edge preservation", () => {
  it('redirects edges from collapsed nodes to stubs', () => {
    const inNode = node('in', `${SCOPE}/user-list/users-list.component.ts`, 'in-scope', 'modified');
    const oos1 = node('oos_a', 'src/app/shared/services/auth.service.ts', 'out-of-scope', 'unchanged');
    const oos2 = node('oos_b', 'src/app/shared/services/cache.service.ts', 'out-of-scope', 'unchanged');
    const e1 = edge('in', 'oos_a');
    const e2 = edge('in', 'oos_b');
    const g = makeGraph([inNode, oos1, oos2], [e1, e2]);
    const { nodes, edges } = computeViewNodes(g, 'diff-focused');

    const stub = nodes.find(n => n.type === 'stub');
    expect(stub).toBeDefined();
    expect(edges).toHaveLength(1); // both edges dedup to one stub edge
    expect(edges[0].from).toBe('in');
    expect(edges[0].to).toBe(stub?.id);
  });

  it('deduplicates edges that collapse to the same stub→stub', () => {
    const n1 = node('a', `${SCOPE}/data-access/users.service.ts`, 'in-scope', 'unchanged');
    const n2 = node('b', `${SCOPE}/data-access/users-cache.service.ts`, 'in-scope', 'unchanged');
    const n3 = node('c', `${SCOPE}/models/user.model.ts`, 'in-scope', 'unchanged');
    const e1 = edge('a', 'c');
    const e2 = edge('b', 'c');
    const g = makeGraph([n1, n2, n3], [e1, e2]);
    const { edges } = computeViewNodes(g, 'diff-focused');
    expect(edges).toHaveLength(1); // both edges become stub_data_access → stub_models
  });

  it('removes self-loop edges when both endpoints collapse to same stub', () => {
    const n1 = node('a', `${SCOPE}/data-access/users.service.ts`, 'in-scope', 'unchanged');
    const n2 = node('b', `${SCOPE}/data-access/users-cache.service.ts`, 'in-scope', 'unchanged');
    const e = edge('a', 'b'); // both collapse to same stub
    const g = makeGraph([n1, n2], [e]);
    const { edges } = computeViewNodes(g, 'diff-focused');
    expect(edges).toHaveLength(0);
  });

  it('preserves edge diff state when remapping', () => {
    const inNode = node('in', `${SCOPE}/user-list/users-list.component.ts`, 'in-scope', 'modified');
    const oos = node('oos', 'src/app/shared/services/analytics.service.ts', 'out-of-scope', 'added');
    const e = edge('in', 'oos', 'added');
    const g = makeGraph([inNode, oos], [e]);
    const { nodes, edges } = computeViewNodes(g, 'diff-focused');
    // analytics is 'added', so its OOS group expands — no stub
    expect(nodes.find(n => n.type === 'stub')).toBeUndefined();
    expect(edges[0].diff).toBe('added');
  });
});
