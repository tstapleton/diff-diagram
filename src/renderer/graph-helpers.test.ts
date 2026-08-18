import { describe, expect, it } from "vitest";
import type { DiffState, Graph, GraphEdge, GraphNode } from "../types.js";
import { formatDirLabel } from "./dir-label.js";
import { computeViewNodes } from "./graph-helpers.js";

// ─── helpers ────────────────────────────────────────────────────────────────

const SCOPE = "src/app/features/users";

function makeGraph(nodes: GraphNode[], edges: GraphEdge[] = []): Graph {
	return {
		meta: {
			scopeDir: SCOPE,
			repoRoot: "/repo",
			generatedAt: "2024-01-01T00:00:00.000Z",
			nodeCount: nodes.length,
			edgeCount: edges.length,
		},
		nodes,
		edges,
	};
}

function node(
	id: string,
	file: string,
	scope: GraphNode["scope"],
	diff: GraphNode["diff"],
): GraphNode {
	return { id, label: id, file, type: "component", scope, diff };
}

function edge(from: string, to: string, diff?: DiffState): GraphEdge {
	return diff
		? { from, to, kind: "import", diff }
		: { from, to, kind: "import" };
}

function nodeAt(
	id: string,
	file: string,
	diff: GraphNode["diff"] = "unchanged",
	scope: GraphNode["scope"] = "in-scope",
): GraphNode {
	return { id, label: id, file, type: "component", scope, diff };
}

// ─── 'expanded' mode ─────────────────────────────────────────────────────────────

describe("computeViewNodes 'expanded' mode", () => {
	it("returns all nodes and edges unchanged", () => {
		const n1 = node(
			"a",
			`${SCOPE}/user-list/user-card.component.ts`,
			"in-scope",
			"unchanged",
		);
		const n2 = node(
			"b",
			`${SCOPE}/user-list/users-list.component.ts`,
			"in-scope",
			"modified",
		);
		const e1 = edge("a", "b");
		const g = makeGraph([n1, n2], [e1]);
		const { nodes, edges } = computeViewNodes(g, "expanded");
		expect(nodes).toEqual([n1, n2]);
		expect(edges).toEqual([e1]);
	});

	it("does not collapse unchanged subdirs in all mode", () => {
		const n1 = node(
			"a",
			`${SCOPE}/data-access/users.service.ts`,
			"in-scope",
			"unchanged",
		);
		const n2 = node(
			"b",
			`${SCOPE}/data-access/users-cache.service.ts`,
			"in-scope",
			"unchanged",
		);
		const g = makeGraph([n1, n2]);
		const { nodes } = computeViewNodes(g, "expanded");
		expect(nodes).toHaveLength(2);
		expect(nodes.find((n) => n.type === "stub")).toBeUndefined();
	});
});

// ─── collapse rules — in-scope ───────────────────────────────────────────────

