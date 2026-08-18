import type { DiffState, GraphNode } from "../types.js";

// Canonical rendering logic shared by both diagram artifacts:
//   - src/renderer/draw.ts imports this module directly (server-side SVG files).
//   - src/renderer.html's embedded <script> gets the *compiled* dist/renderer/
//     render.js spliced in verbatim by buildHtml() in cli.ts (see the
//     "__DIFF_DIAGRAM_RENDER_JS__" placeholder) — renderer.html has no build
//     step of its own, so this is the one piece of it that isn't authored
//     in-place. Keep this module free of Node APIs so the compiled output
//     stays valid as a plain browser <script>.

// ─── Positioned data shapes ─────────────────────────────────────────────────
// Layout coordinates flattened directly onto graph node/edge fields — the
// same merged shape embedded in renderer.html's DIFF_DIAGRAM JSON.

export interface PositionedNode {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	label: string;
	type: GraphNode["type"];
	scope: GraphNode["scope"];
	diff: DiffState | null;
	file: string;
	typeOnly?: boolean;
	hasTests?: boolean;
	hasStories?: boolean;
	magnitude?: number;
}

export interface PositionedEdgePoint {
	x: number;
	y: number;
}

export interface PositionedEdgeSection {
	startPoint: PositionedEdgePoint;
	endPoint: PositionedEdgePoint;
	bendPoints?: PositionedEdgePoint[];
}

export interface PositionedEdge {
	from: string;
	to: string;
	sections?: PositionedEdgeSection[];
	diff?: DiffState;
}

