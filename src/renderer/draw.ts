import type { GraphEdge, GraphNode } from "../types.js";
import type { Layout, LayoutEdge } from "./layout.js";
import {
	edgeStroke,
	lerpHex,
	nodeColor,
	type PositionedEdge,
	type PositionedNode,
	renderDiagramSvg,
} from "./render.js";

export { edgeStroke, lerpHex, nodeColor };

// ─── Label truncation ─────────────────────────────────────────────────────────

const APPROX_CHAR_WIDTH = 7; // px per monospace character at font-size 11

export function truncateLabel(label: string, maxWidth: number): string {
	const maxChars = Math.floor((maxWidth - 16) / APPROX_CHAR_WIDTH);
	if (label.length <= maxChars) return label;
	return `${label.slice(0, Math.max(1, maxChars - 1))}…`;
}

// ─── toSvg ────────────────────────────────────────────────────────────────────

function toPositionedNode(
	ln: { id: string; x: number; y: number; width: number; height: number },
	gn: GraphNode,
): PositionedNode {
	return {
		id: ln.id,
		x: ln.x,
		y: ln.y,
		width: ln.width,
		height: ln.height,
		label: gn.label,
		type: gn.type,
		scope: gn.scope,
		diff: gn.diff,
		file: gn.file,
		...(gn.typeOnly ? { typeOnly: true } : {}),
		...(gn.hasTests ? { hasTests: true } : {}),
		...(gn.hasStories ? { hasStories: true } : {}),
		...(gn.magnitude !== undefined ? { magnitude: gn.magnitude } : {}),
	};
}

function toPositionedEdge(
	le: LayoutEdge,
	ge: GraphEdge | undefined,
): PositionedEdge {
	return {
		from: le.from,
		to: le.to,
		sections: le.sections,
		...(ge?.diff ? { diff: ge.diff } : {}),
	};
}

export function toSvg(
	layout: Layout,
	nodes: GraphNode[],
	edges: GraphEdge[],
	featureLabel?: string,
	sourceRoot = "src/app",
): string {
	const nodeById = new Map(nodes.map((n) => [n.id, n]));
	const edgeByKey = new Map(edges.map((e) => [`${e.from}→${e.to}`, e]));

	const positionedNodes = layout.nodes.flatMap((ln) => {
		const gn = nodeById.get(ln.id);
		if (!gn) return [];
		return [toPositionedNode(ln, gn)];
	});

	const positionedEdges = layout.edges.map((le) =>
		toPositionedEdge(le, edgeByKey.get(`${le.from}→${le.to}`)),
	);

	return renderDiagramSvg(
		{
			width: layout.width,
			height: layout.height,
			nodes: positionedNodes,
			edges: positionedEdges,
			container: layout.container,
			subdirContainers: layout.subdirContainers,
		},
		{ sourceRoot, featureLabel },
	);
}