describe("computeViewNodes 'focused' — in-scope collapse", () => {
	it("collapses an unchanged in-scope subdir to a stub", () => {
		const n1 = node(
			"a",
			`${SCOPE}/data-access/users.service.ts`,
			"in-scope",
			"unchanged",
		);
		const n2 = node(
			"b",
			`${SCOPE}/data-access/users-cache.service.ts`,
			"in-scope",
			"unchanged",
		);
		const g = makeGraph([n1, n2]);
		const { nodes } = computeViewNodes(g, "focused");
		expect(nodes).toHaveLength(1);
		expect(nodes[0].type).toBe("stub");
		expect(nodes[0].label).toBe(formatDirLabel("closed", "data-access", 2));
		expect(nodes[0].scope).toBe("in-scope");
		expect(nodes[0].diff).toBe("unchanged");
	});

	it("expands a subdir when any node is modified", () => {
		const n1 = node(
			"a",
			`${SCOPE}/user-list/user-card.component.ts`,
			"in-scope",
			"unchanged",
		);
		const n2 = node(
			"b",
			`${SCOPE}/user-list/users-list.component.ts`,
			"in-scope",
			"modified",
		);
		const g = makeGraph([n1, n2]);
		const { nodes } = computeViewNodes(g, "focused");
		expect(nodes).toHaveLength(2);
		expect(nodes.find((n) => n.type === "stub")).toBeUndefined();
	});

	it("expands a subdir when any node is added", () => {
		const n1 = node(
			"a",
			`${SCOPE}/user-settings/user-settings.component.ts`,
			"in-scope",
			"unchanged",
		);
		const n2 = node(
			"b",
			`${SCOPE}/user-settings/user-security.component.ts`,
			"in-scope",
			"added",
		);
		const g = makeGraph([n1, n2]);
		const { nodes } = computeViewNodes(g, "focused");
		expect(nodes).toHaveLength(2);
		expect(nodes.every((n) => n.type !== "stub")).toBe(true);
	});

	it("expands a subdir containing a removed-ghost", () => {
		const n1 = node(
			"a",
			`${SCOPE}/user-list/users-list.component.ts`,
			"in-scope",
			"unchanged",
		);
		const n2 = node(
			"b",
			`${SCOPE}/user-list/user-search-results.component.ts`,
			"removed-ghost",
			"removed",
		);
		const g = makeGraph([n1, n2]);
		const { nodes } = computeViewNodes(g, "focused");
		expect(nodes).toHaveLength(2);
		expect(nodes.find((n) => n.type === "stub")).toBeUndefined();
	});

	it("collapses multiple unchanged subdirs independently", () => {
		const n1 = node(
			"a",
			`${SCOPE}/data-access/users.service.ts`,
			"in-scope",
			"unchanged",
		);
		const n2 = node(
			"b",
			`${SCOPE}/models/user.model.ts`,
			"in-scope",
			"unchanged",
		);
		const g = makeGraph([n1, n2]);
		const { nodes } = computeViewNodes(g, "focused");
		expect(nodes).toHaveLength(2);
		expect(nodes.every((n) => n.type === "stub")).toBe(true);
		const labels = nodes.map((n) => n.label).sort();
		expect(labels).toEqual(
			[
				formatDirLabel("closed", "data-access", 1),
				formatDirLabel("closed", "models", 1),
			].sort(),
		);
	});

	it("shows root-level nodes individually even if unchanged", () => {
		const n1 = node(
			"root",
			`${SCOPE}/users-page.component.ts`,
			"in-scope",
			"unchanged",
		);
		const g = makeGraph([n1]);
		const { nodes } = computeViewNodes(g, "focused");
		expect(nodes).toHaveLength(1);
		expect(nodes[0].type).not.toBe("stub");
		expect(nodes[0].id).toBe("root");
	});
});

// ─── collapse rules — partial (new import into an otherwise-unchanged dir) ──

