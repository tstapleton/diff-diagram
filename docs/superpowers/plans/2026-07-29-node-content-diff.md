# Content-Based Node Diff State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make node diff state (`added`/`modified`/`removed`/`unchanged`) reflect whether a file's own content changed between base and current branches, instead of being a proxy computed from its outgoing import edges. Edge diff state stays exactly as it is today (import-based).

**Architecture:** The analyzer already reads every file's full text via ts-morph to parse imports; it now also attaches that raw text to each `GraphNode` as an internal-only field (`_content`), never serialized to `graph.json`. `filter.ts` does the same for out-of-scope nodes by reading the file directly (it doesn't have a ts-morph `Project` handle). `diffGraphs` compares `_content` between the base and current copy of a node (matched by `file` path) to decide `modified` vs `unchanged`, replacing the old logic that inspected outgoing edges. Edge diffing is untouched.

**Tech Stack:** TypeScript, ts-morph, vitest, Node built-ins (`node:fs`).

**Design doc:** `docs/superpowers/specs/2026-07-29-node-content-diff-design.md` — read this first if anything below is ambiguous; it has the full rationale (including why hashing was rejected and why this doesn't foreclose the separate change-magnitude feature, issue #27).

## Global Constraints

- **One commit per PR** (this repo enforces it with a PreToolUse hook that blocks `gh pr create` on branches more than one commit ahead of base — see project `CLAUDE.md`). **Do not commit after each task below.** Stage changes as you go (`git add`) if you want checkpoints, but the *only* `git commit` in this plan is the last step of Task 7.
- **Branch:** work on a fresh branch cut from `origin/main`, separate from `docs/node-content-diff-design` (that branch is the already-merged-or-pending single-commit PR for the design doc only — do not add implementation commits to it). Suggested name: `feat/node-content-diff`.
- **Never use `--no-verify`.** The pre-commit hook runs `npm run verify` (build + biome + unit tests + visual tests) — if it fails, fix the underlying issue.
- **Formatting:** this repo uses Biome with tabs for indentation in `.ts` files (not inside template-literal strings, which preserve their own literal whitespace). Run `npm run format` if unsure; the pre-commit hook also runs it.
- **Visual snapshots:** Task 5 intentionally changes what one fixture node renders as (grey → amber). Per `CLAUDE.md`, this requires visually reviewing the change, running `npm run test:visual:approve`, re-running `npm run verify`, and calling out the regenerated snapshots prominently in the PR body. Do not approve a visual failure you can't explain — Task 5 walks through exactly why this one is expected.

---

### Task 1: Analyzer captures each node's raw file content

**Files:**
- Modify: `src/types.ts`
- Modify: `src/analyzer.ts:221-230`
- Test: `src/analyzer.test.ts`

**Interfaces:**
- Produces: `GraphNode._content?: string` — internal-only field holding the file's raw text as read by ts-morph (`sf.getFullText()`). Present on every in-scope node. Later tasks (2, 3, 4) read and write this same field.

- [ ] **Step 1: Write the failing test**

Open `src/analyzer.test.ts`. Find the comment line `// ─── analyze() — type-only imports ──────────────────────────────────────────` and insert this new `describe` block immediately **before** it:

```typescript
// ─── analyze() — file content capture ───────────────────────────────────────

describe("analyze (file content capture)", { timeout: 15000 }, () => {
	let tmpRootContent: string;
	let scopeDirContent: string;

	beforeAll(() => {
		tmpRootContent = mkdtempSync(path.join(tmpdir(), "diff-diagram-content-"));
		scopeDirContent = path.join(
			tmpRootContent,
			"src",
			"app",
			"features",
			"users",
		);
		mkdirSync(scopeDirContent, { recursive: true });

		writeFileSync(
			path.join(scopeDirContent, "foo.component.ts"),
			"export class FooComponent {}\n",
		);
	});

	afterAll(() => {
		rmSync(tmpRootContent, { recursive: true, force: true });
	});

	it("attaches the file's raw text as an internal _content field", async () => {
		const graph = await analyze(scopeDirContent, { repoRoot: tmpRootContent });
		const node = graph.nodes.find((n) => n.file.includes("foo.component"));
		expect(node?._content).toBe("export class FooComponent {}\n");
	});
});

```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/analyzer.test.ts -t "file content capture"`
Expected: FAIL — TypeScript compile error or `expected undefined to be 'export class FooComponent {}\n'` (the field doesn't exist yet).

- [ ] **Step 3: Add the field to the type**

In `src/types.ts`, add `_content` to `GraphNode`:

```typescript
export interface GraphNode {
	id: string;
	label: string;
	file: string;
	type: NodeType | "stub";
	scope: NodeScope;
	diff: DiffState | null;
	typeOnly?: boolean;
	hasTests?: boolean;
	hasStories?: boolean;
	/**
	 * Internal only: the file's raw text, used by diffGraphs to detect content
	 * changes. Never serialized — stripped from graph.json before it's written.
	 */
	_content?: string;
}
```

- [ ] **Step 4: Attach content in the analyzer**

In `src/analyzer.ts`, the node-construction loop currently reads (around line 221):

```typescript
		nodes.push({
			id,
			label: labelFromFile(fp),
			file: path.relative(resolvedRoot, fp),
			type: classifyFile(sf),
			scope: "in-scope",
			diff: null,
			...(hasTests ? { hasTests: true } : {}),
			...(hasStories ? { hasStories: true } : {}),
		});
```

Add `_content: sf.getFullText(),` right after `diff: null,`:

```typescript
		nodes.push({
			id,
			label: labelFromFile(fp),
			file: path.relative(resolvedRoot, fp),
			type: classifyFile(sf),
			scope: "in-scope",
			diff: null,
			_content: sf.getFullText(),
			...(hasTests ? { hasTests: true } : {}),
			...(hasStories ? { hasStories: true } : {}),
		});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/analyzer.test.ts`
Expected: PASS — all tests in the file, including the new one.

- [ ] **Step 6: Stage the change**

```bash
git add src/types.ts src/analyzer.ts src/analyzer.test.ts
```

(Do not commit — see Global Constraints.)

---

### Task 2: `addContext` captures out-of-scope node content

**Files:**
- Modify: `src/filter.ts`
- Modify: `src/filter.test.ts` (full rewrite — see below)

**Interfaces:**
- Consumes: `GraphNode._content?: string` (Task 1).
- Produces: out-of-scope `GraphNode`s also carry `_content`, so Task 3's diff logic works uniformly across in-scope and out-of-scope nodes (both already get the same `diff` treatment per `docs/architecture.md`).

`filter.ts`'s `addContext` doesn't have access to a ts-morph `Project` (it only receives `_oosEdges`, a list of `{ from, toFile }` path strings produced by a separate `analyze()` call), so it reads each out-of-scope file directly from disk. This means the existing unit tests — which use fake, non-existent paths like `/repo/src/app/shared/api.service.ts` as `toFile` — will start throwing `ENOENT` once the read is added. `src/filter.test.ts` needs a real temporary file for every test that expects `addContext` to actually construct an out-of-scope node.

- [ ] **Step 1: Rewrite the test file with a real fixture file**

Replace the entire contents of `src/filter.test.ts` with:

```typescript
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
```

Note the two things that changed structurally from the old file, beyond the new test: `makeGraph`'s `meta.repoRoot` is now `tmpDir` (a real directory) instead of the fake `"/repo"`, and every `toFile` that should produce a real out-of-scope node now points at `OOS_FILE` instead of a fake path string. This makes `toNodeId(OOS_FILE, tmpDir)` resolve to `"api_service"` (relative path `api.service.ts` → sanitized), which is why `oosNodeId` in the "does not duplicate edges..." test changed from the old `"src_app_shared_api_service"` to `"api_service"`.

- [ ] **Step 2: Run tests to verify the new one fails, others still pass**

Run: `npx vitest run src/filter.test.ts`
Expected: 16 tests, all passing **except** `"sets _content to the out-of-scope file's raw text"`, which FAILs with `expected undefined to be 'export class ApiService {}\n'`.

- [ ] **Step 3: Implement the read in `addContext`**

In `src/filter.ts`, add the import at the top:

```typescript
import { readFileSync } from "node:fs";
import path from "node:path";
import { classifyByFilename, labelFromFile, toNodeId } from "./analyzer.js";
import type { Graph, GraphEdge, GraphNode } from "./types.js";
```

Then find the node-construction block (around line 29):

```typescript
		const id = toNodeId(toFile, repoRoot);
		if (!contextById.has(id)) {
			contextById.set(id, {
				id,
				label: labelFromFile(toFile),
				file: path.relative(repoRoot, toFile),
				type: classifyOutOfScope(toFile),
				scope: "out-of-scope",
				diff: null,
			});
		}
```

Add `_content: readFileSync(toFile, "utf8"),` after `diff: null,`:

```typescript
		const id = toNodeId(toFile, repoRoot);
		if (!contextById.has(id)) {
			contextById.set(id, {
				id,
				label: labelFromFile(toFile),
				file: path.relative(repoRoot, toFile),
				type: classifyOutOfScope(toFile),
				scope: "out-of-scope",
				diff: null,
				_content: readFileSync(toFile, "utf8"),
			});
		}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run src/filter.test.ts`
Expected: PASS — 17 tests (16 original + 1 new).

- [ ] **Step 5: Stage the change**

```bash
git add src/filter.ts src/filter.test.ts
```

---

### Task 3: `diffGraphs` classifies node diff state by content, not edges

**Files:**
- Modify: `src/diff-parser.ts:39-88`
- Modify: `src/diff-parser.test.ts`

**Interfaces:**
- Consumes: `GraphNode._content?: string` (Tasks 1–2) on both the base and current copy of a node.
- Produces: `GraphNode.diff` for non-added/removed nodes is now `baseNode._content === currentNode._content ? "unchanged" : "modified"`. Edge diff state (`diffedEdges`, later in the same function) is completely unchanged — still driven by `importedNames` set comparison.

- [ ] **Step 1: Update the node-diff tests (red)**

In `src/diff-parser.test.ts`, find this block inside `describe("node diff states", ...)`:

```typescript
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
```

Replace it with:

```typescript
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
```

The third test is the key one: it proves node and edge diffing are now fully decoupled — an added edge with no content change must **not** mark the node modified.

Now find this test at the end of `describe("diffGraphs — edge modified state", ...)` (it tests the old coupling and is superseded by the tests above):

```typescript
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
```

Delete just that `it(...)` block, keeping the closing `});` of the `describe`:

```typescript
});
```

- [ ] **Step 2: Run tests to verify the updated ones fail**

Run: `npx vitest run src/diff-parser.test.ts`
Expected: FAIL on the three rewritten node tests (the old edge-based logic still runs) — e.g. `"marks a node as modified when its content differs, independent of edges"` fails because both nodes have no edges and the old logic reports `unchanged` regardless of the (currently unused) `_content` field.

- [ ] **Step 3: Implement content-based node diffing**

In `src/diff-parser.ts`, find this block (it currently builds two now-to-be-unused edge-lookup maps, then classifies nodes by inspecting edges):

```typescript
	// Outgoing edges grouped by from-node id, built once for the node loop below
	const baseEdgesByFrom = new Map<string, GraphEdge[]>();
	for (const e of base.edges) {
		const list = baseEdgesByFrom.get(e.from);
		if (list) list.push(e);
		else baseEdgesByFrom.set(e.from, [e]);
	}
	const currentEdgesByFrom = new Map<string, GraphEdge[]>();
	for (const e of current.edges) {
		const list = currentEdgesByFrom.get(e.from);
		if (list) list.push(e);
		else currentEdgesByFrom.set(e.from, [e]);
	}

	// ── Diff nodes ────────────────────────────────────────────────────────────
	const diffedNodes: GraphNode[] = [];

	for (const node of current.nodes) {
		if (!baseByFile.has(node.file)) {
			diffedNodes.push({ ...node, diff: "added" });
		} else {
			// biome-ignore lint/style/noNonNullAssertion: guarded by baseByFile.has() in the if-branch above
			const baseNode = baseByFile.get(node.file)!;

			const outgoingChanged = (currentEdgesByFrom.get(node.id) ?? []).some(
				(e) => {
					const toFile = currentIdToFile.get(e.to);
					if (!toFile) return false;
					const key = `${node.file}→${toFile}`;
					const baseNames = baseEdgeNames.get(key);
					if (!baseNames) return true; // added edge
					// biome-ignore lint/style/noNonNullAssertion: edge e is from current.edges so key was set in currentEdgeNames
					const currentNames = currentEdgeNames.get(key)!;
					return !nameSetsEqual(baseNames, currentNames); // modified edge
				},
			);

			const outgoingRemoved = (baseEdgesByFrom.get(baseNode.id) ?? []).some(
				(e) => {
					const toFile = baseIdToFile.get(e.to);
					return toFile && !currentEdgeNames.has(`${node.file}→${toFile}`);
				},
			);

			diffedNodes.push({
				...node,
				diff: outgoingChanged || outgoingRemoved ? "modified" : "unchanged",
			});
		}
	}
