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
	hasTests?: boolean;
	hasStories?: boolean;
	magnitude?: number;
	// Nesting tier of a fully-collapsed in-scope subdirectory stub (1 or 2);
	// see GraphNode.depth. Absent on every other node kind.
	depth?: number;
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
	// Nesting tier below the whole-feature boundary: 1 for a level-1
	// subdirectory box, 2 for a level-2 one — selects the container fill.
	depth: number;
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

// Depth-stepped structural container fills. The purely-structural directory
// chrome — the whole-feature boundary, the subdirectory group boxes, and the
// fully-collapsed in-scope subdirectory stubs — carries no diff state, so it
// leans on Gestalt *enclosure* (a filled, tinted region reads as "a group" on
// its own — Munzner, Ware) rather than a contrasting border to separate itself
// from diff-colored nodes and from edges routed nearby (issue #90). Each
// nesting tier steps lighter than the one enclosing it: index 0 is the
// whole-feature boundary, index 1 a level-1 subdirectory, index 2 a level-2
// subdirectory. The canvas behind everything is #0a0f1c. The tier-0 -> tier-1
// step is kept small on purpose — a level-1 subdirectory box should read as a
// gentle subdivision of the boundary, not a bold panel of its own — while the
// tier-1 -> tier-2 step is larger, so a level-2 nest still stands out clearly
// against its level-1 parent. Depths past the array clamp to the last entry
// (layout never nests deeper than 2).
export const CONTAINER_FILL_BY_DEPTH = ["#1c3352", "#2a4569", "#4a72a4"];
// Faint, low-contrast rim so a box's extent stays crisp where edges crowd it,
// without the stroke competing as a relationship line — it's darker and less
// saturated than the periwinkle unchanged-edge accent (#8fa8d6) and the
// out-of-scope blue (#5588cc), the two lines it could be confused with.
export const CONTAINER_STROKE = "#3a5170";

export function containerFill(depth: number): string {
	const i = Math.max(0, Math.min(depth, CONTAINER_FILL_BY_DEPTH.length - 1));
	return CONTAINER_FILL_BY_DEPTH[i];
}
export const TEXT_COLOR = "#ffffff";
export const META_COLOR = "#a9c1e8";
export const STUB_TEXT = "#d3e2f7";
export const TEST_DOT = "#06b6d4"; // cyan — has unit test
export const STORY_DOT = "#a855f7"; // purple — has storybook story

export const FONT_FAMILY = "Fira Code, monospace";

// The large majority of edges in a real diagram are pure context, and
// rendering every edge at the same visual weight buries the actual change
// under uniform ink (the #1 finding from a Purchase/Tufte/Ware-informed
// review of this diagram's busyness). Rather than dimming purely by an
// edge's *own* diff state, dimming follows proximity to change: an edge
// renders at full opacity when either endpoint is a *changed* node — a node
// whose own diff state is added/modified/removed — or the edge's own diff
// state is added/modified/removed, and recedes otherwise. This deliberately
// does NOT also light up every edge touching a node that merely gained/lost
// some *other* changed edge: expanding the highlighted set through edge
// endpoints (rather than stopping at nodes that changed themselves) over-
// spreads — one added edge into an existing, otherwise-untouched node would
// light up every other edge on that node too. A changed node's own edges
// cover the useful case on their own: editing a file to add/remove an
// import changes that file's content, so the edge's "from" endpoint is
// normally already a changed node by construction; the case this rule
// exists for is the "to" endpoint — an edge landing on an existing,
// content-unchanged file still renders at full opacity because that file is
// directly adjacent to the change. The edge's own diff state is checked
// too, not just its endpoints, so a changed edge is never wrongly dimmed
// even in the rare case (e.g. a barrel re-export change) where neither
// endpoint file's own content changed. Stroke width is left uniform —
// opacity is the one mechanism used here, not both.
export const EDGE_OPACITY_FULL = 1;
export const EDGE_OPACITY_DIMMED = 0.35;

// A node is "changed" if its own diff state is added/modified/removed.
// Deliberately narrower than the "touched" notion below (which also treats
// a node as touched via any edge endpoint) — see the rationale above
// EDGE_OPACITY_FULL: that broader definition over-spreads when used for
// edge opacity.
function isChangedDiff(diff: DiffState | null | undefined): boolean {
	return diff != null && diff !== "unchanged";
}