describe("computeViewNodes 'focused' — partial collapse", () => {
	it("pulls only the edge-touched file out of an otherwise-unchanged dir, and drops its unchanged internal edge to the still-hidden sibling", () => {
		// foo/a.ts is modified and adds a new import to bar/d.ts. bar/c.ts and
		// bar/d.ts are both content-unchanged; d also has a pre-existing
		// (unchanged) internal import of c.
		const a = node("a", `${SCOPE}/foo/a.ts`, "in-scope", "modified");
		const c = node("c", `${SCOPE}/bar/c.ts`, "in-scope", "unchanged");
		const d = node("d", `${SCOPE}/bar/d.ts`, "in-scope", "unchanged");
		const addedEdge = edge("a", "d", "added");
		const internalEdge = edge("d", "c", "unchanged");
		const g = makeGraph([a, c, d], [addedEdge, internalEdge]);
		const { nodes, edges, groupTotals } = computeViewNodes(g, "focused");

		// foo/ fully expands as today (a is modified); bar/ goes partial: only
		// d (edge-touched) is individually visible, c stays hidden.
		expect(nodes.find((n) => n.id === "a")).toBeDefined();
		expect(nodes.find((n) => n.id === "d")).toBeDefined();
		expect(nodes.find((n) => n.id === "c")).toBeUndefined();
		expect(nodes.find((n) => n.type === "stub")).toBeUndefined();
		expect(groupTotals?.get("bar")).toBe(2);

		// The new edge is visible; the internal d->c edge is dropped rather
		// than dangling on c's now-absent id.
		expect(edges).toHaveLength(1);
		expect(edges[0]).toMatchObject({ from: "a", to: "d", diff: "added" });
	});

	it("collapses to fully open (no stub, no groupTotals entry) when every member ends up edge-touched", () => {
		const c = node("c", `${SCOPE}/bar/c.ts`, "in-scope", "unchanged");
		const d = node("d", `${SCOPE}/bar/d.ts`, "in-scope", "unchanged");
		const x = node("x", `${SCOPE}/other/x.ts`, "in-scope", "modified");
		const g = makeGraph(
			[c, d, x],
			[edge("x", "c", "added"), edge("x", "d", "added")],
		);
		const { nodes, groupTotals } = computeViewNodes(g, "focused");

		expect(nodes.find((n) => n.id === "c")).toBeDefined();
		expect(nodes.find((n) => n.id === "d")).toBeDefined();
		expect(nodes.find((n) => n.type === "stub")).toBeUndefined();
		expect(groupTotals?.has("bar")).toBe(false);
	});

	it("treats an unchanged node as edge-touched via an OUTGOING removed edge (deleted import target), not just incoming edges", () => {
		// Regression test for the invariant found during planning: a
		// content-unchanged file's outgoing edges aren't guaranteed unchanged
		// — if the file it imports was deleted this PR, diff-parser emits an
		// outgoing "removed" edge from the (otherwise untouched) importer.
		// Only checking incoming edges would leave this file wrongly hidden,
		// silently dropping the removed edge instead of surfacing it.
		const c = node("c", `${SCOPE}/bar/c.ts`, "in-scope", "unchanged");
		const d = node("d", `${SCOPE}/bar/d.ts`, "in-scope", "unchanged");
		const ghost = node(
			"ghost",
			`${SCOPE}/deleted/target.ts`,
			"removed-ghost",
			"removed",
		);
		const removedEdge = edge("c", "ghost", "removed");
		const g = makeGraph([c, d, ghost], [removedEdge]);
		const { nodes, edges, groupTotals } = computeViewNodes(g, "focused");

		expect(nodes.find((n) => n.id === "c")).toBeDefined();
		expect(nodes.find((n) => n.id === "d")).toBeUndefined();
		expect(groupTotals?.get("bar")).toBe(2);
		expect(edges).toHaveLength(1);
		expect(edges[0]).toMatchObject({ from: "c", to: "ghost", diff: "removed" });
	});

	it("still fully collapses to a stub in single-branch mode (no diff info at all)", () => {
		const c = node("c", `${SCOPE}/bar/c.ts`, "in-scope", null);
		const d = node("d", `${SCOPE}/bar/d.ts`, "in-scope", null);
		const g = makeGraph([c, d], [{ from: "c", to: "d", kind: "import" }]);
		const { nodes } = computeViewNodes(g, "focused");

		expect(nodes).toHaveLength(1);
		expect(nodes[0].type).toBe("stub");
		expect(nodes[0].label).toBe(formatDirLabel("closed", "bar", 2));
	});
});

// ─── collapse rules — out-of-scope ──────────────────────────────────────────

