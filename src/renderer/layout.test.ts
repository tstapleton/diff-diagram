import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "../types.js";
import type { LayoutContainer, LayoutNode } from "./layout.js";
import { computeLayout } from "./layout.js";

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

	it("groups a file nested two levels deep under its first-level subdirectory", async () => {
		const shallow = nodeInDir("shallow", `${scopeDir}/sub/shallow.ts`);
		const deep = nodeInDir("deep", `${scopeDir}/sub/nested/deep.ts`);
		const layout = await computeLayout(
			[shallow, deep],
			[],
			"src/app",
			scopeDir,
		);
		expect(layout.subdirContainers).toHaveLength(1);
		expect(layout.subdirContainers?.[0].label).toBe("sub");
		const box = layout.subdirContainers?.[0];
		const ldeep = layout.nodes.find((n) => n.id === "deep");
		// biome-ignore lint/style/noNonNullAssertion: presence asserted above
		expect(within(ldeep!, box!)).toBe(true);
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
});
