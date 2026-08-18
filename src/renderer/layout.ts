import { createRequire } from "node:module";
import path from "node:path";
import type {
	ELK as ELKInstance,
	ElkExtendedEdge,
	ElkNode,
} from "elkjs/lib/elk-api.js";
import { oosDisplayPath } from "../analyzer.js";
import type { GraphEdge, GraphNode } from "../types.js";
import { type DirState, formatDirLabel } from "./dir-label.js";

const _require = createRequire(import.meta.url);
const ELKClass = _require("elkjs/lib/elk.bundled.js") as {
	new (): ELKInstance;
};

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

// One box per in-scope subdirectory, up to 2 levels deep (issue #28).
export interface LayoutSubdirContainer extends LayoutContainer {
	label: string;
}

export interface Layout {
	nodes: LayoutNode[];
	edges: LayoutEdge[];
	width: number;
	height: number;
	container?: LayoutContainer;
	subdirContainers?: LayoutSubdirContainer[];
}

// ─── Node dimensions ──────────────────────────────────────────────────────────

const MIN_NODE_WIDTH = 140;
export const NODE_HEIGHT = 40;
const STUB_MIN_WIDTH = 120;
const STUB_HEIGHT = 32;
const APPROX_CHAR_WIDTH = 7;
const APPROX_CHAR_WIDTH_SMALL = 5; // px per char at font-size 8
const NODE_PADDING = 24;

function nodeDims(
	node: GraphNode,
	sourceRoot = "src/app",
): { width: number; height: number } {
	if (node.type === "stub") {
		// Stub labels now end with a "(N)" member count, which must stay fully
		// visible — the box grows with the label instead of truncating it.
		const labelWidth = node.label.length * APPROX_CHAR_WIDTH + NODE_PADDING;
		return { width: Math.max(STUB_MIN_WIDTH, labelWidth), height: STUB_HEIGHT };
	}
	const labelWidth = node.label.length * APPROX_CHAR_WIDTH + NODE_PADDING;
	let pathWidth = 0;
	if (node.scope === "out-of-scope") {
		const dir = oosDisplayPath(node.file, sourceRoot);
		pathWidth = dir.length * APPROX_CHAR_WIDTH_SMALL + NODE_PADDING;
	}
	const width = Math.max(MIN_NODE_WIDTH, labelWidth, pathWidth);
	return { width, height: NODE_HEIGHT };
}

const SUBDIR_CONTAINER_PREFIX = "__subdir__";

function subdirContainerId(level1: string, level2?: string): string {
	return level2
		? `${SUBDIR_CONTAINER_PREFIX}${level1}/${level2}`
		: `${SUBDIR_CONTAINER_PREFIX}${level1}`;
}

// ─── computeLayout ────────────────────────────────────────────────────────────
// Pure async function; runs in Node only (elkjs uses WASM).
//
// When both in-scope and out-of-scope nodes exist, ELK partitioning is enabled:
// in-scope nodes get partition 0, out-of-scope partition 1. This forces ELK to
// place in-scope nodes in earlier (leftward) layers than oos nodes, guaranteeing
// no oos node falls inside the in-scope bounding box. All edges remain flat so
// ELK routes them normally — no cross-hierarchy issues.
//
// When scopeDir is given, in-scope nodes under a first-level subdirectory are
// additionally nested as real ELK compound children of a per-subdir container
// node (issue #28), instead of being flat siblings. A node one directory
// deeper still (e.g. data-access/store/x.ts) additionally nests inside a
// second compound node for its own subdirectory, capped at 2 levels total —
// deeper nesting folds into that second-level key, the same simplification
// the first level already makes one level up. ELK's hierarchical layout
// sizes each container from its own children and never overlaps sibling
// nodes at a given level (compound or leaf), so subdir boxes — including a
// second-level box nested inside its parent's box — are a structural
// guarantee rather than a bounding box inferred after the fact from loose
// positions — see docs/superpowers/specs/2026-07-30-subdir-grouping-design.md
// and docs/superpowers/specs/2026-08-06-second-level-subdir-grouping-design.md.

