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

export interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

// ─── Node dimensions ──────────────────────────────────────────────────────────

const NODE_WIDTH = 140;
const NODE_HEIGHT = 40;
const STUB_WIDTH = 120;
const STUB_HEIGHT = 32;

function nodeDims(node: GraphNode): { width: number; height: number } {
  return node.type === 'stub'
    ? { width: STUB_WIDTH, height: STUB_HEIGHT }
    : { width: NODE_WIDTH, height: NODE_HEIGHT };
}

// ─── computeLayout ────────────────────────────────────────────────────────────
// Pure async function; runs in Node only (elkjs uses WASM).

export async function computeLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Promise<Layout> {
  const elk = new ELKClass();

  const elkNodes: ElkNode[] = nodes.map(n => ({
    id: n.id,
    ...nodeDims(n),
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
    width: c.width ?? NODE_WIDTH,
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

  const w = result.width ?? 0;
  const h = result.height ?? 0;

  return { nodes: layoutNodes, edges: layoutEdges, width: w, height: h };
}