```

Replace it with:

```typescript
	// ── Diff nodes ────────────────────────────────────────────────────────────
	// Node diff state reflects the file's own content, not its edges — symmetric
	// with added/removed, which are also file-level facts. Edge diff state
	// (below) remains import-based and is computed independently.
	const diffedNodes: GraphNode[] = [];

	for (const node of current.nodes) {
		if (!baseByFile.has(node.file)) {
			diffedNodes.push({ ...node, diff: "added" });
		} else {
			// biome-ignore lint/style/noNonNullAssertion: guarded by baseByFile.has() in the if-branch above
			const baseNode = baseByFile.get(node.file)!;
			diffedNodes.push({
				...node,
				diff: baseNode._content === node._content ? "unchanged" : "modified",
			});
		}
	}
```

`baseEdgeNames`, `currentEdgeNames`, and `nameSetsEqual` stay exactly where they are — they're still used by the edge-diffing code later in the same function (the "Diff edges" section and the "Removed edges" loop). Only the two `*EdgesByFrom` maps and the old node-classification body are removed.

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run src/diff-parser.test.ts`
Expected: PASS — all tests, including edge-diff tests (untouched) and the three rewritten node tests.

- [ ] **Step 5: Stage the change**

```bash
git add src/diff-parser.ts src/diff-parser.test.ts
```