export function computeChangedNodeIds(nodes: PositionedNode[]): Set<string> {
	const changed = new Set<string>();
	for (const n of nodes) {
		if (isChangedDiff(n.diff)) changed.add(n.id);
	}
	return changed;
}

// Same rationale as edge opacity, applied to nodes: an untouched node is
// context surrounding the actual change, so it recedes to a lower opacity
// while a changed (or touched) node stays at full weight. Unlike edge
// opacity, node opacity uses the broader "touched" definition: a node
// renders at full opacity if it changed itself OR it's an endpoint of some
// *other* edge whose diff state changed — e.g. a content-unchanged file
// that just gained a new caller elsewhere is exactly the kind of adjacent
// context a reviewer needs to see at full weight, even though the edge
// opacity rule above deliberately doesn't extend that same reach to other
// edges nearby. Mirrors the exact same "touched" notion
// src/renderer/graph-helpers.ts's `touchedIds`/`isVisible` already use to
// decide Focused-view visibility (reimplemented locally, rather than
// imported, because graph-helpers.ts pulls in `node:path`, which would
// break this module's compiled output as a plain browser <script> — see
// the file header).
export const NODE_OPACITY_FULL = 1;
export const NODE_OPACITY_DIMMED = 0.45;

export function computeTouchedNodeIds(
	nodes: PositionedNode[],
	edges: PositionedEdge[],
): Set<string> {
	const touched = new Set<string>();
	for (const n of nodes) {
		if (isChangedDiff(n.diff)) touched.add(n.id);
	}
	for (const e of edges) {
		if (isChangedDiff(e.diff)) {
			touched.add(e.from);
			touched.add(e.to);
		}
	}
	return touched;
}

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
		// An in-scope stub is a fully-collapsed subdirectory — pure structural
		// chrome, so it takes the depth-stepped container fill (tier 1 or 2)
		// and the faint container rim, matching the subdirectory group boxes
		// and the whole-feature boundary. An out-of-scope stub keeps the
		// out-of-scope palette.
		return node.scope === "out-of-scope"
			? { fill: OOS_FILL, stroke: OOS_STROKE }
			: { fill: containerFill(node.depth ?? 1), stroke: CONTAINER_STROKE };
	}
	const diff = node.diff ?? "unchanged";
	const fill =
		node.magnitude !== undefined
			? lerpHex(NODE_FILL.unchanged, NODE_FILL[diff], node.magnitude)
			: NODE_FILL[diff];
	return { fill, stroke: NODE_STROKE[diff] };
}

// ─── Edge color ───────────────────────────────────────────────────────────────

export function edgeStroke(diff: DiffState | undefined): string {
	return EDGE_STROKE[diff ?? "unchanged"];
}

export function edgeOpacity(
	edge: PositionedEdge,
	changedIds: ReadonlySet<string>,
): number {
	return isChangedDiff(edge.diff) ||
		changedIds.has(edge.from) ||
		changedIds.has(edge.to)
		? EDGE_OPACITY_FULL
		: EDGE_OPACITY_DIMMED;
}

export function nodeOpacity(
	node: PositionedNode,
	touchedIds: ReadonlySet<string>,
): number {
	return isChangedDiff(node.diff) || touchedIds.has(node.id)
		? NODE_OPACITY_FULL
		: NODE_OPACITY_DIMMED;
}

// Max radius (px) used to round a bend point. ELK's routing is orthogonal
// and frequently produces very short stair-step segments (observed as short
// as 1px, e.g. where several parallel edges fan into adjacent ports on the
// same node) — a fixed radius alone would overshoot those, so it's always
// clamped per-corner to at most half of each adjacent segment's length.
const CORNER_RADIUS = 12;