describe("computeViewNodes 'focused' — out-of-scope collapse", () => {
	it("collapses an unchanged OOS parent dir to a stub", () => {
		const n1 = node(
			"oos_a",
			"src/app/shared/services/auth.service.ts",
			"out-of-scope",
			"unchanged",
		);
		const n2 = node(
			"oos_b",
			"src/app/shared/services/cache.service.ts",
			"out-of-scope",
			"unchanged",
		);
		const g = makeGraph([n1, n2]);
		const { nodes } = computeViewNodes(g, "focused");
		expect(nodes).toHaveLength(1);
		expect(nodes[0].type).toBe("stub");
		expect(nodes[0].scope).toBe("out-of-scope");
		expect(nodes[0].label).toBe(formatDirLabel("closed", "services", 2));
	});

	it("expands OOS group when any node is added", () => {
		const n1 = node(
			"oos_a",
			"src/app/shared/services/auth.service.ts",
			"out-of-scope",
			"unchanged",
		);
		const n2 = node(
			"oos_b",
			"src/app/shared/services/analytics.service.ts",
			"out-of-scope",
			"added",
		);
		const g = makeGraph([n1, n2]);
		const { nodes } = computeViewNodes(g, "focused");
		expect(nodes).toHaveLength(2);
		expect(nodes.find((n) => n.type === "stub")).toBeUndefined();
	});

	it("collapses different OOS parent dirs independently", () => {
		const n1 = node(
			"oos_a",
			"src/app/shared/services/auth.service.ts",
			"out-of-scope",
			"unchanged",
		);
		const n2 = node(
			"oos_b",
			"src/app/shared/components/pagination.component.ts",
			"out-of-scope",
			"unchanged",
		);
		const g = makeGraph([n1, n2]);
		const { nodes } = computeViewNodes(g, "focused");
		expect(nodes).toHaveLength(2);
		expect(nodes.every((n) => n.type === "stub")).toBe(true);
	});
});

// ─── edge preservation ────────────────────────────────────────────────────────

