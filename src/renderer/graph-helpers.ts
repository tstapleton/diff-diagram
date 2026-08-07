import path from "node:path";
import { dedupeId } from "../analyzer.js";
import type { DiffState, Graph, GraphEdge, GraphNode } from "../types.js";

// ─── computeViewNodes ─────────────────────────────────────────────────────────
// Returns nodes and edges for a given view mode.
//
// 'all'          → all nodes and edges, no collapsing
// 'diff-focused' → collapse rules:
//   • In-scope subdirs where every node is unchanged → one stub per subdir
//   • Out-of-scope parent dirs where every node is unchanged → one stub per dir
//   • Partially-changed dirs (any node added/modified/removed) → fully expanded
//   • Stubs inherit edges (edges to collapsed nodes redirect to stub)

export function computeViewNodes(
	graph: Graph,
	mode: "all" | "diff-focused" | "clustered",
): { nodes: GraphNode[]; edges: GraphEdge[] } {
	if (mode === "all") {
		return { nodes: graph.nodes, edges: graph.edges };
	}
	if (mode === "clustered") {
		return computeClusteredNodes(graph);
	}

	const scopeDir = graph.meta.scopeDir; // repo-relative, e.g. "src/app/features/users"

	const inScopeNodes = graph.nodes.filter(
		(n) => n.scope === "in-scope" || n.scope === "removed-ghost",
	);
	const oosNodes = graph.nodes.filter((n) => n.scope === "out-of-scope");

	// ── Group in-scope nodes by immediate subdir ──────────────────────────────
	const inScopeGroups = new Map<string, GraphNode[]>();
	for (const node of inScopeNodes) {
		const rel = path.relative(scopeDir, node.file);
		const parts = rel.split(path.sep);
		const key = parts.length > 1 ? parts[0] : "__root__";
		appendToGroup(inScopeGroups, key, node);
	}

	const outputNodes: GraphNode[] = [];
	const collapsedMap = new Map<string, string>(); // original id → stub id
	// Reverse index (generated stub id → source dir key) used to disambiguate
	// stub ids when two different dirs sanitize to the same string, e.g.
	// "shared/api" and "shared-api" both → "shared_api" (BUG-11).
	const stubIdSources = new Map<string, string>();

	for (const [subdir, nodes] of inScopeGroups) {
		if (subdir === "__root__" || !allUnchanged(nodes)) {
			for (const n of nodes) outputNodes.push(n);
		} else {
			const sourceKey = `in:${subdir}`;
			const stub = makeStub(
				dedupeId(`stub_${sanitize(subdir)}`, sourceKey, stubIdSources),
				subdir,
				path.join(scopeDir, subdir),
				"in-scope",
			);
			outputNodes.push(stub);
			for (const n of nodes) collapsedMap.set(n.id, stub.id);
		}
	}

	// ── Group out-of-scope nodes by parent directory ──────────────────────────
	const oosGroups = new Map<string, GraphNode[]>();
	for (const node of oosNodes) {
		const key = path.dirname(node.file);
		appendToGroup(oosGroups, key, node);
	}

	for (const [dir, nodes] of oosGroups) {
		if (!allUnchanged(nodes)) {
			for (const n of nodes) outputNodes.push(n);
		} else {
			const sourceKey = `oos:${dir}`;
			const stub = makeStub(
				dedupeId(`stub_oos_${sanitize(dir)}`, sourceKey, stubIdSources),
				path.basename(dir),
				dir,
				"out-of-scope",
			);
			outputNodes.push(stub);
			for (const n of nodes) collapsedMap.set(n.id, stub.id);
		}
	}

	// ── Remap edges to stubs, dedup ──────────────────────────────────────────
	// Duplicates keep the highest-priority diff state so added/removed imports
	// into a collapsed dir are not masked by surviving unchanged imports.
	const edgeMap = new Map<string, GraphEdge>();

	for (const edge of graph.edges) {
		const from = collapsedMap.get(edge.from) ?? edge.from;
		const to = collapsedMap.get(edge.to) ?? edge.to;
		if (from === to) continue;
		const key = `${from}→${to}:${edge.kind}`;
		const existing = edgeMap.get(key);
		if (existing && diffPriority(existing.diff) >= diffPriority(edge.diff)) {
			continue;
		}
		edgeMap.set(key, { ...edge, from, to });
	}

	return { nodes: outputNodes, edges: [...edgeMap.values()] };
}

// ─── 'clustered' mode ───────────────────────────────────────────────────────
// Collapses every in-scope subdirectory (up to 2 levels deep, same cap as
// src/renderer/layout.ts's box-grouping) and every out-of-scope parent
// directory to a single synthetic node, regardless of diff state — for
// high-level orientation on features with many files. See
// docs/superpowers/specs/2026-08-07-clustered-view-design.md.