// Converts ELK's routed point sequence (start, bend points, end) into a
// gently rounded curve rather than sharp straight-line corners — bends cost
// extra visual-tracing effort per Ware's findings on bend perception.
// Deliberately *not* a Catmull-Rom-style spline through all points: that
// technique derives each curve segment's tangent from neighboring points,
// and with ELK's short stair-step bend segments that produces overshoot —
// visible looping/waviness well past the original corner. Instead this
// rounds each corner locally and independently: it keeps the straight
// segments as-is and only replaces the immediate neighborhood of each
// interior bend point with a quadratic Bezier arc, so the curve never
// strays from the original routed path by more than CORNER_RADIUS. Two-point
// sections (no bend points) stay a straight line — there's nothing to round.
function buildEdgePath(section: PositionedEdgeSection): string {
	const pts = [
		section.startPoint,
		...(section.bendPoints ?? []),
		section.endPoint,
	];
	if (pts.length <= 2) {
		return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
	}

	const dist = (a: PositionedEdgePoint, b: PositionedEdgePoint) =>
		Math.hypot(b.x - a.x, b.y - a.y);
	// Point at distance `r` from `from`, along the segment toward `to`.
	const along = (
		from: PositionedEdgePoint,
		to: PositionedEdgePoint,
		r: number,
	) => {
		const len = dist(from, to);
		const t = len === 0 ? 0 : r / len;
		return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
	};

	const segments: string[] = [`M ${pts[0].x} ${pts[0].y}`];
	for (let i = 1; i < pts.length - 1; i++) {
		const prev = pts[i - 1];
		const corner = pts[i];
		const next = pts[i + 1];
		const r = Math.min(
			CORNER_RADIUS,
			dist(prev, corner) / 2,
			dist(corner, next) / 2,
		);
		const a = along(corner, prev, r);
		const b = along(corner, next, r);
		segments.push(
			`L ${a.x} ${a.y}`,
			`Q ${corner.x} ${corner.y}, ${b.x} ${b.y}`,
		);
	}
	const last = pts[pts.length - 1];
	segments.push(`L ${last.x} ${last.y}`);
	return segments.join(" ");
}

// ─── Out-of-scope directory display path ─────────────────────────────────────

// For a genuine file, the subtitle is the file's own containing directory.
// For a collapsed-group node (a stub or a Collapsed-view directory box),
// `file` already IS the group's own directory, not a file — stripping a
// trailing segment from it would incorrectly show the group's *parent*
// instead of the group itself, so `isGroup` skips that step.
function oosDisplayDir(
	file: string,
	sourceRoot: string,
	isGroup: boolean,
): string {
	const dir = isGroup
		? file
		: file.includes("/")
			? file.substring(0, file.lastIndexOf("/"))
			: ".";
	const prefix = sourceRoot.endsWith("/") ? sourceRoot : `${sourceRoot}/`;
	return dir.startsWith(prefix) ? dir.slice(prefix.length) : dir;
}

// ─── Node markup ──────────────────────────────────────────────────────────────

export function renderNodeMarkup(
	node: PositionedNode,
	sourceRoot: string,
	touchedIds: ReadonlySet<string>,
): string {
	const { fill, stroke } = nodeColor(node);
	const { x, y, width: w, height: h, label } = node;
	const isStub = node.type === "stub";
	const isOos = node.scope === "out-of-scope";
	// Only a genuine out-of-scope leaf file is exempt from dimming — it's
	// rendered with fixed colors regardless of diff state (see nodeColor()'s
	// early return) and has no meaningful diff state of its own to dim by.
	// A collapsed out-of-scope directory is NOT exempt, whether it's an OOS
	// stub (Focused view's `type: "stub"`) or an OOS directory box
	// (Collapsed view's `type: "directory"`) — both follow the same
	// touched-based rule as any in-scope collapsed directory, so a
	// collapsed out-of-scope directory that's genuinely untouched recedes
	// like any other unchanged node.
	const isOosLeaf = isOos && node.type === "file";
	const opacity = isOosLeaf ? 1 : nodeOpacity(node, touchedIds);
	const opacityAttr = opacity < 1 ? ` opacity="${opacity}"` : "";

	// A collapsed-group box (a stub, or a Collapsed-view directory box) is
	// drawn with a heavier border than a leaf file, regardless of scope —
	// this is orthogonal to whether it also gets a path subtitle below. The
	// exception is an in-scope stub: it's now purely structural chrome
	// (depth-tinted fill + faint CONTAINER_STROKE rim, like the subdirectory
	// group boxes it stands in for), so it takes the thin leaf-weight stroke
	// and lets the fill do the grouping work.
	const isCollapsedGroup = isStub || node.type === "directory";
	const isStructuralStub = isStub && !isOos;
	const strokeWidth = isCollapsedGroup && !isStructuralStub ? "1.25" : "1";

	let inner: string;
	if (isOos) {
		// Every out-of-scope node — a genuine individual file (Expanded
		// view), a stub (Focused view's collapsed-directory placeholder), or
		// a directory box (Collapsed view) — gets a path subtitle: its label
		// alone is just a bare basename (a filename, or a directory's own
		// name with no ancestry), which can be genuinely ambiguous once two
		// unrelated directories share a basename, and the tool has no
		// control over out-of-scope naming the way it does over the
		// in-scope feature it's actually diagramming. For a stub or
		// directory node `node.file` is already the group's own directory
		// (not a file with a basename to strip), so `oosDisplayDir` is told
		// not to strip a trailing segment from it the way it does for a
		// real file.
		const dirPath = oosDisplayDir(node.file, sourceRoot, node.type !== "file");
		inner = [
			`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`,
			`<text x="${x + 8}" y="${y + h / 2 - 3}" font-family="${FONT_FAMILY}" font-size="11" fill="${TEXT_COLOR}">${label}</text>`,
			`<text x="${x + 8}" y="${y + h / 2 + 9}" font-family="${FONT_FAMILY}" font-size="8" fill="${META_COLOR}">${dirPath}</text>`,
		].join("\n");
	} else if (isCollapsedGroup) {
		// An in-scope stub (Focused view's collapsed-directory placeholder)
		// and an in-scope directory box (Collapsed view) are the same
		// concept — a collapsed group — and render identically: no
		// subtitle, since the label is already a relative directory name
		// under the feature being diagrammed, not an ambiguous bare
		// basename. Always top-anchored, since a compound directory box
		// (taller than a leaf) reserves its lower portion for a nested
		// level2 child, so the label can't sit at vertical center without
		// overlapping it; top-anchoring unconditionally keeps every
		// collapsed box's label in the same place regardless of whether it
		// happens to have a nested child.
		inner = [
			`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}"/>`,
			`<text x="${x + 8}" y="${y + 13}" font-family="${FONT_FAMILY}" font-size="11" fill="${TEXT_COLOR}">${label}</text>`,
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
			`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="1"/>`,
			`<text x="${x + 8}" y="${cy}" font-family="${FONT_FAMILY}" font-size="11" fill="${TEXT_COLOR}">${label}</text>`,
			...dots,
		].join("\n");
	}

	return `<g class="node-group" data-id="${node.id}"${opacityAttr}>\n${inner}\n</g>`;
}