describe("computeViewNodes 'focused' — edge preservation", () => {
	it("redirects edges from collapsed nodes to stubs", () => {
		const inNode = node(
			"in",
			`${SCOPE}/user-list/users-list.component.ts`,
			"in-scope",
			"modified",
		);
		const oos1 = node(
			"oos_a",
			"src/app/shared/services/auth.service.ts",
			"out-of-scope",
			"unchanged",
		);
		const oos2 = node(
			"oos_b",
			"src/app/shared/services/cache.service.ts",
			"out-of-scope",
			"unchanged",
		);
		const e1 = edge("in", "oos_a");
		const e2 = edge("in", "oos_b");
		const g = makeGraph([inNode, oos1, oos2], [e1, e2]);
		const { nodes, edges } = computeViewNodes(g, "focused");

		const stub = nodes.find((n) => n.type === "stub");
		expect(stub).toBeDefined();
		expect(edges).toHaveLength(1); // both edges dedup to one stub edge
		expect(edges[0].from).toBe("in");
		expect(edges[0].to).toBe(stub?.id);
	});

	it("deduplicates edges that collapse to the same stub→stub", () => {
		const n1 = node(
			"a",
			`${SCOPE}/data-access/users.service.ts`,
			"in-scope",
			"unchanged",
		);
		const n2 = node(
			"b",
			`${SCOPE}/data-access/users-cache.service.ts`,
			"in-scope",
			"unchanged",
		);
		const n3 = node(
			"c",
			`${SCOPE}/models/user.model.ts`,
			"in-scope",
			"unchanged",
		);
		const e1 = edge("a", "c");
		const e2 = edge("b", "c");
		const g = makeGraph([n1, n2, n3], [e1, e2]);
		const { edges } = computeViewNodes(g, "focused");
		expect(edges).toHaveLength(1); // both edges become stub_data_access → stub_models
	});

	it("removes self-loop edges when both endpoints collapse to same stub", () => {
		const n1 = node(
			"a",
			`${SCOPE}/data-access/users.service.ts`,
			"in-scope",
			"unchanged",
		);
		const n2 = node(
			"b",
			`${SCOPE}/data-access/users-cache.service.ts`,
			"in-scope",
			"unchanged",
		);
		const e = edge("a", "b"); // both collapse to same stub
		const g = makeGraph([n1, n2], [e]);
		const { edges } = computeViewNodes(g, "focused");
		expect(edges).toHaveLength(0);
	});

	it("keeps 'added' diff when an added edge dedups with an unchanged edge to the same stub", () => {
		const inNode = node(
			"in",
			`${SCOPE}/user-list/users-list.component.ts`,
			"in-scope",
			"modified",
		);
		const oos1 = node(
			"oos_a",
			"src/app/shared/services/auth.service.ts",
			"out-of-scope",
			"unchanged",
		);
		const oos2 = node(
			"oos_b",
			"src/app/shared/services/cache.service.ts",
			"out-of-scope",
			"unchanged",
		);
		const unchangedEdge = edge("in", "oos_a", "unchanged");
		const addedEdge = edge("in", "oos_b", "added");

		// unchanged edge first in graph.edges
		const g1 = makeGraph([inNode, oos1, oos2], [unchangedEdge, addedEdge]);
		const r1 = computeViewNodes(g1, "focused");
		expect(r1.edges).toHaveLength(1);
		expect(r1.edges[0].diff).toBe("added");

		// added edge first in graph.edges
		const g2 = makeGraph([inNode, oos1, oos2], [addedEdge, unchangedEdge]);
		const r2 = computeViewNodes(g2, "focused");
		expect(r2.edges).toHaveLength(1);
		expect(r2.edges[0].diff).toBe("added");
	});

	it("keeps 'removed' diff when a removed edge dedups with an unchanged edge to the same stub", () => {
		const inNode = node(
			"in",
			`${SCOPE}/user-list/users-list.component.ts`,
			"in-scope",
			"modified",
		);
		const oos1 = node(
			"oos_a",
			"src/app/shared/services/auth.service.ts",
			"out-of-scope",
			"unchanged",
		);
		const oos2 = node(
			"oos_b",
			"src/app/shared/services/cache.service.ts",
			"out-of-scope",
			"unchanged",
		);
		const unchangedEdge = edge("in", "oos_a", "unchanged");
		const removedEdge = edge("in", "oos_b", "removed");

		// unchanged edge first (removed edges are appended last in diffGraphs)
		const g1 = makeGraph([inNode, oos1, oos2], [unchangedEdge, removedEdge]);
		const r1 = computeViewNodes(g1, "focused");
		expect(r1.edges).toHaveLength(1);
		expect(r1.edges[0].diff).toBe("removed");

		// removed edge first
		const g2 = makeGraph([inNode, oos1, oos2], [removedEdge, unchangedEdge]);
		const r2 = computeViewNodes(g2, "focused");
		expect(r2.edges).toHaveLength(1);
		expect(r2.edges[0].diff).toBe("removed");
	});

	it("assigns distinct stub ids to OOS parent dirs that sanitize to the same string (BUG-11)", () => {
		// "src/app/shared/api" and "src/app/shared-api" both sanitize to
		// "src_app_shared_api" under naive character replacement.
		const inNode = node(
			"in",
			`${SCOPE}/user-list/users-list.component.ts`,
			"in-scope",
			"modified",
		);
		const oos1 = node(
			"oos_a",
			"src/app/shared/api/foo.service.ts",
			"out-of-scope",
			"unchanged",
		);
		const oos2 = node(
			"oos_b",
			"src/app/shared-api/bar.service.ts",
			"out-of-scope",
			"unchanged",
		);
		const e1 = edge("in", "oos_a");
		const e2 = edge("in", "oos_b");
		const g = makeGraph([inNode, oos1, oos2], [e1, e2]);
		const { nodes, edges } = computeViewNodes(g, "focused");

		const stubs = nodes.filter((n) => n.type === "stub");
		expect(stubs).toHaveLength(2);
		expect(stubs[0].id).not.toBe(stubs[1].id);

		const stubIds = new Set(stubs.map((n) => n.id));
		expect(edges).toHaveLength(2);
		for (const e of edges) {
			expect(e.from).toBe("in");
			expect(stubIds.has(e.to)).toBe(true);
		}
		expect(new Set(edges.map((e) => e.to)).size).toBe(2);
	});

	it("preserves edge diff state when remapping", () => {
		const inNode = node(
			"in",
			`${SCOPE}/user-list/users-list.component.ts`,
			"in-scope",
			"modified",
		);
		const oos = node(
			"oos",
			"src/app/shared/services/analytics.service.ts",
			"out-of-scope",
			"added",
		);
		const e = edge("in", "oos", "added");
		const g = makeGraph([inNode, oos], [e]);
		const { nodes, edges } = computeViewNodes(g, "focused");
		// analytics is 'added', so its OOS group expands — no stub
		expect(nodes.find((n) => n.type === "stub")).toBeUndefined();
		expect(edges[0].diff).toBe("added");
	});
});

