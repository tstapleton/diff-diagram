import { oosDisplayPath } from "../analyzer.js";
import type { DiffState, GraphEdge, GraphNode } from "../types.js";
import type { Layout, LayoutEdge } from "./layout.js";
import { NODE_HEIGHT } from "./layout.js";

// ─── Color palette ────────────────────────────────────────────────────────────

const NODE_FILL: Record<DiffState, string> = {
	added: "#1f6b3d",
	modified: "#9a5510",
	removed: "#a03333",
	unchanged: "#2d3f5c",
};

const NODE_STROKE: Record<DiffState, string> = {
	added: "#22c55e",
	modified: "#f59e0b",
	removed: "#ef4444",
	unchanged: "#8fa8d6",
};

const EDGE_STROKE: Record<DiffState, string> = {
	added: "#22c55e",
	modified: "#f59e0b",
	removed: "#ef4444",
	unchanged: "#8fa8d6",
};

const OOS_FILL = "#1f3355";
const OOS_STROKE = "#5588cc";
const TEXT_COLOR = "#ffffff";
const META_COLOR = "#a9c1e8";
const STUB_TEXT = "#d3e2f7";
const TEST_DOT = "#22c55e"; // green — has unit test
const STORY_DOT = "#a855f7"; // purple — has storybook story

// ─── Color interpolation ──────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const n = Number.parseInt(hex.slice(1), 16);
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
	return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function lerpHex(from: string, to: string, t: number): string {
	const clamped = Math.min(1, Math.max(0, t));
	const a = hexToRgb(from);
	const b = hexToRgb(to);
	return rgbToHex(
		Math.round(a.r + (b.r - a.r) * clamped),
		Math.round(a.g + (b.g - a.g) * clamped),
		Math.round(a.b + (b.b - a.b) * clamped),
	);
}

// ─── Label truncation ─────────────────────────────────────────────────────────

const FONT_FAMILY = "Fira Code, monospace";
const APPROX_CHAR_WIDTH = 7; // px per monospace character at font-size 11

export function truncateLabel(label: string, maxWidth: number): string {
	const maxChars = Math.floor((maxWidth - 16) / APPROX_CHAR_WIDTH);
	if (label.length <= maxChars) return label;
	return `${label.slice(0, Math.max(1, maxChars - 1))}…`;
}

// ─── Node rendering ───────────────────────────────────────────────────────────

export function nodeColor(node: GraphNode): { fill: string; stroke: string } {
	if (node.scope === "out-of-scope" || node.type === "stub") {
		return node.scope === "out-of-scope"
			? { fill: OOS_FILL, stroke: OOS_STROKE }
			: { fill: "#182238", stroke: "#7ba3d9" };
	}
	const diff = node.diff ?? "unchanged";
	const fill =
		node.magnitude !== undefined
			? lerpHex(NODE_FILL.unchanged, NODE_FILL[diff], node.magnitude)
			: NODE_FILL[diff];
	return { fill, stroke: NODE_STROKE[diff] };
}

function renderNode(
	node: GraphNode,
	lx: number,
	ly: number,
	lw: number,
	lh: number,
	sourceRoot: string,
): string {
	const { fill, stroke } = nodeColor(node);
	const isStub = node.type === "stub";
	const label = node.label;

	if (isStub) {
		const cy = ly + lh / 2;
		return [
			`  <rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`,
			`  <text x="${lx + lw / 2}" y="${cy + 4}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="10" fill="${STUB_TEXT}">${label}</text>`,
		].join("\n");
	}

	const isOos = node.scope === "out-of-scope";

	if (node.typeOnly) {
		const typeOnlyFill = "#22385e";
		if (isOos) {
			const dirPath = oosDisplayPath(node.file, sourceRoot);
			return [
				`  <rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="4" fill="${typeOnlyFill}" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="4,2"/>`,
				`  <text x="${lx + 8}" y="${ly + lh / 2 - 3}" font-family="${FONT_FAMILY}" font-size="11" font-style="italic" fill="${TEXT_COLOR}">${label}</text>`,
				`  <text x="${lx + 8}" y="${ly + lh / 2 + 9}" font-family="${FONT_FAMILY}" font-size="8" fill="${META_COLOR}">${dirPath}</text>`,
			].join("\n");
		}
		const cy = ly + lh / 2 + 4;
		return [
			`  <rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="4" fill="${typeOnlyFill}" stroke="${stroke}" stroke-width="1.5" stroke-dasharray="4,2"/>`,
			`  <text x="${lx + 8}" y="${cy}" font-family="${FONT_FAMILY}" font-size="11" font-style="italic" fill="${TEXT_COLOR}">${label}</text>`,
		].join("\n");
	}

	if (isOos) {
		const dirPath = oosDisplayPath(node.file, sourceRoot);
		return [
			`  <rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`,
			`  <text x="${lx + 8}" y="${ly + lh / 2 - 3}" font-family="${FONT_FAMILY}" font-size="11" fill="${TEXT_COLOR}">${label}</text>`,
			`  <text x="${lx + 8}" y="${ly + lh / 2 + 9}" font-family="${FONT_FAMILY}" font-size="8" fill="${META_COLOR}">${dirPath}</text>`,
		].join("\n");
	}

	if (node.type === "directory") {
		// A compound directory box (taller than a leaf) reserves its lower
		// portion for a nested level2 child — top-anchor so the label doesn't
		// sit on top of that child. A leaf directory box has nothing below
		// the label, so center it like every other node.
		const textY = lh > NODE_HEIGHT ? ly + 13 : ly + lh / 2 + 4;
		return [
			`  <rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`,
			`  <text x="${lx + 8}" y="${textY}" font-family="${FONT_FAMILY}" font-size="11" fill="${TEXT_COLOR}">${label}</text>`,
		].join("\n");
	}

	// in-scope or removed-ghost: label only, vertically centered
	const cy = ly + lh / 2 + 4;
	const dots = nodeMarkerDots(node, lx, ly, lw, lh);
	return [
		`  <rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`,
		`  <text x="${lx + 8}" y="${cy}" font-family="${FONT_FAMILY}" font-size="11" fill="${TEXT_COLOR}">${label}</text>`,
		...dots,
	].join("\n");
}