function computeClusteredNodes(graph: Graph): {
	nodes: GraphNode[];
	edges: GraphEdge[];
} {
	const scopeDir = graph.meta.scopeDir;
	const inScopeNodes = graph.nodes.filter(
		(n) => n.scope === "in-scope" || n.scope === "removed-ghost",
	);
	const oosNodes = graph.nodes.filter((n) => n.scope === "out-of-scope");

	// node id -> { level1, level2 }, same rule as layout.ts's subdirOf.
	interface DirKey {
		level1: string;
		level2: string;
	}
	const keyOf = new Map<string, DirKey>();
	for (const n of inScopeNodes) {
		const rel = path.relative(scopeDir, n.file);
		const parts = rel.split(path.sep);
		const level1 = parts.length > 1 ? parts[0] : "";
		const level2 = level1 !== "" && parts.length > 2 ? parts[1] : "";
		keyOf.set(n.id, { level1, level2 });
	}

	const rootNodes = inScopeNodes.filter(
		(n) => (keyOf.get(n.id)?.level1 ?? "") === "",
	);
	const level1Keys = [
		...new Set(
			[...keyOf.values()].map((k) => k.level1).filter((k) => k !== ""),
		),
	].sort();

	const stubIdSources = new Map<string, string>();
	const outputNodes: GraphNode[] = [...rootNodes];
	const collapsedMap = new Map<string, string>(); // original node id -> directory node id
	const dirParentOf = new Map<string, string>(); // level2 directory node id -> its level1 directory node id

	for (const level1 of level1Keys) {
		// Everything under this level1 dir, both direct files and anything
		// nested under a level2 subdirectory — a level1 node's color reflects
		// the whole subtree it visually contains, not just its direct files,
		// and it must exist even when it has zero direct files of its own (a
		// level2 child still needs a level1 box to nest inside).
		const allUnder = inScopeNodes.filter(
			(n) => keyOf.get(n.id)?.level1 === level1,
		);
		const level1Id = dedupeId(
			`dir_${sanitize(level1)}`,
			`dir:${level1}`,
			stubIdSources,
		);
		outputNodes.push(
			makeDirNode(
				level1Id,
				level1,
				path.join(scopeDir, level1),
				"in-scope",
				allUnder,
			),
		);
		for (const n of allUnder) collapsedMap.set(n.id, level1Id);

		const level2Keys = [
			...new Set(
				allUnder
					.map((n) => keyOf.get(n.id)?.level2 ?? "")
					.filter((k) => k !== ""),
			),
		].sort();
		for (const level2 of level2Keys) {
			const level2Members = allUnder.filter(
				(n) => keyOf.get(n.id)?.level2 === level2,
			);
			const level2Id = dedupeId(
				`dir_${sanitize(level1)}_${sanitize(level2)}`,
				`dir:${level1}/${level2}`,
				stubIdSources,
			);
			outputNodes.push(
				makeDirNode(
					level2Id,
					level2,
					path.join(scopeDir, level1, level2),
					"in-scope",
					level2Members,
				),
			);
			dirParentOf.set(level2Id, level1Id);
			// Overwrite: a level2 member's collapse target is its level2 node,
			// not the level1 node the earlier loop pointed it at.
			for (const n of level2Members) collapsedMap.set(n.id, level2Id);
		}
	}

	// ── Out-of-scope: one flat node per immediate parent directory ───────────
	const oosGroups = new Map<string, GraphNode[]>();
	for (const n of oosNodes) {
		const dir = path.dirname(n.file);
		if (!oosGroups.has(dir)) oosGroups.set(dir, []);
		oosGroups.get(dir)?.push(n);
	}
	for (const [dir, members] of oosGroups) {
		const oosId = dedupeId(
			`dir_oos_${sanitize(dir)}`,
			`dir:oos:${dir}`,
			stubIdSources,
		);
		outputNodes.push(
			makeDirNode(oosId, path.basename(dir), dir, "out-of-scope", members),
		);
		for (const n of members) collapsedMap.set(n.id, oosId);
	}

	// ── Remap edges, dedup keeping the highest-priority diff state ───────────
	// Drops self-loops (both endpoints collapse to the same directory node)
	// and parent-to-own-child edges (one directory node is the other's level1
	// container) — ELK cannot route either as a meaningful, visible edge at
	// this compound-node depth (verified empirically: both the LCA-declared
	// and root-declared placements produce a degenerate section fully
	// contained within the parent's own box), and "a directory imports from
	// its own subdirectory" isn't the kind of relationship this zoomed-out
	// view is meant to surface anyway.
	const edgeMap = new Map<string, GraphEdge>();
	for (const edge of graph.edges) {
		const from = collapsedMap.get(edge.from) ?? edge.from;
		const to = collapsedMap.get(edge.to) ?? edge.to;
		if (from === to) continue;
		if (dirParentOf.get(to) === from || dirParentOf.get(from) === to) continue;
		const key = `${from}→${to}`;
		const existing = edgeMap.get(key);
		if (existing && diffPriority(existing.diff) >= diffPriority(edge.diff)) {
			continue;
		}
		edgeMap.set(key, { ...edge, from, to });
	}

	return { nodes: outputNodes, edges: [...edgeMap.values()] };
}

function makeDirNode(
	id: string,
	label: string,
	file: string,
	scope: "in-scope" | "out-of-scope",
	members: GraphNode[],
): GraphNode {
	const dominant = members.reduce<DiffState>((best, n) => {
		return diffPriority(n.diff) > diffPriority(best)
			? (n.diff ?? "unchanged")
			: best;
	}, "unchanged");
	return { id, label, file, type: "directory", scope, diff: dominant };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DIFF_PRIORITY: Record<string, number> = {
	added: 3,
	removed: 2,
	modified: 1,
	unchanged: 0,
};

export function diffPriority(diff: DiffState | null | undefined): number {
	return diff ? DIFF_PRIORITY[diff] : 0;
}

function allUnchanged(nodes: GraphNode[]): boolean {
	return nodes.every((n) => n.diff === "unchanged" || n.diff === null);
}

function makeStub(
	id: string,
	label: string,
	file: string,
	scope: "in-scope" | "out-of-scope",
): GraphNode {
	return { id, label, file, type: "stub", scope, diff: "unchanged" };
}

function sanitize(s: string): string {
	return s
		.replace(/[^a-zA-Z0-9]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "");
}

function appendToGroup<K, V>(map: Map<K, V[]>, key: K, value: V): void {
	if (!map.has(key)) map.set(key, []);
	map.get(key)?.push(value);
}
