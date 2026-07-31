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

		it("marks a node in both with identical content as unchanged", () => {
			const base = makeFullGraph("src/users", [
				gNode("src/users/foo.component.ts", { _content: "same" }),
			]);
			const current = makeFullGraph("src/users", [
				gNode("src/users/foo.component.ts", { _content: "same" }),
			]);
			const result = diffGraphs(base, current);
			expect(result.nodes[0].diff).toBe("unchanged");
		});

		it("marks a node as modified when its content differs, independent of edges", () => {
			const base = makeFullGraph("src/users", [
				gNode("src/users/foo.component.ts", { _content: "before" }),
			]);
			const current = makeFullGraph("src/users", [
				gNode("src/users/foo.component.ts", { _content: "after" }),
			]);
			const result = diffGraphs(base, current);
			expect(result.nodes[0].diff).toBe("modified");
		});

		it("marks a node as unchanged when its edges differ but its content does not", () => {
			const foo = gNode("src/users/foo.component.ts", { _content: "same" });
			const bar = gNode("src/users/bar.component.ts", { _content: "same" });
			const base = makeFullGraph("src/users", [foo, bar], []);
			const current = makeFullGraph(
				"src/users",
				[foo, bar],
				[gEdge("src/users/foo.component.ts", "src/users/bar.component.ts")],
			);
			const result = diffGraphs(base, current);
			expect(
				result.nodes.find((n) => n.file === "src/users/foo.component.ts")?.diff,
			).toBe("unchanged");
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

	it("removed edge retains typeOnly and importedNames from the base edge", () => {
		const eBase = {
			...gEdge("src/users/foo.component.ts", "src/users/bar.component.ts", [
				"A",
			]),
			typeOnly: true,
		};
		const base = makeFullGraph("src/users", [foo, bar], [eBase]);
		const current = makeFullGraph("src/users", [foo, bar], []);
		const result = diffGraphs(base, current);
		const removed = result.edges.find((e) => e.diff === "removed");
		expect(removed?.typeOnly).toBe(true);
		expect(removed?.importedNames).toEqual(["A"]);
	});
});

// ─── diffGraphs — linesChanged ────────────────────────────────────────────────

describe("diffGraphs — linesChanged", () => {
	it("added node's linesChanged is its own line count", () => {
		const base = makeFullGraph("src/users", []);
		const current = makeFullGraph("src/users", [
			gNode("src/users/foo.component.ts", { _content: "a\nb\nc" }),
		]);
		const result = diffGraphs(base, current);
		expect(result.nodes[0].linesChanged).toBe(3);
	});

	it("removed ghost's linesChanged is the base file's line count", () => {
		const base = makeFullGraph("src/users", [
			gNode("src/users/foo.component.ts", { _content: "a\nb" }),
		]);
		const current = makeFullGraph("src/users", []);
		const result = diffGraphs(base, current);
		expect(result.nodes[0].linesChanged).toBe(2);
	});

	it("modified node's linesChanged counts actual changed lines, not the net line-count delta", () => {
		// Same line count in both (2 lines), but line 1's content differs. A
		// naive |current.lineCount - base.lineCount| would score this 0 —
		// exactly the flaw in PR #40 this design fixes.
		const base = makeFullGraph("src/users", [
			gNode("src/users/foo.component.ts", { _content: "foo\nbar" }),
		]);
		const current = makeFullGraph("src/users", [
			gNode("src/users/foo.component.ts", { _content: "baz\nbar" }),
		]);
		const result = diffGraphs(base, current);
		expect(result.nodes[0].diff).toBe("modified");
		expect(result.nodes[0].linesChanged).toBe(2); // 1 removed + 1 added
	});

	it("unchanged node has linesChanged 0", () => {
		const base = makeFullGraph("src/users", [
			gNode("src/users/foo.component.ts", { _content: "same" }),
		]);
		const current = makeFullGraph("src/users", [
			gNode("src/users/foo.component.ts", { _content: "same" }),
		]);
		const result = diffGraphs(base, current);
		expect(result.nodes[0].linesChanged).toBe(0);
	});
});

