import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addContext } from "./filter.js";
import type { GraphEdge, GraphNode } from "./types.js";

// ─── helpers ────────────────────────────────────────────────────────────────

let tmpDir: string;
let OOS_FILE: string;

beforeAll(() => {
	tmpDir = mkdtempSync(path.join(tmpdir(), "diff-diagram-filter-test-"));
	OOS_FILE = path.join(tmpDir, "api.service.ts");
	writeFileSync(OOS_FILE, "export class ApiService {}\n");
});

afterAll(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function makeGraph({
	nodes = [],
	edges = [],
	oosEdges = [],
}: {
	nodes?: Partial<GraphNode>[];
	edges?: Partial<GraphEdge>[];
	oosEdges?: Array<{ from: string; toFile: string; typeOnly?: boolean }>;
} = {}) {
	return {
		meta: {
			repoRoot: tmpDir,
			scopeDir: "src/app/features/users",
			nodeCount: nodes.length,
			edgeCount: edges.length,
		},
		nodes,
		edges,
		_oosEdges: oosEdges,
	};
}

function makeNode(file: string, overrides: Record<string, unknown> = {}) {
	const base = file.split("/").at(-1).replace(/\.ts$/, "");
	return {
		id: base.replace(/[^a-zA-Z0-9]/g, "_"),
		label: base,
		file,
		type: "component",
		scope: "in-scope",
		diff: null,
		...overrides,
	};
}

// ─── addContext ──────────────────────────────────────────────────────────────

describe("addContext", () => {
	describe("out-of-scope node creation", () => {
		it("adds an out-of-scope node for each unique _oosEdges toFile", () => {
			const graph = makeGraph({
				nodes: [makeNode("src/app/features/users/foo.component.ts")],
				oosEdges: [{ from: "foo_component", toFile: OOS_FILE }],
			});
			const result = addContext(graph);
			expect(
				result.nodes.filter((n) => n.scope === "out-of-scope"),
			).toHaveLength(1);
		});

		it("deduplicates out-of-scope nodes when multiple in-scope files import the same out-of-scope file", () => {
			const graph = makeGraph({
				nodes: [
					makeNode("src/app/features/users/foo.component.ts"),
					makeNode("src/app/features/users/bar.component.ts"),
				],
				oosEdges: [
					{ from: "foo_component", toFile: OOS_FILE },
					{ from: "bar_component", toFile: OOS_FILE },
				],
			});
			const result = addContext(graph);
			expect(
				result.nodes.filter((n) => n.scope === "out-of-scope"),
			).toHaveLength(1);
		});

		it("sets scope: out-of-scope on context nodes", () => {
			const graph = makeGraph({
				oosEdges: [{ from: "foo", toFile: OOS_FILE }],
			});
			const result = addContext(graph);
			expect(result.nodes[0].scope).toBe("out-of-scope");
		});

		it("sets diff: null on context nodes", () => {
			const graph = makeGraph({
				oosEdges: [{ from: "foo", toFile: OOS_FILE }],
			});
			const result = addContext(graph);
			expect(result.nodes[0].diff).toBeNull();
		});

		it("sets _content to the out-of-scope file's raw text", () => {
			const graph = makeGraph({
				oosEdges: [{ from: "foo", toFile: OOS_FILE }],
			});
			const result = addContext(graph);
			expect(result.nodes[0]._content).toBe("export class ApiService {}\n");
		});

		it("preserves in-scope nodes", () => {
			const inScopeNode = makeNode("src/app/features/users/foo.component.ts");
			const graph = makeGraph({
				nodes: [inScopeNode],
				oosEdges: [{ from: "foo_component", toFile: OOS_FILE }],
			});
			const result = addContext(graph);
			expect(result.nodes.filter((n) => n.scope === "in-scope")).toHaveLength(
				1,
			);
			expect(
				result.nodes.filter((n) => n.scope === "out-of-scope"),
			).toHaveLength(1);
		});
	});

	describe("out-of-scope node filtering", () => {
		it("skips entries where toFile is not an absolute path (npm packages)", () => {
			const graph = makeGraph({
				oosEdges: [
					{ from: "foo", toFile: "@angular/core" },
					{ from: "foo", toFile: "rxjs/operators" },
				],
			});
			const result = addContext(graph);
			expect(result.nodes).toHaveLength(0);
		});

		it("skips entries where toFile is null or undefined", () => {
			const graph = makeGraph({
				oosEdges: [
					{ from: "foo", toFile: null },
					{ from: "foo", toFile: undefined },
				],
			});
			const result = addContext(graph);
			expect(result.nodes).toHaveLength(0);
		});
	});

	describe("edge creation", () => {
		it("adds an import edge from in-scope to out-of-scope node", () => {
			const graph = makeGraph({
				oosEdges: [{ from: "foo_component", toFile: OOS_FILE }],
			});
			const result = addContext(graph);
			expect(result.edges).toHaveLength(1);
			expect(result.edges[0]).toMatchObject({
				from: "foo_component",
				kind: "import",
			});
		});

		it("deduplicates edges when the same (from, to) pair appears multiple times", () => {
			const graph = makeGraph({
				oosEdges: [
					{ from: "foo", toFile: OOS_FILE },
					{ from: "foo", toFile: OOS_FILE },
				],
			});
			const result = addContext(graph);
			expect(result.edges).toHaveLength(1);
		});

		it("does not duplicate edges that are already in the graph", () => {
			const oosNodeId = "api_service";
			const graph = makeGraph({
				edges: [{ from: "foo", to: oosNodeId, kind: "import" }],
				oosEdges: [{ from: "foo", toFile: OOS_FILE }],
			});
			const result = addContext(graph);
			expect(result.edges.filter((e) => e.from === "foo")).toHaveLength(1);
		});
	});

	describe("output shape", () => {
		it("removes _oosEdges from the returned graph", () => {
			const graph = makeGraph({
				oosEdges: [{ from: "foo", toFile: OOS_FILE }],
			});
			const result = addContext(graph);
			expect(result._oosEdges).toBeUndefined();
		});

		it("updates meta.nodeCount to include out-of-scope nodes", () => {
			const graph = makeGraph({
				nodes: [makeNode("src/app/features/users/foo.component.ts")],
				oosEdges: [{ from: "foo", toFile: OOS_FILE }],
			});
			const result = addContext(graph);
			expect(result.meta.nodeCount).toBe(2);
		});

		it("updates meta.edgeCount to include new edges", () => {
			const graph = makeGraph({
				oosEdges: [{ from: "foo", toFile: OOS_FILE }],
			});
			const result = addContext(graph);
			expect(result.meta.edgeCount).toBe(1);
		});

		it("handles an empty _oosEdges array", () => {
			const node = makeNode("src/app/features/users/foo.component.ts");
			const graph = makeGraph({ nodes: [node], oosEdges: [] });
			const result = addContext(graph);
			expect(result.nodes).toHaveLength(1);
			expect(result.edges).toHaveLength(0);
		});

		it("handles a graph with no _oosEdges property", () => {
			const graph = makeGraph();
			delete graph._oosEdges;
			const result = addContext(graph);
			expect(result.nodes).toHaveLength(0);
		});

		it("does not mutate the input graph", () => {
			const graph = makeGraph({
				nodes: [makeNode("src/app/features/users/foo.component.ts")],
				oosEdges: [{ from: "foo", toFile: OOS_FILE }],
			});
			const originalNodeCount = graph.nodes.length;
			addContext(graph);
			expect(graph.nodes).toHaveLength(originalNodeCount);
		});
	});
});
