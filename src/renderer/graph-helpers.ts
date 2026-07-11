import path from "node:path";
import type { Graph, GraphEdge, GraphNode } from "../types.js";

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
	mode: "all" | "diff-focused",
): { nodes: GraphNode[]; edges: GraphEdge[] } {
	if (mode === "all") {
		return { nodes: graph.nodes, edges: graph.edges };
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

	for (const [subdir, nodes] of inScopeGroups) {
		if (subdir === "__root__" || !allUnchanged(nodes)) {
			for (const n of nodes) outputNodes.push(n);
		} else {
			const stub = makeStub(
				`stub_${sanitize(subdir)}`,
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
			const stub = makeStub(
				`stub_oos_${sanitize(dir)}`,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DIFF_PRIORITY: Record<string, number> = {
	added: 3,
	removed: 2,
	modified: 1,
	unchanged: 0,
};

function diffPriority(diff: GraphEdge["diff"]): number {
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
