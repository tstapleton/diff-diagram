import { describe, expect, it } from "vitest";
import { applyChangeMagnitude, diffGraphs } from "./diff-parser.js";
import type { GraphEdge, GraphNode } from "./types.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeFullGraph(
	scopeDir: string,
	nodes: Partial<GraphNode>[] = [],
	edges: Partial<GraphEdge>[] = [],
) {
	return {
		meta: {
			repoRoot: "/repo",
			scopeDir,
			nodeCount: nodes.length,
			edgeCount: edges.length,
			generatedAt: "",
		},
		nodes,
		edges,
	};
}

function gNode(file: string, overrides: Record<string, unknown> = {}) {
	const id = file
		.replace(/\.ts$/, "")
		.replace(/[^a-zA-Z0-9]/g, "_")
		.replace(/_+/g, "_");
	return {
		id,
		label: id,
		file,
		type: "component",
		scope: "in-scope",
		diff: null,
		...overrides,
	};
}

function gEdge(fromFile: string, toFile: string, importedNames?: string[]) {
	const fromId = fromFile
		.replace(/\.ts$/, "")
		.replace(/[^a-zA-Z0-9]/g, "_")
		.replace(/_+/g, "_");
	const toId = toFile
		.replace(/\.ts$/, "")
		.replace(/[^a-zA-Z0-9]/g, "_")
		.replace(/_+/g, "_");
	return {
		from: fromId,
		to: toId,
		kind: "import" as const,
		...(importedNames ? { importedNames } : {}),
	};
}

// ─── diffGraphs ──────────────────────────────────────────────────────────────

describe("diffGraphs", () => {
	describe("node diff states", () => {
		it("marks a node in current but not base as added", () => {
			const base = makeFullGraph("src/users", []);
			const current = makeFullGraph("src/users", [
				gNode("src/users/foo.component.ts"),
			]);
			const result = diffGraphs(base, current);
			expect(result.nodes[0].diff).toBe("added");
		});

		it("marks a node in base but not current as removed-ghost", () => {
			const base = makeFullGraph("src/users", [
				gNode("src/users/foo.component.ts"),
			]);
			const current = makeFullGraph("src/users", []);
			const result = diffGraphs(base, current);
			expect(result.nodes).toHaveLength(1);
			expect(result.nodes[0].scope).toBe("removed-ghost");
			expect(result.nodes[0].diff).toBe("removed");
		});

		it("marks a node in both with unchanged edges as unchanged", () => {
			const n = gNode("src/users/foo.component.ts");
			const base = makeFullGraph("src/users", [n]);
			const current = makeFullGraph("src/users", [n]);
			const result = diffGraphs(base, current);
			expect(result.nodes[0].diff).toBe("unchanged");
		});

		it("marks a node as modified when an outgoing edge is added", () => {
			const foo = gNode("src/users/foo.component.ts");
			const bar = gNode("src/users/bar.component.ts");
			const base = makeFullGraph("src/users", [foo, bar], []);
			const current = makeFullGraph(
				"src/users",
				[foo, bar],
				[gEdge("src/users/foo.component.ts", "src/users/bar.component.ts")],
			);
			const result = diffGraphs(base, current);
			expect(
				result.nodes.find((n) => n.file === "src/users/foo.component.ts")?.diff,
			).toBe("modified");
		});

		it("marks a node as modified when an outgoing edge is removed", () => {
			const foo = gNode("src/users/foo.component.ts");
			const bar = gNode("src/users/bar.component.ts");
			const base = makeFullGraph(
				"src/users",
				[foo, bar],
				[gEdge("src/users/foo.component.ts", "src/users/bar.component.ts")],
			);
			const current = makeFullGraph("src/users", [foo, bar], []);
			const result = diffGraphs(base, current);
			expect(
				result.nodes.find((n) => n.file === "src/users/foo.component.ts")?.diff,
			).toBe("modified");
		});

		it("does not create a ghost node for a removed out-of-scope node", () => {
			const oos = gNode("src/shared/api.service.ts", { scope: "out-of-scope" });
			const base = makeFullGraph("src/users", [oos]);
			const current = makeFullGraph("src/users", []);
			const result = diffGraphs(base, current);
			expect(result.nodes).toHaveLength(0);
		});
	});

	describe("edge diff states", () => {
		it("marks an edge in current but not base as added", () => {
			const foo = gNode("src/users/foo.component.ts");
			const bar = gNode("src/users/bar.component.ts");
			const base = makeFullGraph("src/users", [foo, bar], []);
			const current = makeFullGraph(
				"src/users",
				[foo, bar],
				[gEdge("src/users/foo.component.ts", "src/users/bar.component.ts")],
			);
			const result = diffGraphs(base, current);
			expect(result.edges[0].diff).toBe("added");
		});

		it("marks an edge in both as unchanged", () => {
			const foo = gNode("src/users/foo.component.ts");
			const bar = gNode("src/users/bar.component.ts");
			const e = gEdge(
				"src/users/foo.component.ts",
				"src/users/bar.component.ts",
			);
			const base = makeFullGraph("src/users", [foo, bar], [e]);
			const current = makeFullGraph("src/users", [foo, bar], [e]);
			const result = diffGraphs(base, current);
			expect(result.edges[0].diff).toBe("unchanged");
		});

		it("adds a removed edge with diff: removed", () => {
			const foo = gNode("src/users/foo.component.ts");
			const bar = gNode("src/users/bar.component.ts");
			const e = gEdge(
				"src/users/foo.component.ts",
				"src/users/bar.component.ts",
			);
			const base = makeFullGraph("src/users", [foo, bar], [e]);
			const current = makeFullGraph("src/users", [foo, bar], []);
			const result = diffGraphs(base, current);
			expect(result.edges.find((e) => e.diff === "removed")).toBeDefined();
		});

		it("includes removed edges involving ghost nodes", () => {
			const foo = gNode("src/users/foo.component.ts");
			const bar = gNode("src/users/bar.component.ts");
			const e = gEdge(
				"src/users/foo.component.ts",
				"src/users/bar.component.ts",
			);
			const base = makeFullGraph("src/users", [foo, bar], [e]);
			const current = makeFullGraph("src/users", [foo]);
			const result = diffGraphs(base, current);
			expect(result.edges.find((e) => e.diff === "removed")).toBeDefined();
		});
	});

	describe("output shape", () => {
		it("updates meta nodeCount", () => {
			const base = makeFullGraph("src/users", []);
			const current = makeFullGraph("src/users", [
				gNode("src/users/foo.component.ts"),
			]);
			const result = diffGraphs(base, current);
			expect(result.meta.nodeCount).toBe(1);
		});

		it("does not mutate input graphs", () => {
			const n = gNode("src/users/foo.component.ts");
			const base = makeFullGraph("src/users", [n]);
			const current = makeFullGraph("src/users", [n]);
			diffGraphs(base, current);
			expect(base.nodes[0].diff).toBeNull();
			expect(current.nodes[0].diff).toBeNull();
		});
	});
});