// ─── 'collapsed' mode ───────────────────────────────────────────────────────

describe("computeViewNodes 'collapsed' mode", () => {
	it("collapses a first-level subdirectory to one directory node", () => {
		const a = nodeAt("a", `${SCOPE}/data-access/a.ts`);
		const b = nodeAt("b", `${SCOPE}/data-access/b.ts`);
		const g = makeGraph([a, b], [edge("a", "b")]);
		const { nodes, edges } = computeViewNodes(g, "collapsed");
		const dirNodes = nodes.filter((n) => n.type === "directory");
		expect(dirNodes).toHaveLength(1);
		expect(dirNodes[0].label).toBe(formatDirLabel("closed", "data-access", 2));
		expect(edges).toHaveLength(0); // both endpoints collapse to the same node
	});

	it("nests a second-level subdirectory inside its first-level directory node, distinctly", () => {
		const direct = nodeAt("direct", `${SCOPE}/data-access/direct.ts`);
		const nested = nodeAt("nested", `${SCOPE}/data-access/store/nested.ts`);
		const g = makeGraph([direct, nested]);
		const { nodes } = computeViewNodes(g, "collapsed");
		const dirNodes = nodes.filter((n) => n.type === "directory");
		const labels = dirNodes.map((n) => n.label).sort();
		expect(labels).toEqual(
			[
				formatDirLabel("closed", "data-access", 2),
				formatDirLabel("closed", "store", 1),
			].sort(),
		);
	});

	it("drops an edge between a level1 directory and its own level2 child directory", () => {
		// A real file directly in data-access/ importing a file in
		// data-access/store/ collapses to exactly this edge shape — one
		// endpoint IS the directory that visually contains the other. ELK
		// can't route this as a meaningful, visible edge at this
		// compound-node depth (verified empirically in layout.ts — see
		// layout.test.ts's comment above where this test used to live), so
		// it's dropped here rather than emitted as an unusable edge, the
		// same way a same-directory self-loop is already dropped.
		const direct = nodeAt("direct", `${SCOPE}/data-access/direct.ts`);
		const nested = nodeAt("nested", `${SCOPE}/data-access/store/nested.ts`);
		const g = makeGraph([direct, nested], [edge("direct", "nested")]);
		const { edges } = computeViewNodes(g, "collapsed");
		expect(edges).toHaveLength(0);
	});

	it("collapses a file three or more directories deep into its second-level directory node", () => {
		const shallow = nodeAt("shallow", `${SCOPE}/data-access/store/shallow.ts`);
		const deep = nodeAt("deep", `${SCOPE}/data-access/store/extra/deep.ts`);
		const g = makeGraph([shallow, deep]);
		const { nodes } = computeViewNodes(g, "collapsed");
		const dirNodes = nodes.filter((n) => n.type === "directory");
		expect(dirNodes.map((n) => n.label).sort()).toEqual(
			[
				formatDirLabel("closed", "data-access", 2),
				formatDirLabel("closed", "store", 2),
			].sort(),
		);
	});

	it("leaves a root-level file as an individual node", () => {
		const root = nodeAt("root", `${SCOPE}/root.ts`);
		const g = makeGraph([root]);
		const { nodes } = computeViewNodes(g, "collapsed");
		expect(nodes).toHaveLength(1);
		expect(nodes[0]).toEqual(root);
	});

	it("colors a directory node by the dominant diff state among its members", () => {
		const unchanged1 = nodeAt("u1", `${SCOPE}/widgets/u1.ts`, "unchanged");
		const added = nodeAt("a1", `${SCOPE}/widgets/a1.ts`, "added");
		const modified = nodeAt("m1", `${SCOPE}/widgets/m1.ts`, "modified");
		const g = makeGraph([unchanged1, added, modified]);
		const { nodes } = computeViewNodes(g, "collapsed");
		const widgets = nodes.find((n) => n.label.includes("widgets"));
		expect(widgets?.diff).toBe("added"); // added (3) beats modified (1) beats unchanged (0)
	});

	it("a level1 directory's dominant color reflects its level2 child's members too, even with no direct files of its own", () => {
		const nested = nodeAt(
			"nested",
			`${SCOPE}/data-access/store/nested.ts`,
			"added",
		);
		const g = makeGraph([nested]);
		const { nodes } = computeViewNodes(g, "collapsed");
		const dataAccess = nodes.find((n) => n.label.includes("data-access"));
		expect(dataAccess?.diff).toBe("added");
	});

	it("collapses out-of-scope nodes by immediate parent directory, flat (no second level)", () => {
		const inScope = nodeAt("in", `${SCOPE}/widgets/in.ts`);
		const oos1 = nodeAt(
			"oos1",
			"src/app/shared/services/a.ts",
			"unchanged",
			"out-of-scope",
		);
		const oos2 = nodeAt(
			"oos2",
			"src/app/shared/services/b.ts",
			"unchanged",
			"out-of-scope",
		);
		const g = makeGraph([inScope, oos1, oos2], [edge("in", "oos1")]);
		const { nodes, edges } = computeViewNodes(g, "collapsed");
		const oosDirNodes = nodes.filter((n) => n.scope === "out-of-scope");
		expect(oosDirNodes).toHaveLength(1);
		expect(oosDirNodes[0].label).toBe(formatDirLabel("closed", "services", 2));
		expect(edges).toHaveLength(1);
		expect(edges[0].to).toBe(oosDirNodes[0].id);
	});

	it("aggregates and dedupes an edge between two directories, keeping the highest-priority diff state", () => {
		const a1 = nodeAt("a1", `${SCOPE}/widgets/a1.ts`);
		const a2 = nodeAt("a2", `${SCOPE}/widgets/a2.ts`);
		const b1 = nodeAt("b1", `${SCOPE}/settings/b1.ts`);
		const g = makeGraph(
			[a1, a2, b1],
			[edge("a1", "b1", "unchanged"), edge("a2", "b1", "added")],
		);
		const { edges } = computeViewNodes(g, "collapsed");
		expect(edges).toHaveLength(1);
		expect(edges[0].diff).toBe("added");
	});

	it("keeps directory node ids distinct when two first-level directories share a second-level directory name", () => {
		const a = nodeAt("a", `${SCOPE}/sub-one/utils/a.ts`);
		const b = nodeAt("b", `${SCOPE}/sub-two/utils/b.ts`);
		const g = makeGraph([a, b]);
		const { nodes } = computeViewNodes(g, "collapsed");
		const utilsNodes = nodes.filter((n) => n.label.includes("utils"));
		expect(utilsNodes).toHaveLength(2);
		expect(utilsNodes[0].id).not.toBe(utilsNodes[1].id);
	});
});
