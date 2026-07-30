import { createRequire } from "node:module";
import path from "node:path";
import type {
	ELK as ELKInstance,
	ElkExtendedEdge,
	ElkNode,
} from "elkjs/lib/elk-api.js";
import { oosDisplayPath } from "../analyzer.js";
import type { GraphEdge, GraphNode } from "../types.js";

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

// One box per in-scope first-level subdirectory (issue #28).
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
const NODE_HEIGHT = 40;
const STUB_WIDTH = 120;
const STUB_HEIGHT = 32;
const APPROX_CHAR_WIDTH = 7;
const APPROX_CHAR_WIDTH_SMALL = 5; // px per char at font-size 8
const NODE_PADDING = 24;

function nodeDims(
	node: GraphNode,
	sourceRoot = "src/app",
): { width: number; height: number } {
	if (node.type === "stub") return { width: STUB_WIDTH, height: STUB_HEIGHT };
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

function subdirContainerId(key: string): string {
	return `${SUBDIR_CONTAINER_PREFIX}${key}`;
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
// node (issue #28), instead of being flat siblings. ELK's hierarchical layout
// sizes each container from its own children and never overlaps sibling nodes
// at a given level (compound or leaf), so subdir boxes are a structural
// guarantee rather than a bounding box inferred after the fact from loose
// positions — see docs/superpowers/specs/2026-07-30-subdir-grouping-design.md
// for why an ELK-partitioning-based approach was tried first and rejected.

export async function computeLayout(
	nodes: GraphNode[],
	edges: GraphEdge[],
	sourceRoot = "src/app",
	scopeDir?: string,
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

	// node id -> first-level subdir under scopeDir ("" = feature-root, no box)
	const subdirOf = new Map<string, string>();
	if (scopeDir) {
		for (const n of inScopeNodes) {
			const rel = path.relative(scopeDir, n.file);
			const parts = rel.split(path.sep);
			subdirOf.set(n.id, parts.length > 1 ? parts[0] : "");
		}
	}
	const subdirKeys = [...new Set(subdirOf.values())].filter((k) => k !== "");
	subdirKeys.sort();
	const useSubdirGroups = subdirKeys.length > 0;

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

	const rootLevelInScope = inScopeNodes.filter(
		(n) => (subdirOf.get(n.id) ?? "") === "",
	);
	const bySubdir = new Map<string, GraphNode[]>(subdirKeys.map((k) => [k, []]));
	for (const n of inScopeNodes) {
		const key = subdirOf.get(n.id) ?? "";
		if (key !== "") bySubdir.get(key)?.push(n);
	}

	// Deduplicate edges, then route each to the ELK node whose `edges` array it
	// belongs on. ELK requires an edge to be declared on the lowest common
	// ancestor of its endpoints; with a 2-level hierarchy (root -> subdir ->
	// file) that reduces to: the subdir itself when both endpoints share one,
	// otherwise the root graph.
	type ElkEdgeInput = { id: string; sources: string[]; targets: string[] };
	const seen = new Set<string>();
	const rootEdges: ElkEdgeInput[] = [];
	const subdirEdges = new Map<string, ElkEdgeInput[]>(
		subdirKeys.map((k) => [k, []]),
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
		const fromKey = subdirOf.get(e.from) ?? "";
		const toKey = subdirOf.get(e.to) ?? "";
		if (fromKey !== "" && fromKey === toKey) {
			subdirEdges.get(fromKey)?.push(elkEdge);
		} else {
			rootEdges.push(elkEdge);
		}
	});

	const subdirContainerNodes: ElkNode[] = subdirKeys.map((key) => ({
		id: subdirContainerId(key),
		layoutOptions: {
			"elk.algorithm": "layered",
			"elk.direction": "RIGHT",
			"elk.spacing.nodeNode": "20",
			"elk.layered.spacing.nodeNodeBetweenLayers": "40",
			// Top reserves room for the subdir label drawn inside the box.
			"elk.padding": "[top=16, left=6, bottom=6, right=6]",
			...(usePartitions ? { "elk.partitioning.partition": "0" } : {}),
		},
		children: (bySubdir.get(key) ?? []).map(leafElkNode),
		edges: subdirEdges.get(key) ?? [],
	}));
	const labelByContainerId = new Map(
		subdirKeys.map((key) => [subdirContainerId(key), key]),
	);

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
			// considered together.
			...(useSubdirGroups
				? { "elk.hierarchyHandling": "INCLUDE_CHILDREN" }
				: {}),
		},
		children: [...rootLeafNodes, ...subdirContainerNodes],
		edges: rootEdges,
	};

	const result = await elk.layout(graph);

	// Recursively flatten the (at most 2-level) hierarchy back to absolute
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
		subdirContainers: useSubdirGroups ? subdirContainers : undefined,
	};
}
