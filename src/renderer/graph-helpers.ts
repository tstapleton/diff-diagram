import path from "node:path";
import { dedupeId } from "../analyzer.js";
import type { DiffState, Graph, GraphEdge, GraphNode } from "../types.js";
import { formatDirLabel } from "./dir-label.js";

// ─── computeViewNodes ─────────────────────────────────────────────────────────
// Returns nodes and edges for a given view mode.
//
// 'expanded' → all nodes and edges, no collapsing
// 'focused'  → a node is shown on its own if it changed itself
//   (added/modified/removed) or is touched (as either endpoint) by an
//   added/removed/modified edge; otherwise it's folded into its subdirectory's
//   collapse. Applied per in-scope subdirectory and per out-of-scope parent
//   directory:
//   • No member visible → one closed stub for the whole subdir
//   • Every member visible → shown individually, indistinguishable from
//     'expanded' for that subdir
//   • Some visible, some not → "partial": only the visible members are shown;
//     the rest are dropped entirely (no stand-in node), which is lossless
//     because a hidden member has, by construction, zero diff-relevant
//     changes of its own or edges touching it
//   • Stubs inherit edges (edges to collapsed nodes redirect to stub)
//
// Out-of-scope grouping uses the same isVisible check as in-scope grouping
// (any member changed itself or is touched by a changed edge keeps the whole
// group visible), but doesn't yet support the partial case — an out-of-scope
// group is all-or-nothing; only in-scope subdirectories get the full
// open/partial/closed split.