export async function computeLayout(
	nodes: GraphNode[],
	edges: GraphEdge[],
	sourceRoot = "src/app",
	scopeDir?: string,
	groupTotals?: Map<string, number>,
): Promise<Layout> {
	const elk = new ELKClass();

	const inScopeNodes = nodes.filter(
		(n) => n.scope === "in-scope" || n.scope === "removed-ghost",
	);
	const oosNodes = nodes.filter((n) => n.scope === "out-of-scope");
	const usePartitions = inScopeNodes.length > 0 && oosNodes.length > 0;
	// The in-scope container box (drawn below) only needs in-scope nodes to
	// exist — it doesn't depend on partitioning, which is solely about keeping
	// oos nodes out of that box when oos nodes are present.
	const showContainer = inScopeNodes.length > 0;

	// node id -> { level1, level2 } under scopeDir. level1 = "" means the node
	// is at the feature root (no box). level2 = "" means the node sits
	// directly in its level1 subdirectory (no nested box); a file 3+
	// directories deep still collapses into its level2 key, the same
	// simplification the level1 key already makes one level up.
	interface SubdirKey {
		level1: string;
		level2: string;
	}
	const subdirOf = new Map<string, SubdirKey>();
	if (scopeDir) {
		for (const n of inScopeNodes) {
			const rel = path.relative(scopeDir, n.file);
			const parts = rel.split(path.sep);
			const level1 = parts.length > 1 ? parts[0] : "";
			const level2 = level1 !== "" && parts.length > 2 ? parts[1] : "";
			subdirOf.set(n.id, { level1, level2 });
		}
	}
	const level1Keys = [
		...new Set([...subdirOf.values()].map((k) => k.level1)),
	].filter((k) => k !== "");
	level1Keys.sort();
	const useSubdirGroups = level1Keys.length > 0;

	const level2KeysByLevel1 = new Map<string, string[]>();
	for (const key1 of level1Keys) {
		const keys2 = [
			...new Set(
				[...subdirOf.values()]
					.filter((k) => k.level1 === key1)
					.map((k) => k.level2),
			),
		].filter((k) => k !== "");
		keys2.sort();
		level2KeysByLevel1.set(key1, keys2);
	}

	function leafElkNode(n: GraphNode): ElkNode {
		return {
			id: n.id,
			...nodeDims(n, sourceRoot),
			...(usePartitions
				? {
						layoutOptions: {
							"elk.partitioning.partition":
								n.scope === "out-of-scope" ? "1" : "0",
						},
					}
				: {}),
		};
	}

	function subdirLayoutOptions(): Record<string, string> {
		return {
			"elk.algorithm": "layered",
			"elk.direction": "RIGHT",
			"elk.spacing.nodeNode": "20",
			"elk.layered.spacing.nodeNodeBetweenLayers": "40",
			// Top reserves room for the subdir label drawn inside the box.
			"elk.padding": "[top=16, left=6, bottom=6, right=6]",
			...(usePartitions ? { "elk.partitioning.partition": "0" } : {}),
		};
	}

	const rootLevelInScope = inScopeNodes.filter(
		(n) => (subdirOf.get(n.id)?.level1 ?? "") === "",
	);

	// Nodes directly in a level1 dir (level2 === ""), and nodes under a
	// level1/level2 pair.
	const directByLevel1 = new Map<string, GraphNode[]>(
		level1Keys.map((k) => [k, []]),
	);
	const byLevel1Level2 = new Map<string, GraphNode[]>();
	for (const key1 of level1Keys) {
		for (const key2 of level2KeysByLevel1.get(key1) ?? []) {
			byLevel1Level2.set(`${key1}/${key2}`, []);
		}
	}
	for (const n of inScopeNodes) {
		const key = subdirOf.get(n.id);
		if (!key || key.level1 === "") continue;
		if (key.level2 === "") {
			directByLevel1.get(key.level1)?.push(n);
		} else {
			byLevel1Level2.get(`${key.level1}/${key.level2}`)?.push(n);
		}
	}

	// Deduplicate edges, then route each to the ELK node whose `edges` array it
	// belongs on. ELK requires an edge to be declared on the lowest common
	// ancestor of its endpoints; with an up-to-3-level hierarchy (root ->
	// level1 -> level2 -> file) that reduces to: the level2 container when
	// both endpoints share one, else the level1 container when both endpoints
	// share that, else the root graph.
	type ElkEdgeInput = { id: string; sources: string[]; targets: string[] };
	const seen = new Set<string>();
	const rootEdges: ElkEdgeInput[] = [];
	const level1Edges = new Map<string, ElkEdgeInput[]>(
		level1Keys.map((k) => [k, []]),
	);
	const level2Edges = new Map<string, ElkEdgeInput[]>(
		[...byLevel1Level2.keys()].map((k) => [k, []]),
	);
	edges.forEach((e, i) => {
		const key = `${e.from}→${e.to}`;
		if (seen.has(key)) return;
		seen.add(key);
		const elkEdge: ElkEdgeInput = {
			id: `e${i}`,
			sources: [e.from],
			targets: [e.to],
		};
		const fromKey = subdirOf.get(e.from);
		const toKey = subdirOf.get(e.to);
		const from1 = fromKey?.level1 ?? "";
		const to1 = toKey?.level1 ?? "";
		const from2 = fromKey?.level2 ?? "";
		const to2 = toKey?.level2 ?? "";
		if (from1 !== "" && from1 === to1 && from2 !== "" && from2 === to2) {
			level2Edges.get(`${from1}/${from2}`)?.push(elkEdge);
		} else if (from1 !== "" && from1 === to1) {
			level1Edges.get(from1)?.push(elkEdge);
		} else {
			rootEdges.push(elkEdge);
		}
	});

	const level2ContainerNodesByLevel1 = new Map<string, ElkNode[]>();
	for (const key1 of level1Keys) {
		const nodes2: ElkNode[] = (level2KeysByLevel1.get(key1) ?? []).map(
			(key2) => ({
				id: subdirContainerId(key1, key2),
				layoutOptions: subdirLayoutOptions(),
				children: (byLevel1Level2.get(`${key1}/${key2}`) ?? []).map(
					leafElkNode,
				),
				edges: level2Edges.get(`${key1}/${key2}`) ?? [],
			}),
		);
		level2ContainerNodesByLevel1.set(key1, nodes2);
	}

	const subdirContainerNodes: ElkNode[] = level1Keys.map((key1) => ({
		id: subdirContainerId(key1),
		layoutOptions: subdirLayoutOptions(),
		children: [
			...(directByLevel1.get(key1) ?? []).map(leafElkNode),
			...(level2ContainerNodesByLevel1.get(key1) ?? []),
		],
		edges: level1Edges.get(key1) ?? [],
	}));

	// A container box's total member count can exceed what's actually placed
	// inside it (a "partial" group, per graph-helpers.ts's computeViewNodes) —
	// groupTotals carries the true count for those; absent an entry, the
	// visible count IS the total (nothing hidden, i.e. "open"). There's no
	// "closed" case here: a fully-collapsed group never reaches this
	// function at all — it's a single atomic stub node, not a container box.
	const labelByContainerId = new Map<string, string>();
	for (const key1 of level1Keys) {
		const level2Keys = level2KeysByLevel1.get(key1) ?? [];
		const level1DirectVisible = directByLevel1.get(key1)?.length ?? 0;
		const level1NestedVisible = level2Keys.reduce(
			(sum, key2) => sum + (byLevel1Level2.get(`${key1}/${key2}`)?.length ?? 0),
			0,
		);
		const level1Visible = level1DirectVisible + level1NestedVisible;
		const level1Total = groupTotals?.get(key1) ?? level1Visible;
		const level1State: DirState =
			level1Total > level1Visible ? "partial" : "open";
		labelByContainerId.set(
			subdirContainerId(key1),
			formatDirLabel(level1State, key1, level1Total),
		);
		for (const key2 of level2Keys) {
			const level2Visible = byLevel1Level2.get(`${key1}/${key2}`)?.length ?? 0;
			const level2Total = groupTotals?.get(`${key1}/${key2}`) ?? level2Visible;
			const level2State: DirState =
				level2Total > level2Visible ? "partial" : "open";
			labelByContainerId.set(
				subdirContainerId(key1, key2),
				formatDirLabel(level2State, key2, level2Total),
			);
		}
	}

	const rootLeafNodes: ElkNode[] = [
		...rootLevelInScope.map(leafElkNode),
		...oosNodes.map(leafElkNode),
	];

	const graph: ElkNode = {
		id: "root",
		layoutOptions: {
			"elk.algorithm": "layered",
			"elk.direction": "RIGHT",
			...(usePartitions ? { "elk.partitioning.activate": "true" } : {}),
			"elk.spacing.nodeNode": "20",
			"elk.layered.spacing.nodeNodeBetweenLayers": "40",
			// When the container box will be drawn, top needs 55px so its label
			// (minY − 35) stays above y=0. Left needs 40px so the container left
			// edge (minX − 15) isn't cramped.
			"elk.padding": showContainer
				? "[top=55, left=40, bottom=35, right=35]"
				: "[top=20, left=20, bottom=20, right=20]",
			// Without this, ELK treats each subdir compound node as an isolated
			// sub-layout and silently fails to route any edge crossing into or
			// out of it (0 sections returned, nothing drawn) — every edge
			// touching a subdir-grouped node needs the whole hierarchy
			// considered together, regardless of how many levels it crosses.
			...(useSubdirGroups
				? { "elk.hierarchyHandling": "INCLUDE_CHILDREN" }
				: {}),
		},
		children: [...rootLeafNodes, ...subdirContainerNodes],
		edges: rootEdges,
	};

	const result = await elk.layout(graph);

	// Recursively flatten the (at most 3-level) hierarchy back to absolute
	// canvas coordinates. ELK returns each child's x/y relative to its own
	// parent's origin, and edge sections declared on a compound node are in
	// that same local frame — so both need the accumulated parent offset added.
	const layoutNodes: LayoutNode[] = [];
	const layoutEdges: LayoutEdge[] = [];
	const subdirContainers: LayoutSubdirContainer[] = [];

	function walk(node: ElkNode, offsetX: number, offsetY: number): void {
		for (const child of node.children ?? []) {
			const absX = offsetX + (child.x ?? 0);
			const absY = offsetY + (child.y ?? 0);
			const label = labelByContainerId.get(child.id);
			if (label !== undefined) {
				subdirContainers.push({
					x: absX,
					y: absY,
					width: child.width ?? 0,
					height: child.height ?? 0,
					label,
				});
				walk(child, absX, absY);
			} else {
				layoutNodes.push({
					id: child.id,
					x: absX,
					y: absY,
					width: child.width ?? MIN_NODE_WIDTH,
					height: child.height ?? NODE_HEIGHT,
				});
			}
		}
		for (const e of node.edges ?? []) {
			const ext = e as ElkExtendedEdge & {
				sources?: string[];
				targets?: string[];
			};
			const from = ext.sources?.[0] ?? "";
			const to = ext.targets?.[0] ?? "";
			const sections: LayoutEdgeSection[] = (ext.sections ?? []).map((s) => ({
				startPoint: {
					x: s.startPoint.x + offsetX,
					y: s.startPoint.y + offsetY,
				},
				endPoint: { x: s.endPoint.x + offsetX, y: s.endPoint.y + offsetY },
				...(s.bendPoints
					? {
							bendPoints: s.bendPoints.map((bp) => ({
								x: bp.x + offsetX,
								y: bp.y + offsetY,
							})),
						}
					: {}),
			}));
			layoutEdges.push({ from, to, sections });
		}
	}
	walk(result, 0, 0);

	// Compute the in-scope container box from actual node positions post-layout.
	// When oos nodes are present, partitioning guarantees they're at higher x
	// values, so none fall inside this bounding box.
	let container: LayoutContainer | undefined;
	if (showContainer) {
		const inScopeIds = new Set(inScopeNodes.map((n) => n.id));
		const inScopeLayout = layoutNodes.filter((n) => inScopeIds.has(n.id));
		if (inScopeLayout.length > 0) {
			const PAD = 15;
			const LABEL_H = 20;
			const minX = Math.min(
				...inScopeLayout.map((n) => n.x),
				...subdirContainers.map((c) => c.x),
			);
			const minY = Math.min(
				...inScopeLayout.map((n) => n.y),
				...subdirContainers.map((c) => c.y),
			);
			const maxX = Math.max(
				...inScopeLayout.map((n) => n.x + n.width),
				...subdirContainers.map((c) => c.x + c.width),
			);
			const maxY = Math.max(
				...inScopeLayout.map((n) => n.y + n.height),
				...subdirContainers.map((c) => c.y + c.height),
			);
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
		subdirContainers: useSubdirGroups ? subdirContainers : undefined,
	};
}

// ─── computeClusteredLayout ───────────────────────────────────────────────────
// Lays out the synthetic directory-node graph produced by
// computeViewNodes(graph, "collapsed") (src/renderer/graph-helpers.ts).
// Unlike computeLayout's scopeDir grouping, where a subdir box is an outline
// *wrapper* around real leaf files, here each directory node IS the rendered
// content: a level1 node's own ELK node becomes a compound node containing
// its level2 child (if one exists), rather than a separate wrapper around
// it. This still reuses the same structural-nesting technique (real ELK
// compound/hierarchical layout, INCLUDE_CHILDREN) computeLayout uses, for
// the same reason: non-overlap and correct edge routing are structural
// guarantees, not inferred from post-layout positions. See
// docs/superpowers/specs/2026-08-07-clustered-view-design.md.

export async function computeClusteredLayout(
	nodes: GraphNode[],
	edges: GraphEdge[],
	sourceRoot: string,
	scopeDir: string,
): Promise<Layout> {
	const elk = new ELKClass();

	const inScopeNodes = nodes.filter(
		(n) => n.scope === "in-scope" || n.scope === "removed-ghost",
	);
	const oosNodes = nodes.filter((n) => n.scope === "out-of-scope");
	const usePartitions = inScopeNodes.length > 0 && oosNodes.length > 0;
	const showContainer = inScopeNodes.length > 0;

	// Each in-scope node's own path depth under scopeDir. A directory node's
	// `.file` is the directory's own path (set by computeClusteredNodes), so a
	// node whose relative path is 1 segment IS a level1 directory (or a real
	// root-level file — both are plain leaves unless something nests under
	// them), and a node whose relative path is 2 segments is a level2 child
	// that nests inside whichever level1 node shares its first segment.
	const segmentsOf = new Map<string, string[]>();
	for (const n of inScopeNodes) {
		segmentsOf.set(n.id, path.relative(scopeDir, n.file).split(path.sep));
	}

	const level2ChildrenByLevel1Segment = new Map<string, GraphNode[]>();
	for (const n of inScopeNodes) {
		const parts = segmentsOf.get(n.id) ?? [];
		if (parts.length === 2) {
			if (!level2ChildrenByLevel1Segment.has(parts[0])) {
				level2ChildrenByLevel1Segment.set(parts[0], []);
			}
			level2ChildrenByLevel1Segment.get(parts[0])?.push(n);
		}
	}
	const level2NodeIds = new Set(
		[...level2ChildrenByLevel1Segment.values()].flatMap((children) =>
			children.map((n) => n.id),
		),
	);

	function leafElkNode(n: GraphNode): ElkNode {
		return {
			id: n.id,
			...nodeDims(n, sourceRoot),
			...(usePartitions
				? {
						layoutOptions: {
							"elk.partitioning.partition":
								n.scope === "out-of-scope" ? "1" : "0",
						},
					}
				: {}),
		};
	}

	// Top-level ELK children: real root-level files and level1 directory
	// nodes (compound if they have a level2 child, otherwise a plain leaf via
	// leafElkNode), plus oos directory nodes. Level2 nodes are never
	// top-level — they're always the sole child of their level1 node.
	const topLevel = inScopeNodes.filter((n) => !level2NodeIds.has(n.id));

	// level1 path segment -> id of the level1 ELK node it names, restricted to
	// level1 nodes that actually have level2 children (i.e. will be compound).
	// Used below to find, for a level2 node id, which level1 node it nests
	// inside — the LCA an edge between two such siblings must be declared on.
	const level1NodeIdBySegment = new Map<string, string>();
	for (const n of topLevel) {
		const parts = segmentsOf.get(n.id) ?? [];
		if (parts.length === 1 && level2ChildrenByLevel1Segment.has(parts[0])) {
			level1NodeIdBySegment.set(parts[0], n.id);
		}
	}
	function containingLevel1Id(nodeId: string): string | undefined {
		const parts = segmentsOf.get(nodeId) ?? [];
		return parts.length === 2 ? level1NodeIdBySegment.get(parts[0]) : undefined;
	}

	// Deduplicate edges, then route each to the ELK node whose `edges` array it
	// belongs on: the level1 compound node when both endpoints are level2
	// siblings nested under it (ELK requires an edge declared on its lowest
	// common ancestor — declaring it on root instead, relying on
	// elk.hierarchyHandling: INCLUDE_CHILDREN to route it anyway, produces a
	// degenerate section in the wrong coordinate frame, floating outside the
	// parent's box), else the root graph (same as computeLayout already does
	// for genuinely cross-hierarchy edges). An edge between a level1 node and
	// its own level2 child is not a shape this function needs to handle
	// specially: computeClusteredNodes (graph-helpers.ts) never emits one —
	// verified empirically that ELK cannot route it as a meaningful, visible
	// edge at this compound-node depth regardless of which node's `edges`
	// array it's declared on (both the LCA-declared and root-declared
	// placements produced a degenerate section fully contained within the
	// parent's own box), so that edge shape is dropped upstream instead.
	type ElkEdgeInput = { id: string; sources: string[]; targets: string[] };
	const seen = new Set<string>();
	const rootEdges: ElkEdgeInput[] = [];
	const level1EdgesById = new Map<string, ElkEdgeInput[]>();
	edges.forEach((e, i) => {
		const key = `${e.from}→${e.to}`;
		if (seen.has(key)) return;
		seen.add(key);
		const elkEdge = { id: `e${i}`, sources: [e.from], targets: [e.to] };
		const fromParent = containingLevel1Id(e.from);
		const toParent = containingLevel1Id(e.to);
		if (fromParent !== undefined && fromParent === toParent) {
			if (!level1EdgesById.has(fromParent)) level1EdgesById.set(fromParent, []);
			level1EdgesById.get(fromParent)?.push(elkEdge);
		} else {
			rootEdges.push(elkEdge);
		}
	});

	const level1Children: ElkNode[] = topLevel.map((n) => {
		const parts = segmentsOf.get(n.id) ?? [];
		const level2Children =
			parts.length === 1
				? (level2ChildrenByLevel1Segment.get(parts[0]) ?? [])
				: [];
		if (level2Children.length === 0) return leafElkNode(n);
		return {
			id: n.id,
			layoutOptions: {
				"elk.algorithm": "layered",
				"elk.direction": "RIGHT",
				"elk.spacing.nodeNode": "20",
				"elk.layered.spacing.nodeNodeBetweenLayers": "40",
				// Top reserves room for this node's own label, drawn the same
				// way any other node's label is; the nested level2 child sits
				// in the remaining space below it.
				"elk.padding": "[top=28, left=8, bottom=8, right=8]",
				...(usePartitions ? { "elk.partitioning.partition": "0" } : {}),
			},
			children: level2Children.map(leafElkNode),
			edges: level1EdgesById.get(n.id) ?? [],
		};
	});

	const graph: ElkNode = {
		id: "root",
		layoutOptions: {
			"elk.algorithm": "layered",
			"elk.direction": "RIGHT",
			...(usePartitions ? { "elk.partitioning.activate": "true" } : {}),
			"elk.spacing.nodeNode": "20",
			"elk.layered.spacing.nodeNodeBetweenLayers": "40",
			"elk.padding": showContainer
				? "[top=55, left=40, bottom=35, right=35]"
				: "[top=20, left=20, bottom=20, right=20]",
			"elk.hierarchyHandling": "INCLUDE_CHILDREN",
		},
		children: [...level1Children, ...oosNodes.map(leafElkNode)],
		edges: rootEdges,
	};

	const result = await elk.layout(graph);

	// Every ELK child (compound or leaf) is a real, rendered LayoutNode here —
	// unlike computeLayout, there's no separate "wrapper vs real content"
	// distinction. Parents are pushed before their children, so array order
	// alone gives the correct draw order (outer box first, nested box drawn
	// on top of it).
	const layoutNodes: LayoutNode[] = [];
	const layoutEdges: LayoutEdge[] = [];

	function walk(node: ElkNode, offsetX: number, offsetY: number): void {
		for (const child of node.children ?? []) {
			const absX = offsetX + (child.x ?? 0);
			const absY = offsetY + (child.y ?? 0);
			layoutNodes.push({
				id: child.id,
				x: absX,
				y: absY,
				width: child.width ?? MIN_NODE_WIDTH,
				height: child.height ?? NODE_HEIGHT,
			});
			if (child.children && child.children.length > 0) {
				walk(child, absX, absY);
			}
		}
		for (const e of node.edges ?? []) {
			const ext = e as ElkExtendedEdge & {
				sources?: string[];
				targets?: string[];
			};
			const from = ext.sources?.[0] ?? "";
			const to = ext.targets?.[0] ?? "";
			const sections: LayoutEdgeSection[] = (ext.sections ?? []).map((s) => ({
				startPoint: {
					x: s.startPoint.x + offsetX,
					y: s.startPoint.y + offsetY,
				},
				endPoint: { x: s.endPoint.x + offsetX, y: s.endPoint.y + offsetY },
				...(s.bendPoints
					? {
							bendPoints: s.bendPoints.map((bp) => ({
								x: bp.x + offsetX,
								y: bp.y + offsetY,
							})),
						}
					: {}),
			}));
			layoutEdges.push({ from, to, sections });
		}
	}
	walk(result, 0, 0);

	let container: LayoutContainer | undefined;
	if (showContainer) {
		const inScopeIds = new Set(inScopeNodes.map((n) => n.id));
		const inScopeLayout = layoutNodes.filter((n) => inScopeIds.has(n.id));
		if (inScopeLayout.length > 0) {
			const PAD = 15;
			const LABEL_H = 20;
			const minX = Math.min(...inScopeLayout.map((n) => n.x));
			const minY = Math.min(...inScopeLayout.map((n) => n.y));
			const maxX = Math.max(...inScopeLayout.map((n) => n.x + n.width));
			const maxY = Math.max(...inScopeLayout.map((n) => n.y + n.height));
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