---

### Task 4: Strip `_content` before writing `graph.json`

**Files:**
- Modify: `src/cli.ts:327-331`
- Modify: `src/cli.test.ts`

**Interfaces:**
- Consumes: `GraphNode._content` (Tasks 1–3), which by this point is present on every node in the diffed graph.
- Produces: `graph.json` on disk never contains the string `_content`, matching how `meta.repoRoot` is already stripped.

**Note:** this task requires `npm run build` before running its test, because `cli.test.ts` execs the compiled `dist/cli.js`, not the TypeScript source.

- [ ] **Step 1: Write the failing test**

In `src/cli.test.ts`, inside the existing `describe("cli graph.json output", ...)` block (it already has a `tmp`/`repoRoot` fixture with `src/app/features/f/a.ts` written in its `beforeAll`), add this test after the existing `"meta does not contain the absolute repoRoot path"` test, before the closing `});` of the describe block:

```typescript
	it("does not contain the internal _content field on any node", async () => {
		const outDir = path.join(tmp, "out-content");
		const result = await runCli([
			"--repo-root",
			repoRoot,
			"--out-dir",
			outDir,
			"src/app/features/f",
		]);
		expect(result.code).toBe(0);

		const raw = await readFile(path.join(outDir, "graph.json"), "utf8");
		expect(raw).not.toContain("_content");
	}, 30_000);
```