// ─── Edge markup ──────────────────────────────────────────────────────────────

export function renderEdgeMarkup(
	edge: PositionedEdge,
	changedIds: ReadonlySet<string>,
): string {
	const color = edgeStroke(edge.diff);
	const opacity = edgeOpacity(edge, changedIds);
	const markerKey = edge.diff ?? "unchanged";
	// Presentation attribute, not inline style: renderer.html's hover
	// highlighting sets `path.style.opacity` directly on mouseover/mouseleave,
	// which takes precedence while hovering and — on mouseleave, where it's
	// reset to "" — falls back to this attribute the rest of the time. That
	// keeps the two de-emphasis mechanisms (baseline proximity opacity here,
	// transient hover-highlight opacity there) from fighting over the same
	// property.
	const opacityAttr = opacity < 1 ? ` opacity="${opacity}"` : "";

	return (edge.sections ?? [])
		.map(
			(section) =>
				`<path data-from="${edge.from}" data-to="${edge.to}" d="${buildEdgePath(section)}" fill="none" stroke="${color}" stroke-width="1.5"${opacityAttr} marker-end="url(#arrow-${markerKey})"/>`,
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
		`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="${containerFill(0)}" stroke="${CONTAINER_STROKE}" stroke-width="1"/>`,
		`<text x="${x + 10}" y="${y + 13}" font-family="${FONT_FAMILY}" font-size="10" fill="${META_COLOR}">${featureLabel}</text>`,
	].join("\n");
}

function renderSubdirMarkup(
	subdirContainers: RenderSubdirContainer[] | undefined,
): string {
	return (subdirContainers ?? [])
		.map(
			(c) =>
				`<g class="subdir-group"><rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="4" fill="${containerFill(c.depth)}" stroke="${CONTAINER_STROKE}" stroke-width="1"/><text x="${c.x + 8}" y="${c.y + 12}" font-family="${FONT_FAMILY}" font-size="10" fill="${STUB_TEXT}">${c.label}</text></g>`,
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

	const changedIds = computeChangedNodeIds(nodes);
	const touchedIds = computeTouchedNodeIds(nodes, edges);
	const nodeMarkup = nodes
		.map((n) => renderNodeMarkup(n, sourceRoot, touchedIds))
		.join("\n");
	const edgeMarkup = edges.map((e) => renderEdgeMarkup(e, changedIds)).join("");

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
