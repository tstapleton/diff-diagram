import path from "node:path";
import { dedupeId } from "../analyzer.js";
import type { DiffState, Graph, GraphEdge, GraphNode } from "../types.js";
import { formatDirLabel } from "./dir-label.js";

// ─── computeViewNodes ─────────────────────────────────────────────────────────
// Returns nodes and edges for a given view mode.
//
// 'expanded' → all nodes and edges, no collapsing
// 'focused'  → collapse rules:
//   • In-scope subdirs where every node is unchanged → one stub per subdir
//   • Out-of-scope parent dirs where every node is unchanged → one stub per dir
//   • Partially-changed dirs (any node added/modified/removed) → fully expanded
//   • In-scope subdirs where every node is content-unchanged but a proper
//     subset is touched (as either endpoint) by an added/removed/modified
//     edge → only the touched members are shown individually ("partial");
//     the rest are dropped entirely (no stand-in node), which is lossless
//     because a hidden member has, by construction, zero diff-relevant
//     edges touching it in either direction
//   • Stubs inherit edges (edges to collapsed nodes redirect to stub)

export function computeViewNodes(
	graph: Graph,
	mode: "expanded" | "focused" | "collapsed",
): {
	nodes: GraphNode[];
	edges: GraphEdge[];
	groupTotals?: Map<string, number>;
} {
	if (mode === "expanded") {
		return { nodes: graph.nodes, edges: graph.edges };
	}
	if (mode === "collapsed") {
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

	// A member is "touched" if it's either endpoint of an added/removed/
	// modified edge — not incoming-only: a content-unchanged file's outgoing
	// edges aren't guaranteed unchanged (e.g. its import target was deleted,
	// or it imports through a barrel whose re-exports changed), so both
	// directions must be checked for the "hidden members carry no
	// diff-relevant edges" invariant below to actually hold.
	const touchedIds = new Set<string>();
	for (const e of graph.edges) {
		if (diffPriority(e.diff) > 0) {
			touchedIds.add(e.from);
			touchedIds.add(e.to);
		}
	}

	const outputNodes: GraphNode[] = [];
	const collapsedMap = new Map<string, string>(); // original id → stub id
	const groupTotals = new Map<string, number>(); // subdir key → true member count, for partial groups only
	// Reverse index (generated stub id → source dir key) used to disambiguate
	// stub ids when two different dirs sanitize to the same string, e.g.
	// "shared/api" and "shared-api" both → "shared_api" (BUG-11).
	const stubIdSources = new Map<string, string>();

	for (const [subdir, nodes] of inScopeGroups) {
		if (subdir === "__root__") {
			for (const n of nodes) outputNodes.push(n);
			continue;
		}
		if (!allUnchanged(nodes)) {
			// The level-1 group has a genuine change somewhere in it, but the
			// layout only ever boxes 2 levels deep (layout.ts's subdirOf), so a
			// change 3+ directories deep shouldn't force every unrelated
			// level-2 subdirectory under this level-1 dir to expand too. Re-run
			// the same collapse/partial/expand decision one level down, per
			// level-2 bucket, instead of dumping the whole group flat.
			const level2Groups = new Map<string, GraphNode[]>();
			for (const n of nodes) {
				const parts = path.relative(scopeDir, n.file).split(path.sep);
				const level2 = parts.length > 2 ? parts[1] : "";
				appendToGroup(level2Groups, level2, n);
			}
			let anyLevel2Hidden = false;
			for (const [level2, level2Nodes] of level2Groups) {
				if (level2 === "" || !allUnchanged(level2Nodes)) {
					// Files directly in the level-1 dir (no level2 box exists to
					// collapse into) or a level-2 bucket with its own genuine
					// change: show individually, same as today's fallback.
					for (const n of level2Nodes) outputNodes.push(n);
					continue;
				}
				const level2Visible = level2Nodes.filter((n) => touchedIds.has(n.id));
				if (level2Visible.length === 0) {
					const sourceKey = `in:${subdir}/${level2}`;
					const stub = makeStub(
						dedupeId(
							`stub_${sanitize(subdir)}_${sanitize(level2)}`,
							sourceKey,
							stubIdSources,
						),
						level2,
						path.join(scopeDir, subdir, level2),
						"in-scope",
						level2Nodes.length,
					);
					outputNodes.push(stub);
					for (const n of level2Nodes) collapsedMap.set(n.id, stub.id);
					anyLevel2Hidden = true;
					continue;
				}
				if (level2Visible.length === level2Nodes.length) {
					// Every member of this level-2 bucket happens to be touched —
					// indistinguishable from a normal fully-open bucket.
					for (const n of level2Nodes) outputNodes.push(n);
					continue;
				}
				// Partial: only touched members get a real node here too; the
				// edge-remap loop below drops any edge dangling on a hidden id.
				for (const n of level2Visible) outputNodes.push(n);
				groupTotals.set(`${subdir}/${level2}`, level2Nodes.length);
				anyLevel2Hidden = true;
			}
			// If any level-2 bucket under this level-1 dir ended up hidden
			// (fully stubbed or partial), the level-1 container itself is no
			// longer "fully open" — its own header needs the total member
			// count so layout.ts renders the partial (◐) icon.
			if (anyLevel2Hidden) {
				groupTotals.set(subdir, nodes.length);
			}
			continue;
		}
		const visible = nodes.filter((n) => touchedIds.has(n.id));
		if (visible.length === 0) {
			const sourceKey = `in:${subdir}`;
			const stub = makeStub(
				dedupeId(`stub_${sanitize(subdir)}`, sourceKey, stubIdSources),
				subdir,
				path.join(scopeDir, subdir),
				"in-scope",
				nodes.length,
			);
			outputNodes.push(stub);
			for (const n of nodes) collapsedMap.set(n.id, stub.id);
			continue;
		}
		if (visible.length === nodes.length) {
			// Every member happens to be touched — indistinguishable from a
			// normal fully-open dir, so no stub, no groupTotals entry (layout
			// infers "open" itself once visible count equals total).
			for (const n of nodes) outputNodes.push(n);
			continue;
		}
		// Partial: only touched members get a real node. Hidden members get
		// neither an output node nor a collapsedMap entry — the edge-remap
		// loop below drops any edge that would dangle on one of their ids.
		for (const n of visible) outputNodes.push(n);
		groupTotals.set(subdir, nodes.length);

		// Level2 sub-bucket totals, mirroring layout.ts's own level1/level2
		// split, so a nested subdir box (e.g. "data-access/store" inside
		// "data-access") reports its own correct total when it's the one
		// with hidden members.
		const level2Totals = new Map<string, number>();
		const level2Visible = new Map<string, number>();
		for (const n of nodes) {
			const parts = path.relative(scopeDir, n.file).split(path.sep);
			const level2 = parts.length > 2 ? parts[1] : "";
			if (level2 === "") continue;
			level2Totals.set(level2, (level2Totals.get(level2) ?? 0) + 1);
			if (touchedIds.has(n.id)) {
				level2Visible.set(level2, (level2Visible.get(level2) ?? 0) + 1);
			}
		}
		for (const [level2, total] of level2Totals) {
			if ((level2Visible.get(level2) ?? 0) < total) {
				groupTotals.set(`${subdir}/${level2}`, total);
			}
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
				nodes.length,
			);
			outputNodes.push(stub);
			for (const n of nodes) collapsedMap.set(n.id, stub.id);
		}
	}

	// ── Remap edges to stubs, dedup ──────────────────────────────────────────
	// Duplicates keep the highest-priority diff state so added/removed imports
	// into a collapsed dir are not masked by surviving unchanged imports.
	const outputNodeIds = new Set(outputNodes.map((n) => n.id));
	const edgeMap = new Map<string, GraphEdge>();

	for (const edge of graph.edges) {
		const from = collapsedMap.get(edge.from) ?? edge.from;
		const to = collapsedMap.get(edge.to) ?? edge.to;
		if (from === to) continue;
		// Drop edges touching a hidden partial-group member — it has no
		// collapsedMap entry (unlike a fully-collapsed stub's members), so
		// without this check the edge would dangle on a nonexistent node id.
		if (!outputNodeIds.has(from) || !outputNodeIds.has(to)) continue;
		const key = `${from}→${to}:${edge.kind}`;
		const existing = edgeMap.get(key);
		if (existing && diffPriority(existing.diff) >= diffPriority(edge.diff)) {
			continue;
		}
		edgeMap.set(key, { ...edge, from, to });
	}

	return { nodes: outputNodes, edges: [...edgeMap.values()], groupTotals };
}

// ─── 'collapsed' mode ───────────────────────────────────────────────────────
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
	const aggregate = aggregateDiff(members.map((n) => n.diff ?? "unchanged"));
	return {
		id,
		label: formatDirLabel("closed", label, members.length),
		file,
		type: "directory",
		scope,
		diff: aggregate,
	};
}

// A directory box's diff state must not overstate what's inside it: it's only
// "added"/"removed"/"unchanged" when every member unanimously agrees, and
// "modified" for any other mix (e.g. some added + some unchanged) — a single
// added file among twenty unchanged siblings should not paint the whole
// directory green. This is distinct from diffPriority()'s highest-wins
// reduction, which is still correct for its own use sites (edge dedup).
function aggregateDiff(diffs: DiffState[]): DiffState {
	if (diffs.every((d) => d === "added")) return "added";
	if (diffs.every((d) => d === "removed")) return "removed";
	if (diffs.every((d) => d === "unchanged")) return "unchanged";
	return "modified";
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
	total: number,
): GraphNode {
	return {
		id,
		label: formatDirLabel("closed", label, total),
		file,
		type: "stub",
		scope,
		diff: "unchanged",
	};
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