export interface RenderContainer {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface RenderSubdirContainer extends RenderContainer {
	label: string;
}

export interface RenderDiagramData {
	width: number;
	height: number;
	nodes: PositionedNode[];
	edges: PositionedEdge[];
	container?: RenderContainer;
	subdirContainers?: RenderSubdirContainer[];
}

export interface RenderDiagramOpts {
	sourceRoot?: string;
	featureLabel?: string;
}

// ─── Color palette ────────────────────────────────────────────────────────────

export const NODE_FILL: Record<DiffState, string> = {
	added: "#1f6b3d",
	modified: "#9a5510",
	removed: "#a03333",
	unchanged: "#2d3f5c",
};

export const NODE_STROKE: Record<DiffState, string> = {
	added: "#22c55e",
	modified: "#f59e0b",
	removed: "#ef4444",
	unchanged: "#8fa8d6",
};

export const EDGE_STROKE: Record<DiffState, string> = {
	added: "#22c55e",
	modified: "#f59e0b",
	removed: "#ef4444",
	unchanged: "#8fa8d6",
};

export const OOS_FILL = "#1f3355";
export const OOS_STROKE = "#5588cc";
export const TEXT_COLOR = "#ffffff";
export const META_COLOR = "#a9c1e8";
export const STUB_TEXT = "#d3e2f7";
export const TEST_DOT = "#22c55e"; // green — has unit test
export const STORY_DOT = "#a855f7"; // purple — has storybook story
export const TYPE_ONLY_FILL = "#22385e";

// Dashed border = "this box is abstracted/aggregated, not one concrete real
// thing" — shared by typeOnly import nodes, stub nodes, and clustered
// directory nodes (and, separately, subdirectory group wrapper boxes).
export const AGGREGATE_DASH = "4,2";
export const REMOVED_EDGE_DASH = "5,3";

export const FONT_FAMILY = "Fira Code, monospace";
export const NODE_HEIGHT = 40;

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

// ─── Node color + dash ────────────────────────────────────────────────────────

export function nodeColor(node: PositionedNode): {
	fill: string;
	stroke: string;
} {
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

// Aggregate node types (stub / clustered directory / type-only) always carry
// the dashed cue regardless of diff state; ordinary in-scope, removed-ghost,
// and out-of-scope nodes never do.
function nodeDashArray(node: PositionedNode): string | undefined {
	if (node.type === "stub" || node.type === "directory" || node.typeOnly) {
		return AGGREGATE_DASH;
	}
	return undefined;
}

// ─── Edge color ───────────────────────────────────────────────────────────────

export function edgeStroke(diff: DiffState | undefined): string {
	return EDGE_STROKE[diff ?? "unchanged"];
}

function buildEdgePath(section: PositionedEdgeSection): string {
	const pts = [
		section.startPoint,
		...(section.bendPoints ?? []),
		section.endPoint,
	];
	return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}

// ─── Out-of-scope directory display path ─────────────────────────────────────

function oosDisplayDir(file: string, sourceRoot: string): string {
	const dir = file.includes("/")
		? file.substring(0, file.lastIndexOf("/"))
		: ".";
	const prefix = sourceRoot.endsWith("/") ? sourceRoot : `${sourceRoot}/`;
	return dir.startsWith(prefix) ? dir.slice(prefix.length) : dir;
}

// ─── Node markup ──────────────────────────────────────────────────────────────

export function renderNodeMarkup(
	node: PositionedNode,
	sourceRoot: string,
): string {
	const { fill, stroke } = nodeColor(node);
	const dash = nodeDashArray(node);
	const dashAttr = dash ? ` stroke-dasharray="${dash}"` : "";
	const { x, y, width: w, height: h, label } = node;
	const isStub = node.type === "stub";
	const isOos = node.scope === "out-of-scope";

	let inner: string;
	if (isStub) {
		const cy = y + h / 2;
		inner = [
			`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}" stroke="${stroke}" stroke-width="1"${dashAttr}/>`,
			`<text x="${x + w / 2}" y="${cy + 4}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="10" fill="${STUB_TEXT}">${label}</text>`,
		].join("\n");
	} else if (node.typeOnly) {
		if (isOos) {
			const dirPath = oosDisplayDir(node.file, sourceRoot);
			inner = [
				`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${TYPE_ONLY_FILL}" stroke="${stroke}" stroke-width="1.5"${dashAttr}/>`,
				`<text x="${x + 8}" y="${y + h / 2 - 3}" font-family="${FONT_FAMILY}" font-size="11" font-style="italic" fill="${TEXT_COLOR}">${label}</text>`,
				`<text x="${x + 8}" y="${y + h / 2 + 9}" font-family="${FONT_FAMILY}" font-size="8" fill="${META_COLOR}">${dirPath}</text>`,
			].join("\n");
		} else {
			const cy = y + h / 2 + 4;
			inner = [
				`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${TYPE_ONLY_FILL}" stroke="${stroke}" stroke-width="1.5"${dashAttr}/>`,
				`<text x="${x + 8}" y="${cy}" font-family="${FONT_FAMILY}" font-size="11" font-style="italic" fill="${TEXT_COLOR}">${label}</text>`,
			].join("\n");
		}
	} else if (isOos) {
		const dirPath = oosDisplayDir(node.file, sourceRoot);
		inner = [
			`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`,
			`<text x="${x + 8}" y="${y + h / 2 - 3}" font-family="${FONT_FAMILY}" font-size="11" fill="${TEXT_COLOR}">${label}</text>`,
			`<text x="${x + 8}" y="${y + h / 2 + 9}" font-family="${FONT_FAMILY}" font-size="8" fill="${META_COLOR}">${dirPath}</text>`,
		].join("\n");
	} else if (node.type === "directory") {
		// A compound directory box (taller than a leaf) reserves its lower
		// portion for a nested level2 child — top-anchor there; a leaf
		// directory box has nothing below the label, so center it.
		const textY = h > NODE_HEIGHT ? y + 13 : y + h / 2 + 4;
		inner = [
			`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dashAttr}/>`,
			`<text x="${x + 8}" y="${textY}" font-family="${FONT_FAMILY}" font-size="11" fill="${TEXT_COLOR}">${label}</text>`,
		].join("\n");
	} else {
		// in-scope or removed-ghost: label only, vertically centered
		const cy = y + h / 2 + 4;
		const dots: string[] = [];
		let dotX = x + w - 6;
		if (node.hasStories) {
			dots.push(
				`<circle cx="${dotX}" cy="${y + h - 6}" r="3" fill="${STORY_DOT}"/>`,
			);
			dotX -= 8;
		}
		if (node.hasTests) {
			dots.push(
				`<circle cx="${dotX}" cy="${y + h - 6}" r="3" fill="${TEST_DOT}"/>`,
			);
		}
		inner = [
			`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`,
			`<text x="${x + 8}" y="${cy}" font-family="${FONT_FAMILY}" font-size="11" fill="${TEXT_COLOR}">${label}</text>`,
			...dots,
		].join("\n");
	}

	return `<g class="node-group" data-id="${node.id}">\n${inner}\n</g>`;
}

// ─── Edge markup ──────────────────────────────────────────────────────────────

export function renderEdgeMarkup(edge: PositionedEdge): string {
	const color = edgeStroke(edge.diff);
	const isRemoved = edge.diff === "removed";
	const dashAttr = isRemoved ? ` stroke-dasharray="${REMOVED_EDGE_DASH}"` : "";
	const opacity = isRemoved ? "0.5" : "1";
	const markerKey = edge.diff ?? "unchanged";

	return (edge.sections ?? [])
		.map(
			(section) =>
				`<path data-from="${edge.from}" data-to="${edge.to}" d="${buildEdgePath(section)}" fill="none" stroke="${color}" stroke-width="1.5" opacity="${opacity}"${dashAttr} marker-end="url(#arrow-${markerKey})"/>`,
		)
		.join("");
}

// ─── Arrow markers ────────────────────────────────────────────────────────────

function renderMarkerDefs(): string {
	return Object.entries(EDGE_STROKE)
		.map(
			([state, color]) =>
				`<marker id="arrow-${state}" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0,8 3,0 6" fill="${color}"/></marker>`,
		)
		.join("");
}

// ─── Container + subdirectory boxes ───────────────────────────────────────────

function renderContainerMarkup(
	container: RenderContainer | undefined,
	featureLabel: string | undefined,
): string {
	if (!container || featureLabel === undefined) return "";
	const { x, y, width, height } = container;
	return [
		`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="#182238" stroke="#5588cc" stroke-width="1.5"/>`,
		`<text x="${x + 10}" y="${y + 13}" font-family="${FONT_FAMILY}" font-size="10" fill="${META_COLOR}">${featureLabel}</text>`,
	].join("\n");
}

function renderSubdirMarkup(
	subdirContainers: RenderSubdirContainer[] | undefined,
): string {
	return (subdirContainers ?? [])
		.map(
			(c) =>
				`<g class="subdir-group"><rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="4" fill="none" stroke="#7ba3d9" stroke-width="1.25" stroke-dasharray="${AGGREGATE_DASH}"/><text x="${c.x + 8}" y="${c.y + 12}" font-family="${FONT_FAMILY}" font-size="10" fill="${STUB_TEXT}">${c.label}</text></g>`,
		)
		.join("");
}

// ─── Top-level diagram assembly ───────────────────────────────────────────────

export function renderDiagramSvg(
	data: RenderDiagramData,
	opts?: RenderDiagramOpts,
): string {
	const { width, height, nodes, edges, container, subdirContainers } = data;
	const sourceRoot = opts?.sourceRoot ?? "src/app";
	const featureLabel = opts?.featureLabel;

	const nodeMarkup = nodes
		.map((n) => renderNodeMarkup(n, sourceRoot))
		.join("\n");
	const edgeMarkup = edges.map((e) => renderEdgeMarkup(e)).join("");

	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
		`<defs>${renderMarkerDefs()}</defs>`,
		`<rect width="${width}" height="${height}" fill="#0a0f1c"/>`,
		renderContainerMarkup(container, featureLabel),
		renderSubdirMarkup(subdirContainers),
		edgeMarkup,
		nodeMarkup,
		`</svg>`,
	]
		.filter((part) => part !== "")
		.join("\n");
}
