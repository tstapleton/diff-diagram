import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "../types.js";
import type { LayoutContainer, LayoutNode } from "./layout.js";
import { computeClusteredLayout, computeLayout } from "./layout.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function node(id: string, type: GraphNode["type"] = "component"): GraphNode {
	return {
		id,
		label: id,
		file: `${id}.ts`,
		type,
		scope: "in-scope",
		diff: "unchanged",
	};
}

function edge(from: string, to: string): GraphEdge {
	return { from, to, kind: "import" };
}

// ─── ELK input construction ──────────────────────────────────────────────────

describe("computeLayout — ELK input construction", () => {
	it("assigns positions to all nodes", async () => {
		const nodes = [node("a"), node("b"), node("c")];
		const edges = [edge("a", "b"), edge("b", "c")];
		const layout = await computeLayout(nodes, edges);
		expect(layout.nodes).toHaveLength(3);
		for (const n of layout.nodes) {
			expect(typeof n.x).toBe("number");
			expect(typeof n.y).toBe("number");
			expect(n.width).toBeGreaterThan(0);
			expect(n.height).toBeGreaterThan(0);
		}
	});

	it("assigns smaller dimensions to stub nodes", async () => {
		const regular = node("a", "component");
		const stub = node("b", "stub");
		const layout = await computeLayout([regular, stub], []);
		// biome-ignore lint/style/noNonNullAssertion: nodes "a" and "b" were just passed into computeLayout
		const rn = layout.nodes.find((n) => n.id === "a")!;
		// biome-ignore lint/style/noNonNullAssertion: nodes "a" and "b" were just passed into computeLayout
		const sn = layout.nodes.find((n) => n.id === "b")!;
		expect(rn.width).toBeGreaterThan(sn.width);
		expect(rn.height).toBeGreaterThan(sn.height);
	});

	it("returns width and height for the overall graph", async () => {
		const layout = await computeLayout(
			[node("a"), node("b")],
			[edge("a", "b")],
		);
		expect(layout.width).toBeGreaterThan(0);
		expect(layout.height).toBeGreaterThan(0);
	});
});

// ─── ELK output shape ────────────────────────────────────────────────────────

describe("computeLayout — output shape", () => {
	it("returns an edge with from/to matching the input", async () => {
		const layout = await computeLayout(
			[node("a"), node("b")],
			[edge("a", "b")],
		);
		expect(layout.edges).toHaveLength(1);
		expect(layout.edges[0].from).toBe("a");
		expect(layout.edges[0].to).toBe("b");
	});

	it("edge sections have startPoint and endPoint", async () => {
		const layout = await computeLayout(
			[node("a"), node("b")],
			[edge("a", "b")],
		);
		const section = layout.edges[0].sections[0];
		expect(section.startPoint).toMatchObject({
			x: expect.any(Number),
			y: expect.any(Number),
		});
		expect(section.endPoint).toMatchObject({
			x: expect.any(Number),
			y: expect.any(Number),
		});
	});

	it("handles a graph with no edges", async () => {
		const layout = await computeLayout([node("a"), node("b")], []);
		expect(layout.nodes).toHaveLength(2);
		expect(layout.edges).toHaveLength(0);
	});

	it("handles a single node graph", async () => {
		const layout = await computeLayout([node("a")], []);
		expect(layout.nodes).toHaveLength(1);
		expect(layout.nodes[0].id).toBe("a");
	});

	it("deduplicates parallel edges before passing to ELK", async () => {
		const e1 = { ...edge("a", "b"), diff: "added" as const };
		const e2 = { ...edge("a", "b"), diff: "unchanged" as const };
		const layout = await computeLayout([node("a"), node("b")], [e1, e2]);
		expect(layout.edges).toHaveLength(1);
	});

	it("layered layout places nodes with increasing x for a linear chain", async () => {
		const nodes = [node("a"), node("b"), node("c")];
		const edges = [edge("a", "b"), edge("b", "c")];
		const layout = await computeLayout(nodes, edges);
		const byId = new Map(layout.nodes.map((n) => [n.id, n]));
		expect(byId.get("a")?.x).toBeLessThan(byId.get("b")?.x);
		expect(byId.get("b")?.x).toBeLessThan(byId.get("c")?.x);
	});
});

