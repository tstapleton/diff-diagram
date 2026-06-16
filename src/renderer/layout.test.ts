import { describe, it, expect } from 'vitest';
import { computeLayout } from './layout.js';
import type { GraphNode, GraphEdge } from '../types.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function node(id: string, type: GraphNode['type'] = 'component'): GraphNode {
  return { id, label: id, file: `${id}.ts`, type, scope: 'in-scope', diff: 'unchanged' };
}

function edge(from: string, to: string): GraphEdge {
  return { from, to, kind: 'import' };
}

// ─── ELK input construction ──────────────────────────────────────────────────

describe('computeLayout — ELK input construction', () => {
  it('assigns positions to all nodes', async () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('a', 'b'), edge('b', 'c')];
    const layout = await computeLayout(nodes, edges);
    expect(layout.nodes).toHaveLength(3);
    for (const n of layout.nodes) {
      expect(typeof n.x).toBe('number');
      expect(typeof n.y).toBe('number');
      expect(n.width).toBeGreaterThan(0);
      expect(n.height).toBeGreaterThan(0);
    }
  });

  it('assigns smaller dimensions to stub nodes', async () => {
    const regular = node('a', 'component');
    const stub = node('b', 'stub');
    const layout = await computeLayout([regular, stub], []);
    // biome-ignore lint/style/noNonNullAssertion: nodes "a" and "b" were just passed into computeLayout
    const rn = layout.nodes.find(n => n.id === 'a')!;
    // biome-ignore lint/style/noNonNullAssertion: nodes "a" and "b" were just passed into computeLayout
    const sn = layout.nodes.find(n => n.id === 'b')!;
    expect(rn.width).toBeGreaterThan(sn.width);
    expect(rn.height).toBeGreaterThan(sn.height);
  });

  it('returns width and height for the overall graph', async () => {
    const layout = await computeLayout([node('a'), node('b')], [edge('a', 'b')]);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });
});

// ─── ELK output shape ────────────────────────────────────────────────────────

describe('computeLayout — output shape', () => {
  it('returns an edge with from/to matching the input', async () => {
    const layout = await computeLayout([node('a'), node('b')], [edge('a', 'b')]);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].from).toBe('a');
    expect(layout.edges[0].to).toBe('b');
  });

  it('edge sections have startPoint and endPoint', async () => {
    const layout = await computeLayout([node('a'), node('b')], [edge('a', 'b')]);
    const section = layout.edges[0].sections[0];
    expect(section.startPoint).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    expect(section.endPoint).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  });

  it('handles a graph with no edges', async () => {
    const layout = await computeLayout([node('a'), node('b')], []);
    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges).toHaveLength(0);
  });

  it('handles a single node graph', async () => {
    const layout = await computeLayout([node('a')], []);
    expect(layout.nodes).toHaveLength(1);
    expect(layout.nodes[0].id).toBe('a');
  });

  it('deduplicates parallel edges before passing to ELK', async () => {
    const e1 = { ...edge('a', 'b'), diff: 'added' as const };
    const e2 = { ...edge('a', 'b'), diff: 'unchanged' as const };
    const layout = await computeLayout([node('a'), node('b')], [e1, e2]);
    expect(layout.edges).toHaveLength(1);
  });

  it('layered layout places nodes with increasing x for a linear chain', async () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('a', 'b'), edge('b', 'c')];
    const layout = await computeLayout(nodes, edges);
    const byId = new Map(layout.nodes.map(n => [n.id, n]));
    expect(byId.get('a')?.x).toBeLessThan(byId.get('b')?.x);
    expect(byId.get('b')?.x).toBeLessThan(byId.get('c')?.x);
  });
});