// ─── diffGraphs — edge modified state ────────────────────────────────────────

describe("diffGraphs — edge modified state", () => {
	const foo = gNode("src/users/foo.component.ts");
	const bar = gNode("src/users/bar.component.ts");

	it("edge with same importedNames in both graphs is unchanged", () => {
		const e = gEdge(
			"src/users/foo.component.ts",
			"src/users/bar.component.ts",
			["A"],
		);
		const base = makeFullGraph("src/users", [foo, bar], [e]);
		const current = makeFullGraph("src/users", [foo, bar], [e]);
		const result = diffGraphs(base, current);
		expect(result.edges[0].diff).toBe("unchanged");
	});

	it("edge with different importedNames (base [A], current [A, B]) is modified", () => {
		const eBase = gEdge(
			"src/users/foo.component.ts",
			"src/users/bar.component.ts",
			["A"],
		);
		const eCurrent = gEdge(
			"src/users/foo.component.ts",
			"src/users/bar.component.ts",
			["A", "B"],
		);
		const base = makeFullGraph("src/users", [foo, bar], [eBase]);
		const current = makeFullGraph("src/users", [foo, bar], [eCurrent]);
		const result = diffGraphs(base, current);
		expect(result.edges[0].diff).toBe("modified");
	});

	it("edge only in current is added", () => {
		const eCurrent = gEdge(
			"src/users/foo.component.ts",
			"src/users/bar.component.ts",
			["A"],
		);
		const base = makeFullGraph("src/users", [foo, bar], []);
		const current = makeFullGraph("src/users", [foo, bar], [eCurrent]);
		const result = diffGraphs(base, current);
		expect(result.edges[0].diff).toBe("added");
	});

	it("edge only in base is removed", () => {
		const eBase = gEdge(
			"src/users/foo.component.ts",
			"src/users/bar.component.ts",
			["A"],
		);
		const base = makeFullGraph("src/users", [foo, bar], [eBase]);
		const current = makeFullGraph("src/users", [foo, bar], []);
		const result = diffGraphs(base, current);
		expect(result.edges.find((e) => e.diff === "removed")).toBeDefined();
	});

	it("node whose only outgoing edge changed importedNames gets diff modified", () => {
		const eBase = gEdge(
			"src/users/foo.component.ts",
			"src/users/bar.component.ts",
			["A"],
		);
		const eCurrent = gEdge(
			"src/users/foo.component.ts",
			"src/users/bar.component.ts",
			["A", "B"],
		);
		const base = makeFullGraph("src/users", [foo, bar], [eBase]);
		const current = makeFullGraph("src/users", [foo, bar], [eCurrent]);
		const result = diffGraphs(base, current);
		expect(
			result.nodes.find((n) => n.file === "src/users/foo.component.ts")?.diff,
		).toBe("modified");
	});
});

// ─── change magnitude ────────────────────────────────────────────────────────