function nodeMarkerDots(
	node: GraphNode,
	lx: number,
	ly: number,
	lw: number,
	lh: number,
): string[] {
	const dots: string[] = [];
	const r = 3;
	let offsetRight = 6;
	if (node.hasStories) {
		dots.push(
			`  <circle cx="${lx + lw - offsetRight}" cy="${ly + lh - 6}" r="${r}" fill="${STORY_DOT}"/>`,
		);
		offsetRight += 8;
	}
	if (node.hasTests) {
		dots.push(
			`  <circle cx="${lx + lw - offsetRight}" cy="${ly + lh - 6}" r="${r}" fill="${TEST_DOT}"/>`,
		);
	}
	return dots;
}

// ─── Edge rendering ───────────────────────────────────────────────────────────

export function edgeStroke(diff: DiffState | undefined): string {
	return EDGE_STROKE[diff ?? "unchanged"];
}

function renderEdge(le: LayoutEdge, edge: GraphEdge | undefined): string {
	const color = edgeStroke(edge?.diff);
	const opacity = edge?.diff === "removed" ? "0.5" : "1";

	const paths = le.sections.map((section) => {
		const pts: string[] = [`M ${section.startPoint.x} ${section.startPoint.y}`];
		for (const bp of section.bendPoints ?? []) {
			pts.push(`L ${bp.x} ${bp.y}`);
		}
		pts.push(`L ${section.endPoint.x} ${section.endPoint.y}`);
		return pts.join(" ");
	});

	const d = paths.join(" ");
	const dashArray = edge?.diff === "removed" ? ' stroke-dasharray="5,3"' : "";
	return `  <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" opacity="${opacity}"${dashArray} marker-end="url(#arrow-${diffKey(edge?.diff)})"/>`;
}

function diffKey(diff: DiffState | undefined): string {
	return diff ?? "unchanged";
}

// ─── Arrow markers ────────────────────────────────────────────────────────────

function arrowMarkers(): string {
	return Object.entries(EDGE_STROKE)
		.map(
			([state, color]) => `
  <marker id="arrow-${state}" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
    <polygon points="0 0, 8 3, 0 6" fill="${color}"/>
  </marker>`,
		)
		.join("");
}

// ─── toSvg ────────────────────────────────────────────────────────────────────

export function toSvg(
	layout: Layout,
	nodes: GraphNode[],
	edges: GraphEdge[],
	featureLabel?: string,
	sourceRoot = "src/app",
): string {
	const nodeById = new Map(nodes.map((n) => [n.id, n]));

	// Build edge lookup by from→to for diff state retrieval
	const edgeByKey = new Map(edges.map((e) => [`${e.from}→${e.to}`, e]));

	const renderedNodes = layout.nodes.flatMap((ln) => {
		const gn = nodeById.get(ln.id);
		if (!gn) return [];
		return [renderNode(gn, ln.x, ln.y, ln.width, ln.height, sourceRoot)];
	});

	const renderedEdges = layout.edges.flatMap((le) => {
		const graphEdge = edgeByKey.get(`${le.from}→${le.to}`);
		return [renderEdge(le, graphEdge)];
	});

	// Container box: ELK compound layout positions __scope__ precisely; use it directly
	let containerRect = "";
	if (featureLabel !== undefined && layout.container) {
		const { x: cx, y: cy, width: cw, height: ch } = layout.container;
		containerRect = [
			`  <rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="6" fill="#182238" stroke="#5588cc" stroke-width="1.5"/>`,
			`  <text x="${cx + 10}" y="${cy + 13}" font-family="${FONT_FAMILY}" font-size="10" fill="#a9c1e8">${featureLabel}</text>`,
		].join("\n");
	}

	// Subdirectory group boxes (issue #28): one subtle dashed rect + label per
	// entry, subordinate to the outer feature container above it.
	const subdirRects = (layout.subdirContainers ?? []).map((c) => {
		return [
			`  <rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="4" fill="none" stroke="#7ba3d9" stroke-width="1.25"/>`,
			`  <text x="${c.x + 8}" y="${c.y + 12}" font-family="${FONT_FAMILY}" font-size="10" fill="#d3e2f7">${c.label}</text>`,
		].join("\n");
	});

	const { width, height } = layout;

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
		`<defs>${arrowMarkers()}</defs>`,
		`<rect width="${width}" height="${height}" fill="#0a0f1c"/>`,
		...(containerRect ? [containerRect] : []),
		...subdirRects,
		...renderedEdges,
		...renderedNodes,
		`</svg>`,
	].join("\n");
}
