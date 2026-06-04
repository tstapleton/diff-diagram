import path from 'path';
import type { GraphNode, GraphEdge, DiffState } from '../types.js';
import type { Layout, LayoutEdge } from './layout.js';

// ─── Color palette ────────────────────────────────────────────────────────────

const NODE_FILL: Record<DiffState, string> = {
  added:     '#14532d',
  modified:  '#78350f',
  removed:   '#7f1d1d',
  unchanged: '#1e293b',
};

const NODE_STROKE: Record<DiffState, string> = {
  added:     '#22c55e',
  modified:  '#f59e0b',
  removed:   '#ef4444',
  unchanged: '#475569',
};

const EDGE_STROKE: Record<DiffState, string> = {
  added:     '#22c55e',
  modified:  '#f59e0b',
  removed:   '#ef4444',
  unchanged: '#475569',
};

const OOS_FILL   = '#0a1829';
const OOS_STROKE = '#1e3a5f';
const TEXT_COLOR = '#e2e8f0';
const META_COLOR = '#64748b';
const STUB_TEXT  = '#94a3b8';

// ─── Label truncation ─────────────────────────────────────────────────────────

const APPROX_CHAR_WIDTH = 7; // px per monospace character at font-size 11

export function truncateLabel(label: string, maxWidth: number): string {
  const maxChars = Math.floor((maxWidth - 16) / APPROX_CHAR_WIDTH);
  if (label.length <= maxChars) return label;
  return label.slice(0, Math.max(1, maxChars - 1)) + '…';
}

// ─── OOS path display ────────────────────────────────────────────────────────

function oosDisplayPath(file: string, sourceRoot: string): string {
  const dir = path.dirname(file);
  const prefix = sourceRoot.endsWith('/') ? sourceRoot : sourceRoot + '/';
  return dir.startsWith(prefix) ? dir.slice(prefix.length) : dir;
}

// ─── Node rendering ───────────────────────────────────────────────────────────

export function nodeColor(node: GraphNode): { fill: string; stroke: string } {
  if (node.scope === 'out-of-scope' || node.type === 'stub') {
    return node.scope === 'out-of-scope'
      ? { fill: OOS_FILL, stroke: OOS_STROKE }
      : { fill: '#0f172a', stroke: '#334155' };
  }
  const diff = node.diff ?? 'unchanged';
  return { fill: NODE_FILL[diff], stroke: NODE_STROKE[diff] };
}

function renderNode(node: GraphNode, lx: number, ly: number, lw: number, lh: number, sourceRoot: string): string {
  const { fill, stroke } = nodeColor(node);
  const isStub = node.type === 'stub';
  const label = isStub ? truncateLabel(node.label, lw) : node.label;

  if (isStub) {
    const cy = ly + lh / 2;
    return [
      `  <rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="1" stroke-dasharray="4,2"/>`,
      `  <text x="${lx + lw / 2}" y="${cy + 4}" text-anchor="middle" font-family="monospace" font-size="10" fill="${STUB_TEXT}">${label}</text>`,
    ].join('\n');
  }

  const isOos = node.scope === 'out-of-scope';

  if (node.typeOnly) {
    const typeOnlyFill = '#0d1f3c';
    if (isOos) {
      const dirPath = oosDisplayPath(node.file, sourceRoot);
      return [
        `  <rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="4" fill="${typeOnlyFill}" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="4,2"/>`,
        `  <text x="${lx + 8}" y="${ly + lh / 2 - 3}" font-family="monospace" font-size="11" font-style="italic" fill="${TEXT_COLOR}">${label}</text>`,
        `  <text x="${lx + 8}" y="${ly + lh / 2 + 9}" font-family="monospace" font-size="8" fill="${META_COLOR}">${dirPath}</text>`,
      ].join('\n');
    }
    const cy = ly + lh / 2 + 4;
    return [
      `  <rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="4" fill="${typeOnlyFill}" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="4,2"/>`,
      `  <text x="${lx + 8}" y="${cy}" font-family="monospace" font-size="11" font-style="italic" fill="${TEXT_COLOR}">${label}</text>`,
    ].join('\n');
  }

  if (isOos) {
    const dirPath = oosDisplayPath(node.file, sourceRoot);
    return [
      `  <rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`,
      `  <text x="${lx + 8}" y="${ly + lh / 2 - 3}" font-family="monospace" font-size="11" fill="${TEXT_COLOR}">${label}</text>`,
      `  <text x="${lx + 8}" y="${ly + lh / 2 + 9}" font-family="monospace" font-size="8" fill="${META_COLOR}">${dirPath}</text>`,
    ].join('\n');
  }

  // in-scope or removed-ghost: label only, vertically centered
  const cy = ly + lh / 2 + 4;
  return [
    `  <rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`,
    `  <text x="${lx + 8}" y="${cy}" font-family="monospace" font-size="11" fill="${TEXT_COLOR}">${label}</text>`,
  ].join('\n');
}