describe("diffGraphs linesChanged", () => {
	it("added node counts its full lineCount as linesChanged", () => {
		const base = makeFullGraph("src/users", []);
		const current = makeFullGraph("src/users", [
			gNode("src/users/foo.component.ts", { lineCount: 42 }),
		]);
		const result = diffGraphs(base, current);
		expect(result.nodes[0].linesChanged).toBe(42);
	});

	it("removed ghost counts its full base lineCount as linesChanged", () => {
		const base = makeFullGraph("src/users", [
			gNode("src/users/foo.component.ts", { lineCount: 17 }),
		]);
		const current = makeFullGraph("src/users", []);
		const result = diffGraphs(base, current);
		expect(result.nodes[0].linesChanged).toBe(17);
	});

	it("modified node counts the absolute lineCount delta", () => {
		const eBase = gEdge(
			"src/users/foo.component.ts",
			"src/users/bar.component.ts",
			["A"],
		);
		const eCurrent = gEdge(
			"src/users/foo.component.ts",
			"src/users/bar.component.ts",
			["A", "B"],
		);
		const base = makeFullGraph(
			"src/users",
			[
				gNode("src/users/foo.component.ts", { lineCount: 30 }),
				gNode("src/users/bar.component.ts", { lineCount: 10 }),
			],
			[eBase],
		);
		const current = makeFullGraph(
			"src/users",
			[
				gNode("src/users/foo.component.ts", { lineCount: 18 }),
				gNode("src/users/bar.component.ts", { lineCount: 10 }),
			],
			[eCurrent],
		);
		const result = diffGraphs(base, current);
		const foo = result.nodes.find(
			(n) => n.file === "src/users/foo.component.ts",
		);
		expect(foo?.diff).toBe("modified");
		expect(foo?.linesChanged).toBe(12);
	});

	it("unchanged node gets no linesChanged and no magnitude", () => {
		const node = gNode("src/users/foo.component.ts", { lineCount: 30 });
		const base = makeFullGraph("src/users", [node]);
		const current = makeFullGraph("src/users", [node]);
		const result = diffGraphs(base, current);
		expect(result.nodes[0].diff).toBe("unchanged");
		expect(result.nodes[0].linesChanged).toBeUndefined();
		expect(result.nodes[0].magnitude).toBeUndefined();
	});

	it("missing lineCount is treated as 0", () => {
		const base = makeFullGraph("src/users", []);
		const current = makeFullGraph("src/users", [
			gNode("src/users/foo.component.ts"),
		]);
		const result = diffGraphs(base, current);
		expect(result.nodes[0].linesChanged).toBe(0);
	});

	it("assigns relative magnitudes across the diffed graph", () => {
		const base = makeFullGraph("src/users", []);
		const current = makeFullGraph("src/users", [
			gNode("src/users/big.component.ts", { lineCount: 40 }),
			gNode("src/users/small.component.ts", { lineCount: 10 }),
		]);
		const result = diffGraphs(base, current);
		const big = result.nodes.find(
			(n) => n.file === "src/users/big.component.ts",
		);
		const small = result.nodes.find(
			(n) => n.file === "src/users/small.component.ts",
		);
		expect(big?.magnitude).toBe(1);
		expect(small?.magnitude).toBe(0.25);
	});
});

describe("applyChangeMagnitude", () => {
	function mNode(
		file: string,
		diff: GraphNode["diff"],
		linesChanged?: number,
	): GraphNode {
		return {
			id: file,
			label: file,
			file,
			type: "component",
			scope: "in-scope",
			diff,
			...(linesChanged !== undefined ? { linesChanged } : {}),
		};
	}

	it("scales each changed node relative to the max-changed node", () => {
		const result = applyChangeMagnitude([
			mNode("a.ts", "added", 50),
			mNode("b.ts", "modified", 25),
			mNode("c.ts", "removed", 10),
		]);
		expect(result.map((n) => n.magnitude)).toEqual([1, 0.5, 0.2]);
	});

	it("a single changed node gets magnitude 1", () => {
		const result = applyChangeMagnitude([mNode("a.ts", "modified", 7)]);
		expect(result[0].magnitude).toBe(1);
	});

	it("zero changed nodes: no division by zero, no magnitudes assigned", () => {
		const result = applyChangeMagnitude([
			mNode("a.ts", "unchanged"),
			mNode("b.ts", null),
		]);
		expect(result.every((n) => n.magnitude === undefined)).toBe(true);
	});

	it("unchanged nodes are returned untouched even when others changed", () => {
		const unchanged = mNode("a.ts", "unchanged");
		const result = applyChangeMagnitude([unchanged, mNode("b.ts", "added", 5)]);
		expect(result[0]).toEqual(unchanged);
		expect(result[0].magnitude).toBeUndefined();
	});

	it("changed nodes all at zero linesChanged fall back to full magnitude", () => {
		const result = applyChangeMagnitude([
			mNode("a.ts", "modified", 0),
			mNode("b.ts", "modified", 0),
		]);
		expect(result.map((n) => n.magnitude)).toEqual([1, 1]);
	});

	it("a changed node with zero linesChanged scales to 0 when others changed more", () => {
		const result = applyChangeMagnitude([
			mNode("a.ts", "modified", 0),
			mNode("b.ts", "added", 20),
		]);
		expect(result[0].magnitude).toBe(0);
		expect(result[1].magnitude).toBe(1);
	});
});
