import { createRequire } from 'module';
import type { ElkNode, ELK as ELKInstance, ElkExtendedEdge } from 'elkjs/lib/elk-api.js';
import type { GraphNode, GraphEdge } from '../types.js';

const _require = createRequire(import.meta.url);
const ELKClass = _require('elkjs/lib/elk.bundled.js') as { new(): ELKInstance };

// ─── Output types ─────────────────────────────────────────────────────────────

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutEdgeSection {
  startPoint: LayoutPoint;
  endPoint: LayoutPoint;
  bendPoints?: LayoutPoint[];
}

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
  sections: LayoutEdgeSection[];
}

export interface LayoutContainer {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  container?: LayoutContainer;
}

// ─── Node dimensions ──────────────────────────────────────────────────────────

const MIN_NODE_WIDTH = 140;
const NODE_HEIGHT = 40;
const STUB_WIDTH = 120;
const STUB_HEIGHT = 32;
const APPROX_CHAR_WIDTH = 7;
const NODE_PADDING = 24;

function nodeDims(node: GraphNode): { width: number; height: number } {
  if (node.type === 'stub') return { width: STUB_WIDTH, height: STUB_HEIGHT };
  const width = Math.max(MIN_NODE_WIDTH, node.label.length * APPROX_CHAR_WIDTH + NODE_PADDING);
  return { width, height: NODE_HEIGHT };
}

// ─── computeLayout ────────────────────────────────────────────────────────────
// Pure async function; runs in Node only (elkjs uses WASM).
//
// When both in-scope and out-of-scope nodes exist, ELK partitioning is enabled:
// in-scope nodes get partition 0, out-of-scope partition 1. This forces ELK to
// place in-scope nodes in earlier (leftward) layers than oos nodes, guaranteeing
// no oos node falls inside the in-scope bounding box. All edges remain flat so
// ELK routes them normally — no cross-hierarchy issues.

export async function computeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Promise<Layout> {
  const elk = new ELKClass();

  const inScopeNodes = nodes.filter(n => n.scope === 'in-scope' || n.scope === 'removed-ghost');
  const oosNodes = nodes.filter(n => n.scope === 'out-of-scope');
  const usePartitions = inScopeNodes.length > 0 && oosNodes.length > 0;

  const elkNodes: ElkNode[] = nodes.map(n => ({
    id: n.id,
    ...nodeDims(n),
    ...(usePartitions ? {
      layoutOptions: {
        'elk.partitioning.partition': n.scope === 'out-of-scope' ? '1' : '0',
      },
    } : {}),
  }));

  // Deduplicate edges (same from→to pair may appear with different diff states)
  const seen = new Set<string>();
  const elkEdges = edges
    .map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] }))
    .filter(e => {
      const k = `${e.sources[0]}→${e.targets[0]}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      ...(usePartitions ? { 'elk.partitioning.activate': 'true' } : {}),
      'elk.spacing.nodeNode': '20',
      'elk.layered.spacing.nodeNodeBetweenLayers': '40',
      'elk.padding': '[top=20, left=20, bottom=20, right=20]',
    },
    children: elkNodes,
    edges: elkEdges,
  };

  const result = await elk.layout(graph);

  const layoutNodes: LayoutNode[] = (result.children ?? []).map((c: ElkNode) => ({
    id: c.id,
    x: c.x ?? 0,
    y: c.y ?? 0,
    width: c.width ?? MIN_NODE_WIDTH,
    height: c.height ?? NODE_HEIGHT,
  }));

  const layoutEdges: LayoutEdge[] = (result.edges ?? []).map((e: ElkExtendedEdge) => {
    const ext = e as ElkExtendedEdge & { sources?: string[]; targets?: string[] };
    const from = ext.sources?.[0] ?? '';
    const to = ext.targets?.[0] ?? '';
    const sections: LayoutEdgeSection[] = (ext.sections ?? []).map(s => ({
      startPoint: s.startPoint,
      endPoint: s.endPoint,
      ...(s.bendPoints ? { bendPoints: s.bendPoints } : {}),
    }));
    return { from, to, sections };
  });

  // Compute the in-scope container box from actual node positions post-layout.
  // Partitioning guarantees all oos nodes are at higher x values, so no oos node
  // falls inside this bounding box.
  let container: LayoutContainer | undefined;
  if (usePartitions) {
    const inScopeIds = new Set(inScopeNodes.map(n => n.id));
    const inScopeLayout = layoutNodes.filter(n => inScopeIds.has(n.id));
    if (inScopeLayout.length > 0) {
      const PAD = 15;
      const LABEL_H = 20;
      const minX = Math.min(...inScopeLayout.map(n => n.x));
      const minY = Math.min(...inScopeLayout.map(n => n.y));
      const maxX = Math.max(...inScopeLayout.map(n => n.x + n.width));
      const maxY = Math.max(...inScopeLayout.map(n => n.y + n.height));
      container = {
        x: minX - PAD,
        y: minY - PAD - LABEL_H,
        width: maxX - minX + PAD * 2,
        height: maxY - minY + PAD * 2 + LABEL_H,
      };
    }
  }

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: result.width ?? 0,
    height: result.height ?? 0,
    container,
  };
}