- [ ] **Step 2: Build and run to verify it fails**

Run: `npm run build && npx vitest run src/cli.test.ts -t "does not contain the internal _content field"`
Expected: FAIL — `raw` contains the literal substring `_content` (the field is written to `graph.json` today).

- [ ] **Step 3: Strip the field in `cli.ts`**

Find this block near the end of `main()` (around line 327):

```typescript
	// graph.json — strip meta.repoRoot (absolute local path) like the HTML does
	const { _oosEdges, ...graphOut } = { ...diffed, meta: metaWithoutRoot };
	const jsonPath = path.join(outDir, "graph.json");
	await writeFile(jsonPath, JSON.stringify(graphOut, null, 2));
	console.log(`Wrote ${jsonPath}`);
```

Replace it with:

```typescript
	// graph.json — strip meta.repoRoot (absolute local path) and each node's
	// internal _content field (raw file text, used only for diffing), same
	// spirit as the repoRoot strip above.
	const { _oosEdges, ...graphOut } = { ...diffed, meta: metaWithoutRoot };
	const strippedNodes = graphOut.nodes.map(({ _content, ...rest }) => rest);
	const jsonPath = path.join(outDir, "graph.json");
	await writeFile(
		jsonPath,
		JSON.stringify({ ...graphOut, nodes: strippedNodes }, null, 2),
	);
	console.log(`Wrote ${jsonPath}`);
```