// ─── in-scope container box ──────────────────────────────────────────────────

describe("computeLayout — in-scope container box", () => {
	it("computes a container box when in-scope and out-of-scope nodes both exist", async () => {
		const inScope = node("a");
		const oos = { ...node("b"), scope: "out-of-scope" as const };
		const layout = await computeLayout([inScope, oos], []);
		expect(layout.container).toBeDefined();
	});

	it("computes a container box when there are no out-of-scope nodes", async () => {
		const layout = await computeLayout(
			[node("a"), node("b")],
			[edge("a", "b")],
		);
		expect(layout.container).toBeDefined();
	});

	it("leaves room above the container for its label when there are no out-of-scope nodes", async () => {
		const layout = await computeLayout(
			[node("a"), node("b")],
			[edge("a", "b")],
		);
		// biome-ignore lint/style/noNonNullAssertion: asserted above
		expect(layout.container!.y).toBeGreaterThanOrEqual(0);
	});

	it("omits the container box when there are no in-scope nodes", async () => {
		const oos = { ...node("a"), scope: "out-of-scope" as const };
		const layout = await computeLayout([oos], []);
		expect(layout.container).toBeUndefined();
	});
});

// ─── subdirectory grouping (issue #28) ────────────────────────────────────────

function nodeInDir(id: string, file: string): GraphNode {
	return {
		id,
		label: id,
		file,
		type: "component",
		scope: "in-scope",
		diff: "unchanged",
	};
}

function within(n: LayoutNode, c: LayoutContainer): boolean {
	return (
		n.x >= c.x &&
		n.y >= c.y &&
		n.x + n.width <= c.x + c.width &&
		n.y + n.height <= c.y + c.height
	);
}