// ─── applyChangeMagnitude ──────────────────────────────────────────────────────

describe("applyChangeMagnitude", () => {
	it("scales linesChanged relative to the 80th percentile (equals the max for small eligible sets)", () => {
		const nodes = [
			gNode("a.ts", { diff: "added", linesChanged: 10 }),
			gNode("b.ts", { diff: "added", linesChanged: 40 }),
		];
		const result = applyChangeMagnitude(nodes);
		expect(result[0].magnitude).toBeCloseTo(0.25);
		expect(result[1].magnitude).toBeCloseTo(1);
	});

	it("single changed node gets magnitude 1", () => {
		const nodes = [gNode("a.ts", { diff: "modified", linesChanged: 7 })];
		const result = applyChangeMagnitude(nodes);
		expect(result[0].magnitude).toBe(1);
	});

	it("unchanged nodes get no magnitude", () => {
		const nodes = [gNode("a.ts", { diff: "unchanged", linesChanged: 0 })];
		const result = applyChangeMagnitude(nodes);
		expect(result[0].magnitude).toBeUndefined();
	});

	it("out-of-scope nodes are excluded from the max computation and get no magnitude", () => {
		const nodes = [
			gNode("a.ts", {
				diff: "modified",
				linesChanged: 5,
				scope: "in-scope",
			}),
			gNode("b.ts", {
				diff: "modified",
				linesChanged: 500,
				scope: "out-of-scope",
			}),
		];
		const result = applyChangeMagnitude(nodes);
		expect(result[0].magnitude).toBe(1); // not flattened by the huge OOS diff
		expect(result[1].magnitude).toBeUndefined();
	});

	it("removed-ghost nodes are eligible for magnitude", () => {
		const nodes = [
			gNode("a.ts", {
				diff: "removed",
				linesChanged: 20,
				scope: "removed-ghost",
			}),
		];
		const result = applyChangeMagnitude(nodes);
		expect(result[0].magnitude).toBe(1);
	});

	it("a graph with no changed nodes does not divide by zero", () => {
		const nodes = [gNode("a.ts", { diff: "unchanged", linesChanged: 0 })];
		expect(() => applyChangeMagnitude(nodes)).not.toThrow();
	});

	it("with 6+ eligible nodes, scales relative to the 80th percentile and clamps values above it to 1", () => {
		// Mirrors real-world PR data: one outlier (100) among many small
		// changes. Scaling by the plain max would crush every value below 9
		// down near 0 (e.g. 1/100 = 0.01); percentile-clamping instead treats
		// the second-largest value (9) as "already fully changed", trading
		// away rank distinction between 9 and 100 for much better visibility
		// across the small-to-medium majority.
		const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 100];
		const nodes = values.map((v, i) =>
			gNode(`f${i}.ts`, { diff: "modified", linesChanged: v }),
		);
		const result = applyChangeMagnitude(nodes);
		const magnitudeByLines = new Map(
			result.map((n) => [n.linesChanged, n.magnitude]),
		);
		expect(magnitudeByLines.get(1)).toBeCloseTo(1 / 9);
		expect(magnitudeByLines.get(9)).toBe(1); // at the 80th-percentile threshold
		expect(magnitudeByLines.get(100)).toBe(1); // clamped, indistinguishable from 9
	});

	it("with 5 or fewer eligible nodes, the 80th percentile is always the max (no clamping effect)", () => {
		const nodes = [1, 2, 3, 4, 5].map((v, i) =>
			gNode(`f${i}.ts`, { diff: "modified", linesChanged: v }),
		);
		const result = applyChangeMagnitude(nodes);
		const magnitudeByLines = new Map(
			result.map((n) => [n.linesChanged, n.magnitude]),
		);
		expect(magnitudeByLines.get(1)).toBeCloseTo(1 / 5);
		expect(magnitudeByLines.get(5)).toBe(1);
	});
});