// ─── Edge rendering ───────────────────────────────────────────────────────────

export function edgeStroke(diff: DiffState | undefined): string {
  return EDGE_STROKE[diff ?? 'unchanged'];
}

function renderEdge(le: LayoutEdge, edge: GraphEdge | undefined): string {
  const color = edgeStroke(edge?.diff);
  const opacity = edge?.diff === 'removed' ? '0.5' : '1';

  const paths = le.sections.map(section => {
    const pts: string[] = [`M ${section.startPoint.x} ${section.startPoint.y}`];
    for (const bp of section.bendPoints ?? []) {
      pts.push(`L ${bp.x} ${bp.y}`);
    }
    pts.push(`L ${section.endPoint.x} ${section.endPoint.y}`);
    return pts.join(' ');
  });

  const d = paths.join(' ');
  const dashArray = edge?.diff === 'removed' ? ' stroke-dasharray="5,3"' : '';
  return `  <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" opacity="${opacity}"${dashArray} marker-end="url(#arrow-${diffKey(edge?.diff)})"/>`;
}

function diffKey(diff: DiffState | undefined): string {
  return diff ?? 'unchanged';
}

// ─── Arrow markers ────────────────────────────────────────────────────────────

function arrowMarkers(): string {
  return Object.entries(EDGE_STROKE).map(([state, color]) => `
  <marker id="arrow-${state}" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
    <polygon points="0 0, 8 3, 0 6" fill="${color}"/>
  </marker>`).join('');
}

// ─── toSvg ────────────────────────────────────────────────────────────────────

export function toSvg(
  layout: Layout,
  nodes: GraphNode[],
  edges: GraphEdge[],
  featureLabel?: string,
  sourceRoot = 'src/app',
): string {
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // Build edge lookup by from→to for diff state retrieval
  const edgeByKey = new Map(edges.map(e => [`${e.from}→${e.to}`, e]));

  const renderedNodes = layout.nodes.flatMap(ln => {
    const gn = nodeById.get(ln.id);
    if (!gn) return [];
    return [renderNode(gn, ln.x, ln.y, ln.width, ln.height, sourceRoot)];
  });

  const renderedEdges = layout.edges.flatMap(le => {
    const graphEdge = edgeByKey.get(`${le.from}→${le.to}`);
    return [renderEdge(le, graphEdge)];
  });

  // Container box: ELK compound layout positions __scope__ precisely; use it directly
  let containerRect = '';
  if (featureLabel !== undefined && layout.container) {
    const { x: cx, y: cy, width: cw, height: ch } = layout.container;
    containerRect = [
      `  <rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="6" fill="#080e1a" stroke="#1e3a5f" stroke-width="1.5"/>`,
      `  <text x="${cx + 10}" y="${cy + 13}" font-family="monospace" font-size="9" fill="#475569">${featureLabel}</text>`,
    ].join('\n');
  }

  const { width, height } = layout;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<defs>${arrowMarkers()}</defs>`,
    `<rect width="${width}" height="${height}" fill="#0f172a"/>`,
    ...(containerRect ? [containerRect] : []),
    ...renderedEdges,
    ...renderedNodes,
    `</svg>`,
  ].join('\n');
}