describe("computeLayout — subdirectory grouping (issue #28)", () => {
	const scopeDir = "src/app/features/f";

	it("omitting scopeDir produces no subdirContainers (backward compatible)", async () => {
		const layout = await computeLayout(
			[node("a"), node("b")],
			[edge("a", "b")],
		);
		expect(layout.subdirContainers).toBeUndefined();
	});

	it("root-level nodes (no subdirectory) get no subdirContainers at all", async () => {
		const a = nodeInDir("a", `${scopeDir}/a.ts`);
		const layout = await computeLayout([a], [], "src/app", scopeDir);
		expect(layout.subdirContainers).toBeUndefined();
	});

	it("creates one container per first-level subdirectory", async () => {
		const a = nodeInDir("a", `${scopeDir}/sub-one/a.ts`);
		const b = nodeInDir("b", `${scopeDir}/sub-two/b.ts`);
		const layout = await computeLayout([a, b], [], "src/app", scopeDir);
		const labels = layout.subdirContainers?.map((c) => c.label).sort();
		expect(labels).toEqual(["sub-one", "sub-two"]);
	});

	it("a subdirectory's container box fully contains all of that subdirectory's nodes", async () => {
		const a = nodeInDir("a", `${scopeDir}/sub/a.ts`);
		const b = nodeInDir("b", `${scopeDir}/sub/b.ts`);
		const layout = await computeLayout(
			[a, b],
			[edge("a", "b")],
			"src/app",
			scopeDir,
		);
		const box = layout.subdirContainers?.find((c) => c.label === "sub");
		expect(box).toBeDefined();
		const la = layout.nodes.find((n) => n.id === "a");
		const lb = layout.nodes.find((n) => n.id === "b");
		// biome-ignore lint/style/noNonNullAssertion: presence asserted above
		expect(within(la!, box!)).toBe(true);
		// biome-ignore lint/style/noNonNullAssertion: presence asserted above
		expect(within(lb!, box!)).toBe(true);
	});

	it("keeps an orphan node (zero edges) inside its own subdirectory's box", async () => {
		// Regression test: the rejected Option C (ELK partitioning per subdir)
		// broke exactly on this case — an unconnected node in a subdir landed
		// in a completely different column than its own sibling, producing a
		// box that swallowed unrelated nodes. Compound nodes must not repeat this.
		const orphan = nodeInDir("orphan", `${scopeDir}/sub/orphan.ts`);
		const sibling = nodeInDir("sibling", `${scopeDir}/sub/sibling.ts`);
		const other = nodeInDir("other", `${scopeDir}/other/other.ts`);
		const layout = await computeLayout(
			[orphan, sibling, other],
			[edge("sibling", "other")],
			"src/app",
			scopeDir,
		);
		const box = layout.subdirContainers?.find((c) => c.label === "sub");
		const lorphan = layout.nodes.find((n) => n.id === "orphan");
		// biome-ignore lint/style/noNonNullAssertion: presence asserted by the prior test
		expect(within(lorphan!, box!)).toBe(true);
	});

	it("groups a file nested two levels deep under a nested second-level box, distinct from its first-level sibling", async () => {
		const shallow = nodeInDir("shallow", `${scopeDir}/sub/shallow.ts`);
		const deep = nodeInDir("deep", `${scopeDir}/sub/nested/deep.ts`);
		const layout = await computeLayout(
			[shallow, deep],
			[],
			"src/app",
			scopeDir,
		);
		expect(layout.subdirContainers).toHaveLength(2);
		const outer = layout.subdirContainers?.find((c) => c.label === "sub");
		const inner = layout.subdirContainers?.find((c) => c.label === "nested");
		expect(outer).toBeDefined();
		expect(inner).toBeDefined();
		const lshallow = layout.nodes.find((n) => n.id === "shallow");
		const ldeep = layout.nodes.find((n) => n.id === "deep");
		// biome-ignore lint/style/noNonNullAssertion: presence asserted above
		expect(within(lshallow!, outer!)).toBe(true);
		// biome-ignore lint/style/noNonNullAssertion: presence asserted above
		expect(within(ldeep!, inner!)).toBe(true);
		// biome-ignore lint/style/noNonNullAssertion: presence asserted above
		expect(within(inner!, outer!)).toBe(true);
	});

	it("routes an edge from a root-level node into a subdirectory node", async () => {
		// Regression test: without elk.hierarchyHandling: INCLUDE_CHILDREN, ELK
		// silently returns 0 sections for any edge crossing a subdir boundary —
		// nothing gets drawn, with no error. This must never regress silently.
		const root = nodeInDir("root", `${scopeDir}/root.ts`);
		const child = nodeInDir("child", `${scopeDir}/sub/child.ts`);
		const layout = await computeLayout(
			[root, child],
			[edge("root", "child")],
			"src/app",
			scopeDir,
		);
		expect(layout.edges).toHaveLength(1);
		expect(layout.edges[0].sections.length).toBeGreaterThan(0);
	});

	it("routes an edge from a subdirectory node to an out-of-scope node, which stays outside the subdirectory's box", async () => {
		const inSub = nodeInDir("inSub", `${scopeDir}/sub/inSub.ts`);
		const oos: GraphNode = {
			...nodeInDir("oos", "src/app/shared/oos.ts"),
			scope: "out-of-scope",
		};
		const layout = await computeLayout(
			[inSub, oos],
			[edge("inSub", "oos")],
			"src/app",
			scopeDir,
		);
		expect(layout.edges[0].sections.length).toBeGreaterThan(0);
		const box = layout.subdirContainers?.[0];
		const loos = layout.nodes.find((n) => n.id === "oos");
		// biome-ignore lint/style/noNonNullAssertion: presence asserted above
		expect(within(loos!, box!)).toBe(false);
	});

	it("routes an edge between two files in the same second-level subdirectory", async () => {
		const a = nodeInDir("a", `${scopeDir}/sub/nested/a.ts`);
		const b = nodeInDir("b", `${scopeDir}/sub/nested/b.ts`);
		const layout = await computeLayout(
			[a, b],
			[edge("a", "b")],
			"src/app",
			scopeDir,
		);
		expect(layout.edges).toHaveLength(1);
		expect(layout.edges[0].sections.length).toBeGreaterThan(0);
		const inner = layout.subdirContainers?.find((c) => c.label === "nested");
		const la = layout.nodes.find((n) => n.id === "a");
		const lb = layout.nodes.find((n) => n.id === "b");
		// biome-ignore lint/style/noNonNullAssertion: presence asserted by the rewritten test above
		expect(within(la!, inner!)).toBe(true);
		// biome-ignore lint/style/noNonNullAssertion: presence asserted by the rewritten test above
		expect(within(lb!, inner!)).toBe(true);
	});

	it("routes an edge between a second-level file and its first-level sibling without the nested box swallowing the sibling", async () => {
		const direct = nodeInDir("direct", `${scopeDir}/sub/direct.ts`);
		const child = nodeInDir("child", `${scopeDir}/sub/inner/child.ts`);
		const layout = await computeLayout(
			[direct, child],
			[edge("direct", "child")],
			"src/app",
			scopeDir,
		);
		expect(layout.edges[0].sections.length).toBeGreaterThan(0);
		const outer = layout.subdirContainers?.find((c) => c.label === "sub");
		const inner = layout.subdirContainers?.find((c) => c.label === "inner");
		const ldirect = layout.nodes.find((n) => n.id === "direct");
		// biome-ignore lint/style/noNonNullAssertion: presence asserted by the rewritten test above
		expect(within(ldirect!, outer!)).toBe(true);
		// biome-ignore lint/style/noNonNullAssertion: presence asserted by the rewritten test above
		expect(within(ldirect!, inner!)).toBe(false);
	});

	it("routes an edge across different first-level subdirectories when one endpoint is nested two levels deep", async () => {
		const a = nodeInDir("a", `${scopeDir}/sub-one/inner/a.ts`);
		const b = nodeInDir("b", `${scopeDir}/sub-two/b.ts`);
		const layout = await computeLayout(
			[a, b],
			[edge("a", "b")],
			"src/app",
			scopeDir,
		);
		expect(layout.edges[0].sections.length).toBeGreaterThan(0);
	});

	it("collapses a file three or more directories deep into its second-level subdirectory box", async () => {
		const shallow = nodeInDir("shallow", `${scopeDir}/sub/inner/shallow.ts`);
		const deep = nodeInDir("deep", `${scopeDir}/sub/inner/extra/deep.ts`);
		const layout = await computeLayout(
			[shallow, deep],
			[],
			"src/app",
			scopeDir,
		);
		const labels = layout.subdirContainers?.map((c) => c.label).sort();
		expect(labels).toEqual(["inner", "sub"]);
		const inner = layout.subdirContainers?.find((c) => c.label === "inner");
		const ldeep = layout.nodes.find((n) => n.id === "deep");
		// biome-ignore lint/style/noNonNullAssertion: presence asserted above
		expect(within(ldeep!, inner!)).toBe(true);
	});

	it("keeps second-level boxes distinct when two first-level subdirectories share a child directory name", async () => {
		const a = nodeInDir("a", `${scopeDir}/sub-one/utils/a.ts`);
		const b = nodeInDir("b", `${scopeDir}/sub-two/utils/b.ts`);
		const layout = await computeLayout([a, b], [], "src/app", scopeDir);
		const utilsBoxes = layout.subdirContainers?.filter(
			(c) => c.label === "utils",
		);
		expect(utilsBoxes).toHaveLength(2);
		const la = layout.nodes.find((n) => n.id === "a");
		const lb = layout.nodes.find((n) => n.id === "b");
		const [box1, box2] = utilsBoxes ?? [];
		// biome-ignore lint/style/noNonNullAssertion: presence asserted above
		const aInBox1 = within(la!, box1);
		// biome-ignore lint/style/noNonNullAssertion: presence asserted above
		const aInBox2 = within(la!, box2);
		expect(aInBox1 !== aInBox2).toBe(true);
		// biome-ignore lint/style/noNonNullAssertion: presence asserted above
		const bInSameBoxAsA = aInBox1 ? within(lb!, box1) : within(lb!, box2);
		expect(bInSameBoxAsA).toBe(false);
	});

	it("container box fully contains all subdir boxes when subdir grouping is active", async () => {
		// Build a fixture with nested subdir structure to trigger both level-1 and level-2 boxes
		const a = nodeInDir("a", `${scopeDir}/sub/a.ts`);
		const b = nodeInDir("b", `${scopeDir}/sub/nested/b.ts`);
		const layout = await computeLayout([a, b], [], "src/app", scopeDir);
		expect(layout.container).toBeDefined();
		expect(layout.subdirContainers).toBeDefined();
		if (layout.container && layout.subdirContainers) {
			for (const box of layout.subdirContainers) {
				// biome-ignore lint/style/noNonNullAssertion: presence asserted by the if guard
				expect(box.x).toBeGreaterThanOrEqual(layout.container!.x);
				// biome-ignore lint/style/noNonNullAssertion: presence asserted by the if guard
				expect(box.y).toBeGreaterThanOrEqual(layout.container!.y);
				expect(box.x + box.width).toBeLessThanOrEqual(
					// biome-ignore lint/style/noNonNullAssertion: presence asserted by the if guard
					layout.container!.x + layout.container!.width,
				);
				expect(box.y + box.height).toBeLessThanOrEqual(
					// biome-ignore lint/style/noNonNullAssertion: presence asserted by the if guard
					layout.container!.y + layout.container!.height,
				);
			}
		}
	});
});