- [ ] **Step 4: Rebuild and run to verify it passes**

Run: `npm run build && npx vitest run src/cli.test.ts`
Expected: PASS — all tests in the file, including the new one.

- [ ] **Step 5: Stage the change**

```bash
git add src/cli.ts src/cli.test.ts
```

---

### Task 5: Fixture regression case + visual snapshot review

This is the task that actually proves the fix. Every fixture case so far (`fake-angular-app`) that shows `modified` today does so because imports changed — which, as the design doc notes, is a special case of content changing (an edited import statement is still an edit to the file's own text). Nothing in the current fixtures exercises "content changed, imports did not," which was exactly the gap issue #41 described. This task adds that case.

**Files:**
- Modify: `fake-angular-app/src/app/features/users/user-list/user-table-header.component.ts` (current-branch fixture only — `fake-angular-app-base/` keeps the original content)
- Modify: `src/integration.test.ts`
- Approve: `test/snapshots/reference/all-nodes.png` and `test/snapshots/reference/diff-focused.png` (the only two files `npm run test:visual:approve` writes — it runs `cp test/snapshots/current/*.png test/snapshots/reference/`; `test/snapshots/current/` itself is gitignored, so nothing there gets committed)

**Interfaces:**
- Consumes: the full pipeline from Tasks 1–4 (`analyze` → `addContext` → `diffGraphs`), run against real fixture directories via `src/integration.test.ts`'s existing `beforeAll`.

- [ ] **Step 1: Confirm the fixture file is currently identical between branches**

Run: `diff fake-angular-app-base/src/app/features/users/user-list/user-table-header.component.ts fake-angular-app/src/app/features/users/user-list/user-table-header.component.ts`
Expected: no output (files are byte-identical today — this is what makes it a valid "currently unchanged" node to turn into the regression case).

- [ ] **Step 2: Write the failing integration test**

In `src/integration.test.ts`, inside `describe("diffGraphs integration — node diff states", ...)`, add this test after `"user-card.component is unchanged"`:

```typescript
	it("user-table-header.component is modified (content changed, imports unchanged)", () => {
		const n = nodeByFile("user-list/user-table-header.component.ts");
		expect(n).toBeDefined();
		expect(n?.diff).toBe("modified");
	});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/integration.test.ts -t "user-table-header"`
Expected: FAIL — `n?.diff` is `"unchanged"` (the two fixture files are still identical at this point).

- [ ] **Step 4: Change the current-branch fixture's body, not its imports**

Edit **only** `fake-angular-app/src/app/features/users/user-list/user-table-header.component.ts` (not the `-base` copy). Current content:

```typescript
import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import type { SortModel } from "./sort.model";
import type { SortStateService } from "./sort-state.service";

@Component({
	selector: "app-user-table-header",
	standalone: true,
	imports: [CommonModule],
	template: `
    <thead>
      <tr>
        <th (click)="sort('lastName')">Name</th>
        <th (click)="sort('email')">Email</th>
        <th (click)="sort('statusId')">Status</th>
      </tr>
    </thead>
  `,
})
export class UserTableHeaderComponent {
	currentSort!: SortModel;

	constructor(private sortState: SortStateService) {
		this.sortState.sort$.subscribe((s) => (this.currentSort = s));
	}

	sort(field: string): void {
		this.sortState.toggle(field);
	}
}
```

Add one more table header cell to the template (no import statements touched):

```typescript
import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import type { SortModel } from "./sort.model";
import type { SortStateService } from "./sort-state.service";

@Component({
	selector: "app-user-table-header",
	standalone: true,
	imports: [CommonModule],
	template: `
    <thead>
      <tr>
        <th (click)="sort('lastName')">Name</th>
        <th (click)="sort('email')">Email</th>
        <th (click)="sort('statusId')">Status</th>
        <th (click)="sort('roleId')">Role</th>
      </tr>
    </thead>
  `,
})
export class UserTableHeaderComponent {
	currentSort!: SortModel;

	constructor(private sortState: SortStateService) {
		this.sortState.sort$.subscribe((s) => (this.currentSort = s));
	}

	sort(field: string): void {
		this.sortState.toggle(field);
	}
}
```

- [ ] **Step 5: Run to verify the integration test passes**

Run: `npx vitest run src/integration.test.ts`
Expected: PASS — all tests, including the new one. (If someone later reverts Task 3's logic, this is the test that would catch it — that's its job.)

- [ ] **Step 6: Run the visual regression suite and read the failure**

Run: `npm run test:visual`
Expected: FAIL, in both `"diff-focused mode renders correctly"` and `"all-nodes mode renders correctly"`. This is expected, not a bug: `user-table-header.component.ts` sits in the `user-list/` subdirectory, which already contains other changed files (`users-list.component.ts` is `modified`, `user-search-results.component.ts` is a removed-ghost), so per the diff-focused collapse rule (`docs/architecture.md`) that whole group was already expanded and this node was already rendered individually — only its fill/stroke color moves from unchanged-grey to modified-amber. The "all nodes" view always renders every node individually regardless of diff state, so the same color change shows up there too. Confirm this is the *only* difference by inspecting the failure output/diff images before proceeding — if anything else changed, stop and investigate before approving.

- [ ] **Step 7: Approve the new snapshots**

Run: `npm run test:visual:approve`
Then: `npm run test:visual` again to confirm it now passes.

- [ ] **Step 8: Update the fixture-diff description docs**

In `docs/architecture.md`, find the "Fixture diff" list (around line 193):

```markdown
Fixture diff:
- Added: `user-settings/user-security.component.ts`, `user-settings/user-notification-prefs.component.ts`; also current-only: `user-list/user-card.stories.ts` (Storybook sidecar, excluded from the graph) and `shared/services/index.ts` (out-of-scope barrel)
- Removed: `user-list/user-search-results.component.ts`
- Modified: `user-settings/user-settings.component.ts` (new imports), `user-list/users-list.component.ts` (new OOS dep `AnalyticsService`, dropped import of the removed component), `user-detail/user-detail.component.ts` (dropped `CacheService`)
```

Add a fourth modified file to that last line:

```markdown
Fixture diff:
- Added: `user-settings/user-security.component.ts`, `user-settings/user-notification-prefs.component.ts`; also current-only: `user-list/user-card.stories.ts` (Storybook sidecar, excluded from the graph) and `shared/services/index.ts` (out-of-scope barrel)
- Removed: `user-list/user-search-results.component.ts`
- Modified: `user-settings/user-settings.component.ts` (new imports), `user-list/users-list.component.ts` (new OOS dep `AnalyticsService`, dropped import of the removed component), `user-detail/user-detail.component.ts` (dropped `CacheService`), `user-list/user-table-header.component.ts` (template content changed, imports unchanged — demonstrates node diff is content-based, not import-based)
```

In `/Users/tstapleton/code/tstapleton/diff-diagram/CLAUDE.md` (the project's own root guidance file, not the plan), find:

```markdown
Fixture diff: two files added in `user-settings/`, one removed in `user-list/`, three files with changed imports, plus a Storybook story added in `user-list/`.
```

Replace with:

```markdown
Fixture diff: two files added in `user-settings/`, one removed in `user-list/`, three files with changed imports, one file with changed content only (imports unchanged, proves node diff is content-based), plus a Storybook story added in `user-list/`.
```

- [ ] **Step 9: Stage the change**

```bash
git add fake-angular-app/src/app/features/users/user-list/user-table-header.component.ts \
  src/integration.test.ts \
  docs/architecture.md \
  CLAUDE.md \
  test/snapshots/reference/all-nodes.png \
  test/snapshots/reference/diff-focused.png
```

---

### Task 6: Update product docs for the new semantics

**Files:**
- Modify: `docs/spec.md`
- Modify: `docs/glossary.md`
- Modify: `docs/architecture.md`
- Modify: `README.md`

No tests — these are prose-only changes. Read each diff back after editing to confirm it reads correctly in context (don't just trust the substitution).

- [ ] **Step 1: `docs/spec.md` — node diff state bullet**

Find (around line 58):

```markdown
- `modified` — file exists in both branches but its outgoing import set changed
```

Replace with:

```markdown
- `modified` — file exists in both branches but its own content differs
```

- [ ] **Step 2: `docs/spec.md` — modification-detection paragraph**

Find (around line 67):

```markdown
Modification is detected at the import level, not at the file content level: a node is `modified` when any outgoing import was added or removed, or when the set of names imported over a persisting edge changed. A file that changed internally but whose imports did not change is `unchanged` in the diagram. See [architecture.md](./architecture.md) for the full diff algorithm.
```

Replace with:

```markdown
Node modification is detected at the file-content level: a node is `modified` when its own raw text differs between base and current branches, regardless of whether its imports changed. Edge modification is still detected at the import level (see edge diff states above) — node color and edge color are independent signals. See [architecture.md](./architecture.md) for the full diff algorithm.
```

- [ ] **Step 3: `docs/spec.md` — non-goals**

Find (around line 117):

```markdown
- **File content diff** — modification is detected by import-set change, not line-level content diff. Internal-only changes (refactors that don't add or remove imports) appear as `unchanged`.
```

Replace with:

```markdown
- **Change magnitude** — the tool detects *that* a file's content changed (node `modified` state), but not *how much*. Line-level diff statistics are not computed today; see "Change magnitude styling" under Planned.
```

- [ ] **Step 4: `docs/glossary.md` — diff state definition**

Find (around line 26):

```markdown
- `modified` — present in both but changed: a node whose outgoing imports changed, or an edge whose set of imported names changed
```

Replace with:

```markdown
- `modified` — present in both but changed: a node whose own content differs between branches, or an edge whose set of imported names changed
```

- [ ] **Step 5: `docs/architecture.md` — `GraphNode` type reference**

Find (around line 38):

```markdown
- `GraphNode` — `{ id, label, file, type: NodeType | 'stub', scope: NodeScope, diff: DiffState | null, typeOnly?: boolean, hasTests?: boolean, hasStories?: boolean }`
```

Replace with:

```markdown
- `GraphNode` — `{ id, label, file, type: NodeType | 'stub', scope: NodeScope, diff: DiffState | null, typeOnly?: boolean, hasTests?: boolean, hasStories?: boolean, _content?: string }` (`_content` is internal only — raw file text used by `diffGraphs` to detect content changes, stripped from `graph.json` before it's written)
```

- [ ] **Step 6: `docs/architecture.md` — `diffGraphs` algorithm description**

Find (around line 79):

```markdown
4. Current nodes in base → `diff: 'modified'` if any outgoing edge was added, removed, or changed its imported-name set, else `'unchanged'`
```

Replace with:

```markdown
4. Current nodes in base → `diff: 'modified'` if the node's `_content` differs from its base counterpart, else `'unchanged'`
```

- [ ] **Step 7: `README.md` — legend text**

Find (around line 22):

```markdown
| Amber border, dark amber fill | File modified in this PR (its imports changed) |
```

Replace with:

```markdown
| Amber border, dark amber fill | File modified in this PR (its content changed) |
```

- [ ] **Step 8: Stage the change**

```bash
git add docs/spec.md docs/glossary.md docs/architecture.md README.md
```

---

### Task 7: Final verification and the single commit

**Files:** none (verification + commit only).

- [ ] **Step 1: Run the full verification suite**

Run: `npm run verify`
Expected: PASS — build, biome check, all unit tests, all visual tests (visual tests should now pass since Task 5 approved the new snapshots).

- [ ] **Step 2: Smoke-test the CLI end to end (project Gate 2)**

Run:
```bash
node dist/cli.js --repo-root fake-angular-app --base-repo-root fake-angular-app-base src/app/features/users
```
Expected: exits 0, prints a summary line ending in something like `Diff: 2 added, 4 modified, 1 removed` (one more `modified` than before this change — `user-table-header.component.ts`), and writes `dist/diagram.svg`, `dist/diagram.html`, `dist/graph.json`.

- [ ] **Step 3: Confirm `graph.json` has no leaked internal field**

Run: `grep -c "_content" dist/graph.json`
Expected: `0` (grep exits non-zero / prints `0` — no matches).

- [ ] **Step 4: Review `dist/diagram.svg` visually**

Open `dist/diagram.svg`. Confirm `UserTableHeaderComponent` (in the `user-list` group) now renders with amber border/fill instead of grey, and that this is the only node whose color changed relative to before this branch's changes.

- [ ] **Step 5: Stage anything left and make the one commit**

```bash
git status
git add -A
git commit -m "$(cat <<'EOF'
Make node diff state reflect file content, not import changes

Node color now answers "did this file's own content change" —
symmetric with added/removed, which are already file-level facts —
instead of being a proxy computed from the node's outgoing edges.
Edge diff state (arrow color) is untouched and still reflects
import-set changes. Fixes #41.

Includes a new fixture case (user-table-header.component.ts) with
unchanged imports but a changed template body, proving the previous
logic missed this case; its node color flips from unchanged-grey to
modified-amber, so the visual snapshots for fake-angular-app were
regenerated via `npm run test:visual:approve` and are included here
for review.
EOF
)"
```

- [ ] **Step 6: Confirm clean status**

Run: `git status`
Expected: `nothing to commit, working tree clean`, and exactly one commit ahead of `origin/main` (`git log origin/main..HEAD --oneline` shows one line).

**When opening the PR:** call out in the PR body that `fake-angular-app`'s visual snapshots were regenerated and why (per `CLAUDE.md`'s rule on intentional rendering changes) — reviewers should look at the new snapshot images, not just the code diff.