export function computeViewNodes(
	graph: Graph,
	mode: "expanded" | "focused" | "collapsed",
	sourceRoot = "src/app",
): {
	nodes: GraphNode[];
	edges: GraphEdge[];
	groupTotals?: Map<string, number>;
} {
	if (mode === "expanded") {
		return { nodes: graph.nodes, edges: graph.edges };
	}
	if (mode === "collapsed") {
		return computeClusteredNodes(graph, sourceRoot);
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

	// A node earns its own place in the diagram if it changed itself, or if a
	// changed edge touches it — either reason is sufficient on its own.
	const isVisible = (n: GraphNode): boolean =>
		diffPriority(n.diff) > 0 || touchedIds.has(n.id);

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
		const visible = nodes.filter(isVisible);
		if (visible.length === 0) {
			// Nothing in this subdirectory changed, at either the file or edge
			// level — collapse the whole thing to one closed stub.
			const sourceKey = `in:${subdir}`;
			const stub = makeStub(
				dedupeId(`stub_${sanitize(subdir)}`, sourceKey, stubIdSources),
				subdir,
				path.join(scopeDir, subdir),
				"in-scope",
				nodes.length,
				1,
			);
			outputNodes.push(stub);
			for (const n of nodes) collapsedMap.set(n.id, stub.id);
			continue;
		}
		if (visible.length === nodes.length) {
			// Every member is visible — indistinguishable from a normal
			// fully-open dir, so no stub, no groupTotals entry (layout infers
			// "open" itself once visible count equals total).
			for (const n of nodes) outputNodes.push(n);
			continue;
		}
		// Partial: some of this subdirectory is visible, some isn't. Re-run
		// the same decision one level down, per level-2 bucket, instead of
		// dumping the whole group flat — the layout only ever boxes 2 levels
		// deep (layout.ts's subdirOf), so a hidden member 3+ directories deep
		// shouldn't force every unrelated level-2 subdirectory under this
		// level-1 dir to expand too.
		const level2Groups = new Map<string, GraphNode[]>();
		for (const n of nodes) {
			const parts = path.relative(scopeDir, n.file).split(path.sep);
			const level2 = parts.length > 2 ? parts[1] : "";
			appendToGroup(level2Groups, level2, n);
		}
		for (const [level2, level2Nodes] of level2Groups) {
			if (level2 === "") {
				// Files directly in the level-1 dir: no level2 box to collapse
				// into, so each is independently visible or dropped. Hidden
				// ones get neither an output node nor a collapsedMap entry —
				// the edge-remap loop below drops any edge that would dangle
				// on one of their ids.
				for (const n of level2Nodes) if (isVisible(n)) outputNodes.push(n);
				continue;
			}
			const level2Visible = level2Nodes.filter(isVisible);
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
					2,
				);
				outputNodes.push(stub);
				for (const n of level2Nodes) collapsedMap.set(n.id, stub.id);
				continue;
			}
			if (level2Visible.length === level2Nodes.length) {
				// Every member of this level-2 bucket happens to be visible —
				// indistinguishable from a normal fully-open bucket.
				for (const n of level2Nodes) outputNodes.push(n);
				continue;
			}
			// Partial at the level-2 bucket too: only visible members get a
			// real node here.
			for (const n of level2Visible) outputNodes.push(n);
			groupTotals.set(`${subdir}/${level2}`, level2Nodes.length);
		}
		// We already know this subdirectory is partial overall (0 < visible
		// < total), regardless of which level-2 bucket the hidden members
		// landed in, so the level-1 container's own header always needs the
		// true total count for layout.ts to render the partial (◐) icon.
		groupTotals.set(subdir, nodes.length);
	}

	// ── Group out-of-scope nodes by capped-depth directory ────────────────────
	const oosGroups = new Map<string, GraphNode[]>();
	for (const node of oosNodes) {
		const key = oosGroupDir(node.file, sourceRoot);
		appendToGroup(oosGroups, key, node);
	}

	for (const [dir, nodes] of oosGroups) {
		// Same isVisible check the in-scope loop above uses: a group shows
		// individually if any member changed itself OR is touched by a
		// changed edge — not just "changed itself" (issue #89). An
		// out-of-scope node's own diff is null in single-branch mode, but a
		// real added/modified/unchanged value once diffed against a base
		// (see diffGraphs) — either way, a content-unchanged member that
		// just gained a new edge (e.g. an existing shared file with a
		// brand-new caller) still deserves to stay visible, the same reason
		// this matters for in-scope members.
		if (nodes.some(isVisible)) {
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

function computeClusteredNodes(
	graph: Graph,
	sourceRoot: string,
): {
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

	// ── Out-of-scope: one flat node per capped-depth directory ────────────────
	const oosGroups = new Map<string, GraphNode[]>();
	for (const n of oosNodes) {
		const dir = oosGroupDir(n.file, sourceRoot);
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
	const magnitude = maxMagnitude(members);
	return {
		id,
		label: formatDirLabel("closed", label, members.length),
		file,
		type: "directory",
		scope,
		diff: aggregate,
		...(magnitude !== undefined ? { magnitude } : {}),
	};
}

// The heaviest single change among a directory's members stands in for the
// whole collapsed box — consistent with aggregateDiff() above already using
// an extremum (unanimity) rather than an average to decide the diff state.
function maxMagnitude(members: GraphNode[]): number | undefined {
	const magnitudes = members
		.map((n) => n.magnitude)
		.filter((m): m is number => m !== undefined);
	return magnitudes.length > 0 ? Math.max(...magnitudes) : undefined;
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

// An out-of-scope file's own immediate parent directory, with a cap on how
// far below sourceRoot it can be: a file arbitrarily deep under some shared
// directory (e.g. shared/services/api-client/services/http.service.ts)
// groups with its siblings at the same depth-capped ancestor
// (shared/services/api-client) instead of fragmenting into one box per
// exact directory — which, beyond just being more boxes than necessary,
// can also produce same-named boxes for two unrelated directories that
// happen to share a basename (e.g. two different "services"
// subdirectories at different depths). Falls back to the file's own
// immediate parent directory, uncapped, when that directory has fewer
// segments than the cap (nothing to truncate) or sits outside sourceRoot
// entirely (no meaningful depth to measure from — e.g. a monorepo import
// from a sibling package).
//
// Hardcoded for now — see issue #92 to make this configurable if one
// repo's directory shape doesn't generalize well.
const OOS_GROUP_DEPTH = 3;

function oosGroupDir(file: string, sourceRoot: string): string {
	const dir = path.dirname(file);
	const rel = path.relative(sourceRoot, dir);
	if (rel.startsWith("..")) return dir;
	const parts = rel.split(path.sep);
	if (parts.length <= OOS_GROUP_DEPTH) return dir;
	return path.join(sourceRoot, ...parts.slice(0, OOS_GROUP_DEPTH));
}

function makeStub(
	id: string,
	label: string,
	file: string,
	scope: "in-scope" | "out-of-scope",
	total: number,
	depth?: number,
): GraphNode {
	return {
		id,
		label: formatDirLabel("closed", label, total),
		file,
		type: "stub",
		scope,
		diff: "unchanged",
		...(depth !== undefined ? { depth } : {}),
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