// ─── computeClusteredLayout ───────────────────────────────────────────────────

describe("computeClusteredLayout", () => {
	const scopeDir = "src/app/features/f";

	function dirNode(
		id: string,
		label: string,
		dirPath: string,
		diff: GraphNode["diff"] = "unchanged",
		scope: GraphNode["scope"] = "in-scope",
	): GraphNode {
		return { id, label, file: dirPath, type: "directory", scope, diff };
	}

	it("lays out a flat level1 directory node as a plain box", async () => {
		const widgets = dirNode("widgets", "widgets", `${scopeDir}/widgets`);
		const layout = await computeClusteredLayout(
			[widgets],
			[],
			"src/app",
			scopeDir,
		);
		expect(layout.nodes).toHaveLength(1);
		expect(layout.nodes[0].id).toBe("widgets");
	});

	it("nests a level2 directory node inside its level1 parent's box", async () => {
		const dataAccess = dirNode(
			"data-access",
			"data-access",
			`${scopeDir}/data-access`,
		);
		const store = dirNode("store", "store", `${scopeDir}/data-access/store`);
		const layout = await computeClusteredLayout(
			[dataAccess, store],
			[],
			"src/app",
			scopeDir,
		);
		expect(layout.nodes).toHaveLength(2);
		const outer = layout.nodes.find((n) => n.id === "data-access");
		const inner = layout.nodes.find((n) => n.id === "store");
		expect(outer).toBeDefined();
		expect(inner).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: presence asserted above
		expect(within(inner!, outer!)).toBe(true);
	});

	it("nests multiple level2 directory nodes inside the same level1 parent", async () => {
		const dataAccess = dirNode(
			"data-access",
			"data-access",
			`${scopeDir}/data-access`,
		);
		const store = dirNode("store", "store", `${scopeDir}/data-access/store`);
		const effects = dirNode(
			"effects",
			"effects",
			`${scopeDir}/data-access/effects`,
		);
		const layout = await computeClusteredLayout(
			[dataAccess, store, effects],
			[],
			"src/app",
			scopeDir,
		);
		const outer = layout.nodes.find((n) => n.id === "data-access");
		const storeNode = layout.nodes.find((n) => n.id === "store");
		const effectsNode = layout.nodes.find((n) => n.id === "effects");
		expect(outer).toBeDefined();
		expect(storeNode).toBeDefined();
		expect(effectsNode).toBeDefined();
		// biome-ignore lint/style/noNonNullAssertion: presence asserted above
		expect(within(storeNode!, outer!)).toBe(true);
		// biome-ignore lint/style/noNonNullAssertion: presence asserted above
		expect(within(effectsNode!, outer!)).toBe(true);
	});

	it("routes an edge between two level2 sibling nodes nested under the same level1 parent, inside the parent's box", async () => {
		const dataAccess = dirNode(
			"data-access",
			"data-access",
			`${scopeDir}/data-access`,
		);
		const store = dirNode("store", "store", `${scopeDir}/data-access/store`);
		const effects = dirNode(
			"effects",
			"effects",
			`${scopeDir}/data-access/effects`,
		);
		const layout = await computeClusteredLayout(
			[dataAccess, store, effects],
			[{ from: "store", to: "effects", kind: "import" }],
			"src/app",
			scopeDir,
		);
		const outer = layout.nodes.find((n) => n.id === "data-access");
		expect(outer).toBeDefined();
		expect(layout.edges).toHaveLength(1);
		for (const section of layout.edges[0].sections) {
			expect(
				// biome-ignore lint/style/noNonNullAssertion: presence asserted above
				within({ ...section.startPoint, width: 0, height: 0 }, outer!),
			).toBe(true);
			expect(
				// biome-ignore lint/style/noNonNullAssertion: presence asserted above
				within({ ...section.endPoint, width: 0, height: 0 }, outer!),
			).toBe(true);
		}
	});

	it("draws the level1 parent before its level2 child, so the child renders on top", async () => {
		const dataAccess = dirNode(
			"data-access",
			"data-access",
			`${scopeDir}/data-access`,
		);
		const store = dirNode("store", "store", `${scopeDir}/data-access/store`);
		const layout = await computeClusteredLayout(
			[dataAccess, store],
			[],
			"src/app",
			scopeDir,
		);
		const outerIndex = layout.nodes.findIndex((n) => n.id === "data-access");
		const innerIndex = layout.nodes.findIndex((n) => n.id === "store");
		expect(outerIndex).toBeLessThan(innerIndex);
	});

	it("routes an edge between two unrelated level1 directory nodes", async () => {
		const widgets = dirNode("widgets", "widgets", `${scopeDir}/widgets`);
		const settings = dirNode("settings", "settings", `${scopeDir}/settings`);
		const layout = await computeClusteredLayout(
			[widgets, settings],
			[{ from: "widgets", to: "settings", kind: "import" }],
			"src/app",
			scopeDir,
		);
		expect(layout.edges).toHaveLength(1);
		expect(layout.edges[0].sections.length).toBeGreaterThan(0);
	});

	// An edge between a level1 directory node and its own level2 child (e.g.
	// a real file directly in data-access/ importing a file in
	// data-access/store/) is NOT handled specially by computeClusteredLayout
	// — verified empirically that ELK can't route it as a meaningful,
	// visible edge at this compound-node depth regardless of which node's
	// `edges` array it's declared on (both the LCA-declared and
	// root-declared placements produced a degenerate ~8px section fully
	// contained within the parent's own box, invisible once the parent's
	// opaque rect is drawn on top). computeClusteredNodes
	// (src/renderer/graph-helpers.ts) drops this edge shape before it ever
	// reaches this function — see graph-helpers.test.ts's "drops an edge
	// between a level1 directory and its own level2 child directory".

	it("keeps a real root-level file as a plain sized leaf alongside directory nodes", async () => {
		const rootFile: GraphNode = {
			id: "root",
			label: "root",
			file: `${scopeDir}/root.ts`,
			type: "component",
			scope: "in-scope",
			diff: "unchanged",
		};
		const widgets = dirNode("widgets", "widgets", `${scopeDir}/widgets`);
		const layout = await computeClusteredLayout(
			[rootFile, widgets],
			[],
			"src/app",
			scopeDir,
		);
		expect(layout.nodes).toHaveLength(2);
		expect(layout.nodes.some((n) => n.id === "root")).toBe(true);
	});

	it("keeps an out-of-scope directory node outside the in-scope container box", async () => {
		const widgets = dirNode("widgets", "widgets", `${scopeDir}/widgets`);
		const oos = dirNode(
			"oos",
			"services",
			"src/app/shared/services",
			"unchanged",
			"out-of-scope",
		);
		const layout = await computeClusteredLayout(
			[widgets, oos],
			[{ from: "widgets", to: "oos", kind: "import" }],
			"src/app",
			scopeDir,
		);
		expect(layout.container).toBeDefined();
		const loos = layout.nodes.find((n) => n.id === "oos");
		// biome-ignore lint/style/noNonNullAssertion: presence asserted above
		expect(within(loos!, layout.container!)).toBe(false);
	});
});
