# Clustered view mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third view mode, "Clustered," that shows only directories (up to 2 levels deep) and aggregated import edges between them, colored by dominant diff state, for high-level orientation on features with many files.

**Architecture:** A new `computeViewNodes(graph, "clustered")` branch in `src/renderer/graph-helpers.ts` collapses every in-scope subdirectory (and out-of-scope parent directory) into one synthetic `GraphNode` per directory. A new `computeClusteredLayout` in `src/renderer/layout.ts` lays these out using the same ELK compound/hierarchical-layout technique the existing subdirectory-grouping feature uses, but where each directory node's own ELK node IS the rendered, colored box (not a wrapper around something else) — a level-1 directory with a level-2 child becomes a compound node containing that one child; everything else needs zero rendering changes, because `src/renderer/draw.ts` and `src/renderer.html` already render any `Layout`/`GraphNode` pair generically.

**Tech Stack:** TypeScript, elkjs (ELK compound/hierarchical layout), Vitest.

## Global Constraints

- Directory nesting is capped at exactly 2 levels, same cap used throughout this codebase. A file 3+ directories deep folds into its level-2 directory node.
- A directory node's `diff` is the *dominant* state among every real file it represents (added > removed > modified > unchanged priority) — reuse `graph-helpers.ts`'s existing `diffPriority`, exported rather than duplicated.
- Files directly at the feature root (no subdirectory) stay as individual real nodes, unchanged from the other two modes.
- Out-of-scope nodes collapse to one flat node per immediate parent directory (`path.dirname`), no second level.
- This repo requires exactly one commit per PR — all steps below land in a single commit at the end.
- `npm run verify` (build + lint + unit tests + visual tests + sample drift check) must pass before this is done. Never use `--no-verify`.
- Design reference: `docs/superpowers/specs/2026-08-07-clustered-view-design.md`.

---

## File Structure

- **Modify `src/types.ts`** — `GraphNode.type` gains `"directory"`.
- **Modify `src/renderer/graph-helpers.ts`** — export `diffPriority`; add a `"clustered"` mode producing synthetic directory nodes and aggregated edges.
- **Modify `src/renderer/graph-helpers.test.ts`** — tests for the new mode.
- **Modify `src/renderer/layout.ts`** — add `computeClusteredLayout`.
- **Modify `src/renderer/layout.test.ts`** — tests for the new function.
- **Modify `src/cli.ts`** — wire the third mode: compute it, write `diagram-clustered.svg`, embed it in `diagram.html`.
- **Modify `src/cli.test.ts`** — a couple of integration tests for the new output.
- **Modify `src/renderer.html`** — one new mode-toggle button (no rendering-logic changes — `renderSvg`/`draw` already index generically into `DIFF_DIAGRAM.modes[mode]`).
- **Modify `package.json`** — `docs:sample:generate` / `docs:sample:check-drift` gain the third sample file.
- **Modify `README.md`, `docs/architecture.md`, `docs/spec.md`** — document the new mode; move `docs/spec.md`'s "Clustered view mode" bullet out of Planned.
- **Regenerate `docs/sample-diff.svg`, `docs/sample-all.svg`, `docs/sample-clustered.svg` (new), `test/snapshots/reference/*.png`.**

---

### Task 1: Clustered view mode

**Files:** see File Structure above.

**Interfaces:**
- Produces: `computeViewNodes(graph, "clustered"): { nodes: GraphNode[]; edges: GraphEdge[] }` (extends the existing function's mode union). `computeClusteredLayout(nodes, edges, sourceRoot, scopeDir): Promise<Layout>` (same `Layout` return type `computeLayout` already uses — `{ nodes, edges, width, height }`, no `container`/`subdirContainers` needed beyond an optional `container` for the outer feature box).
- Consumes: `diffPriority` (newly exported from `graph-helpers.ts`), `dedupeId`/`sanitize`-style id disambiguation already used for stub ids, `nodeDims` (unchanged, already used by `computeLayout`).

#### Part A — `types.ts`

- [ ] **Step 1: Add the `"directory"` node type**

  In `src/types.ts`, change:
  ```ts
  	type: NodeType | "stub";
  ```
  to:
  ```ts
  	type: NodeType | "stub" | "directory";
  ```

#### Part B — `graph-helpers.ts`: synthetic directory nodes

- [ ] **Step 2: Write the failing tests in `src/renderer/graph-helpers.test.ts`**

  Add near the top, alongside the existing `node`/`edge`/`makeGraph` helpers (after line 36):
  ```ts
  function nodeAt(
  	id: string,
  	file: string,
  	diff: GraphNode["diff"] = "unchanged",
  	scope: GraphNode["scope"] = "in-scope",
  ): GraphNode {
  	return { id, label: id, file, type: "component", scope, diff };
  }
  ```

  Then add a new describe block at the end of the file:
  ```ts
  // ─── 'clustered' mode ───────────────────────────────────────────────────────

  describe("computeViewNodes 'clustered' mode", () => {
  	it("collapses a first-level subdirectory to one directory node", () => {
  		const a = nodeAt("a", `${SCOPE}/data-access/a.ts`);
  		const b = nodeAt("b", `${SCOPE}/data-access/b.ts`);
  		const g = makeGraph([a, b], [edge("a", "b")]);
  		const { nodes, edges } = computeViewNodes(g, "clustered");
  		const dirNodes = nodes.filter((n) => n.type === "directory");
  		expect(dirNodes).toHaveLength(1);
  		expect(dirNodes[0].label).toBe("data-access");
  		expect(edges).toHaveLength(0); // both endpoints collapse to the same node
  	});

  	it("nests a second-level subdirectory inside its first-level directory node, distinctly", () => {
  		const direct = nodeAt("direct", `${SCOPE}/data-access/direct.ts`);
  		const nested = nodeAt("nested", `${SCOPE}/data-access/store/nested.ts`);
  		const g = makeGraph([direct, nested]);
  		const { nodes } = computeViewNodes(g, "clustered");
  		const dirNodes = nodes.filter((n) => n.type === "directory");
  		const labels = dirNodes.map((n) => n.label).sort();
  		expect(labels).toEqual(["data-access", "store"]);
  	});

  	it("collapses a file three or more directories deep into its second-level directory node", () => {
  		const shallow = nodeAt("shallow", `${SCOPE}/data-access/store/shallow.ts`);
  		const deep = nodeAt("deep", `${SCOPE}/data-access/store/extra/deep.ts`);
  		const g = makeGraph([shallow, deep]);
  		const { nodes } = computeViewNodes(g, "clustered");
  		const dirNodes = nodes.filter((n) => n.type === "directory");
  		expect(dirNodes.map((n) => n.label).sort()).toEqual([
  			"data-access",
  			"store",
  		]);
  	});

  	it("leaves a root-level file as an individual node", () => {
  		const root = nodeAt("root", `${SCOPE}/root.ts`);
  		const g = makeGraph([root]);
  		const { nodes } = computeViewNodes(g, "clustered");
  		expect(nodes).toHaveLength(1);
  		expect(nodes[0]).toEqual(root);
  	});

  	it("colors a directory node by the dominant diff state among its members", () => {
  		const unchanged1 = nodeAt("u1", `${SCOPE}/widgets/u1.ts`, "unchanged");
  		const added = nodeAt("a1", `${SCOPE}/widgets/a1.ts`, "added");
  		const modified = nodeAt("m1", `${SCOPE}/widgets/m1.ts`, "modified");
  		const g = makeGraph([unchanged1, added, modified]);
  		const { nodes } = computeViewNodes(g, "clustered");
  		const widgets = nodes.find((n) => n.label === "widgets");
  		expect(widgets?.diff).toBe("added"); // added (3) beats modified (1) beats unchanged (0)
  	});

  	it("a level1 directory's dominant color reflects its level2 child's members too, even with no direct files of its own", () => {
  		const nested = nodeAt(
  			"nested",
  			`${SCOPE}/data-access/store/nested.ts`,
  			"added",
  		);
  		const g = makeGraph([nested]);
  		const { nodes } = computeViewNodes(g, "clustered");
  		const dataAccess = nodes.find((n) => n.label === "data-access");
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
  		const { nodes, edges } = computeViewNodes(g, "clustered");
  		const oosDirNodes = nodes.filter((n) => n.scope === "out-of-scope");
  		expect(oosDirNodes).toHaveLength(1);
  		expect(oosDirNodes[0].label).toBe("services");
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
  		const { edges } = computeViewNodes(g, "clustered");
  		expect(edges).toHaveLength(1);
  		expect(edges[0].diff).toBe("added");
  	});

  	it("keeps directory node ids distinct when two first-level directories share a second-level directory name", () => {
  		const a = nodeAt("a", `${SCOPE}/sub-one/utils/a.ts`);
  		const b = nodeAt("b", `${SCOPE}/sub-two/utils/b.ts`);
  		const g = makeGraph([a, b]);
  		const { nodes } = computeViewNodes(g, "clustered");
  		const utilsNodes = nodes.filter((n) => n.label === "utils");
  		expect(utilsNodes).toHaveLength(2);
  		expect(utilsNodes[0].id).not.toBe(utilsNodes[1].id);
  	});
  });
  ```

- [ ] **Step 3: Run the test file and confirm the expected failures**

  Run: `npx vitest run src/renderer/graph-helpers.test.ts`
  Expected: the new "clustered" tests FAIL (mode not implemented yet — `computeViewNodes` currently only handles `"all"` and falls through to diff-focused logic for anything else, so these assertions won't match). All pre-existing tests still PASS.

- [ ] **Step 4: Export and loosen `diffPriority`**

  In `src/renderer/graph-helpers.ts`, add `DiffState` to the type import:
  ```ts
  import type { Graph, GraphEdge, GraphNode } from "../types.js";
  ```
  becomes:
  ```ts
  import type { DiffState, Graph, GraphEdge, GraphNode } from "../types.js";
  ```

  Replace:
  ```ts
  function diffPriority(diff: GraphEdge["diff"]): number {
  	return diff ? DIFF_PRIORITY[diff] : 0;
  }
  ```
  with:
  ```ts
  export function diffPriority(diff: DiffState | null | undefined): number {
  	return diff ? DIFF_PRIORITY[diff] : 0;
  }
  ```

- [ ] **Step 5: Extend `computeViewNodes`'s mode union and dispatch to the new function**

  Replace:
  ```ts
  export function computeViewNodes(
  	graph: Graph,
  	mode: "all" | "diff-focused",
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
  	if (mode === "all") {
  		return { nodes: graph.nodes, edges: graph.edges };
  	}

  	const scopeDir = graph.meta.scopeDir; // repo-relative, e.g. "src/app/features/users"
  ```
  with:
  ```ts
  export function computeViewNodes(
  	graph: Graph,
  	mode: "all" | "diff-focused" | "clustered",
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
  	if (mode === "all") {
  		return { nodes: graph.nodes, edges: graph.edges };
  	}
  	if (mode === "clustered") {
  		return computeClusteredNodes(graph);
  	}

  	const scopeDir = graph.meta.scopeDir; // repo-relative, e.g. "src/app/features/users"
  ```

- [ ] **Step 6: Implement `computeClusteredNodes`**

  Add this new function right after `computeViewNodes` (before the `// ─── Helpers ──` divider):
  ```ts
  // ─── 'clustered' mode ───────────────────────────────────────────────────────
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
  		outputNodes.push(makeDirNode(oosId, path.basename(dir), dir, "out-of-scope", members));
  		for (const n of members) collapsedMap.set(n.id, oosId);
  	}

  	// ── Remap edges, dedup keeping the highest-priority diff state ───────────
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

  function makeDirNode(
  	id: string,
  	label: string,
  	file: string,
  	scope: "in-scope" | "out-of-scope",
  	members: GraphNode[],
  ): GraphNode {
  	const dominant = members.reduce<DiffState>((best, n) => {
  		return diffPriority(n.diff) > diffPriority(best) ? (n.diff ?? "unchanged") : best;
  	}, "unchanged");
  	return { id, label, file, type: "directory", scope, diff: dominant };
  }
  ```

  Note: `allUnder.filter(...)` twice (once for the level1 push, once inside the level2 loop) is intentional — the level1 node's `allUnder` list is captured once per level1, and level2 filtering happens over that same list, not re-querying `inScopeNodes`.

- [ ] **Step 7: Run the test file and confirm everything passes**

  Run: `npx vitest run src/renderer/graph-helpers.test.ts`
  Expected: all tests PASS.

- [ ] **Step 8: Run the full unit test suite**

  Run: `npm test`
  Expected: all test files PASS (nothing outside `graph-helpers.ts`/`.test.ts` changed yet).

#### Part C — `layout.ts`: `computeClusteredLayout`

- [ ] **Step 9: Write the failing tests in `src/renderer/layout.test.ts`**

  Add near the top, reusing the file's existing `nodeInDir`/`edge`/`within` helpers (already defined for the subdirectory-grouping tests), a new describe block at the end of the file:
  ```ts
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
  		const store = dirNode(
  			"store",
  			"store",
  			`${scopeDir}/data-access/store`,
  		);
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

  	it("routes an edge from a level1 directory node to its own level2 child", async () => {
  		// Regression case: a real file directly in data-access/ importing a
  		// file in data-access/store/ collapses to exactly this edge shape —
  		// one endpoint IS the compound parent of the other. Unlike a sibling
  		// edge, this is new territory for this codebase's ELK usage (the
  		// existing subdirectory-grouping boxes never have a real graph edge
  		// declared on the wrapper node itself), so this must be verified
  		// empirically, not assumed.
  		const dataAccess = dirNode(
  			"data-access",
  			"data-access",
  			`${scopeDir}/data-access`,
  		);
  		const store = dirNode("store", "store", `${scopeDir}/data-access/store`);
  		const layout = await computeClusteredLayout(
  			[dataAccess, store],
  			[{ from: "data-access", to: "store", kind: "import" }],
  			"src/app",
  			scopeDir,
  		);
  		expect(layout.edges).toHaveLength(1);
  		expect(layout.edges[0].sections.length).toBeGreaterThan(0);
  	});

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
  ```

  This file's top-level imports need `computeClusteredLayout` added to the existing `import { computeLayout } from "./layout.js";` line (`import { computeClusteredLayout, computeLayout } from "./layout.js";`).

- [ ] **Step 10: Run the test file and confirm the expected failures**

  Run: `npx vitest run src/renderer/layout.test.ts`
  Expected: FAILS to even compile/run (`computeClusteredLayout` doesn't exist yet) — that's the expected RED state.

- [ ] **Step 11: Implement `computeClusteredLayout`**

  Add this new exported function to `src/renderer/layout.ts`, after `computeLayout`:
  ```ts
  // ─── computeClusteredLayout ───────────────────────────────────────────────────
  // Lays out the synthetic directory-node graph produced by
  // computeViewNodes(graph, "clustered") (src/renderer/graph-helpers.ts).
  // Unlike computeLayout's scopeDir grouping, where a subdir box is an outline
  // *wrapper* around real leaf files, here each directory node IS the rendered
  // content: a level1 node's own ELK node becomes a compound node containing
  // its level2 child (if one exists), rather than a separate wrapper around
  // it. This still reuses the same structural-nesting technique (real ELK
  // compound/hierarchical layout, INCLUDE_CHILDREN) computeLayout uses, for
  // the same reason: non-overlap and correct edge routing are structural
  // guarantees, not inferred from post-layout positions. See
  // docs/superpowers/specs/2026-08-07-clustered-view-design.md.

  export async function computeClusteredLayout(
  	nodes: GraphNode[],
  	edges: GraphEdge[],
  	sourceRoot: string,
  	scopeDir: string,
  ): Promise<Layout> {
  	const elk = new ELKClass();

  	const inScopeNodes = nodes.filter(
  		(n) => n.scope === "in-scope" || n.scope === "removed-ghost",
  	);
  	const oosNodes = nodes.filter((n) => n.scope === "out-of-scope");
  	const usePartitions = inScopeNodes.length > 0 && oosNodes.length > 0;
  	const showContainer = inScopeNodes.length > 0;

  	// Each in-scope node's own path depth under scopeDir. A directory node's
  	// `.file` is the directory's own path (set by computeClusteredNodes), so a
  	// node whose relative path is 1 segment IS a level1 directory (or a real
  	// root-level file — both are plain leaves unless something nests under
  	// them), and a node whose relative path is 2 segments is a level2 child
  	// that nests inside whichever level1 node shares its first segment.
  	const segmentsOf = new Map<string, string[]>();
  	for (const n of inScopeNodes) {
  		segmentsOf.set(n.id, path.relative(scopeDir, n.file).split(path.sep));
  	}

  	const level2ChildByLevel1Segment = new Map<string, GraphNode>();
  	for (const n of inScopeNodes) {
  		const parts = segmentsOf.get(n.id) ?? [];
  		if (parts.length === 2) level2ChildByLevel1Segment.set(parts[0], n);
  	}
  	const level2NodeIds = new Set(
  		[...level2ChildByLevel1Segment.values()].map((n) => n.id),
  	);
  	const level1ParentOf = new Map<string, string>(); // level2 node id -> level1 node id
  	for (const n of inScopeNodes) {
  		const parts = segmentsOf.get(n.id) ?? [];
  		if (parts.length === 1) {
  			const child = level2ChildByLevel1Segment.get(parts[0]);
  			if (child) level1ParentOf.set(child.id, n.id);
  		}
  	}

  	function leafElkNode(n: GraphNode): ElkNode {
  		return {
  			id: n.id,
  			...nodeDims(n, sourceRoot),
  			...(usePartitions
  				? {
  						layoutOptions: {
  							"elk.partitioning.partition":
  								n.scope === "out-of-scope" ? "1" : "0",
  						},
  					}
  				: {}),
  		};
  	}

  	// Top-level ELK children: real root-level files and level1 directory
  	// nodes (compound if they have a level2 child, otherwise a plain leaf via
  	// leafElkNode), plus oos directory nodes. Level2 nodes are never
  	// top-level — they're always the sole child of their level1 node.
  	const topLevel = inScopeNodes.filter((n) => !level2NodeIds.has(n.id));
  	const level1Children: ElkNode[] = topLevel.map((n) => {
  		const parts = segmentsOf.get(n.id) ?? [];
  		const level2Child =
  			parts.length === 1 ? level2ChildByLevel1Segment.get(parts[0]) : undefined;
  		if (!level2Child) return leafElkNode(n);
  		return {
  			id: n.id,
  			layoutOptions: {
  				"elk.algorithm": "layered",
  				"elk.direction": "RIGHT",
  				"elk.spacing.nodeNode": "20",
  				"elk.layered.spacing.nodeNodeBetweenLayers": "40",
  				// Top reserves room for this node's own label, drawn the same
  				// way any other node's label is; the nested level2 child sits
  				// in the remaining space below it.
  				"elk.padding": "[top=28, left=8, bottom=8, right=8]",
  				...(usePartitions ? { "elk.partitioning.partition": "0" } : {}),
  			},
  			children: [leafElkNode(level2Child)],
  			edges: [],
  		};
  	});

  	// Deduplicate edges, then route: an edge between a level1 node and its own
  	// level2 child is declared on the level1 node's own `edges` array (the
  	// LCA of a node and its own child is the node itself); every other edge
  	// goes on the root graph, relying on elk.hierarchyHandling:
  	// INCLUDE_CHILDREN to route it regardless of nesting depth, same as
  	// computeLayout already does for cross-hierarchy edges.
  	type ElkEdgeInput = { id: string; sources: string[]; targets: string[] };
  	const seen = new Set<string>();
  	const rootEdges: ElkEdgeInput[] = [];
  	const level1OwnEdges = new Map<string, ElkEdgeInput[]>();
  	edges.forEach((e, i) => {
  		const key = `${e.from}→${e.to}`;
  		if (seen.has(key)) return;
  		seen.add(key);
  		const elkEdge: ElkEdgeInput = {
  			id: `e${i}`,
  			sources: [e.from],
  			targets: [e.to],
  		};
  		const fromIsParentOfTo = level1ParentOf.get(e.to) === e.from;
  		const toIsParentOfFrom = level1ParentOf.get(e.from) === e.to;
  		if (fromIsParentOfTo || toIsParentOfFrom) {
  			const level1Id = fromIsParentOfTo ? e.from : e.to;
  			if (!level1OwnEdges.has(level1Id)) level1OwnEdges.set(level1Id, []);
  			level1OwnEdges.get(level1Id)?.push(elkEdge);
  		} else {
  			rootEdges.push(elkEdge);
  		}
  	});
  	for (const child of level1Children) {
  		const ownEdges = level1OwnEdges.get(child.id);
  		if (ownEdges) child.edges = ownEdges;
  	}

  	const graph: ElkNode = {
  		id: "root",
  		layoutOptions: {
  			"elk.algorithm": "layered",
  			"elk.direction": "RIGHT",
  			...(usePartitions ? { "elk.partitioning.activate": "true" } : {}),
  			"elk.spacing.nodeNode": "20",
  			"elk.layered.spacing.nodeNodeBetweenLayers": "40",
  			"elk.padding": showContainer
  				? "[top=55, left=40, bottom=35, right=35]"
  				: "[top=20, left=20, bottom=20, right=20]",
  			"elk.hierarchyHandling": "INCLUDE_CHILDREN",
  		},
  		children: [...level1Children, ...oosNodes.map(leafElkNode)],
  		edges: rootEdges,
  	};

  	const result = await elk.layout(graph);

  	// Every ELK child (compound or leaf) is a real, rendered LayoutNode here —
  	// unlike computeLayout, there's no separate "wrapper vs real content"
  	// distinction. Parents are pushed before their children, so array order
  	// alone gives the correct draw order (outer box first, nested box drawn
  	// on top of it).
  	const layoutNodes: LayoutNode[] = [];
  	const layoutEdges: LayoutEdge[] = [];

  	function walk(node: ElkNode, offsetX: number, offsetY: number): void {
  		for (const child of node.children ?? []) {
  			const absX = offsetX + (child.x ?? 0);
  			const absY = offsetY + (child.y ?? 0);
  			layoutNodes.push({
  				id: child.id,
  				x: absX,
  				y: absY,
  				width: child.width ?? MIN_NODE_WIDTH,
  				height: child.height ?? NODE_HEIGHT,
  			});
  			if (child.children && child.children.length > 0) {
  				walk(child, absX, absY);
  			}
  		}
  		for (const e of node.edges ?? []) {
  			const ext = e as ElkExtendedEdge & {
  				sources?: string[];
  				targets?: string[];
  			};
  			const from = ext.sources?.[0] ?? "";
  			const to = ext.targets?.[0] ?? "";
  			const sections: LayoutEdgeSection[] = (ext.sections ?? []).map((s) => ({
  				startPoint: {
  					x: s.startPoint.x + offsetX,
  					y: s.startPoint.y + offsetY,
  				},
  				endPoint: { x: s.endPoint.x + offsetX, y: s.endPoint.y + offsetY },
  				...(s.bendPoints
  					? {
  							bendPoints: s.bendPoints.map((bp) => ({
  								x: bp.x + offsetX,
  								y: bp.y + offsetY,
  							})),
  						}
  					: {}),
  			}));
  			layoutEdges.push({ from, to, sections });
  		}
  	}
  	walk(result, 0, 0);

  	let container: LayoutContainer | undefined;
  	if (showContainer) {
  		const inScopeIds = new Set(inScopeNodes.map((n) => n.id));
  		const inScopeLayout = layoutNodes.filter((n) => inScopeIds.has(n.id));
  		if (inScopeLayout.length > 0) {
  			const PAD = 15;
  			const LABEL_H = 20;
  			const minX = Math.min(...inScopeLayout.map((n) => n.x));
  			const minY = Math.min(...inScopeLayout.map((n) => n.y));
  			const maxX = Math.max(...inScopeLayout.map((n) => n.x + n.width));
  			const maxY = Math.max(...inScopeLayout.map((n) => n.y + n.height));
  			container = {
  				x: minX - PAD,
  				y: minY - PAD - LABEL_H,
  				width: maxX - minX + PAD * 2,
  				height: maxY - minY + PAD * 2 + LABEL_H,
  			};
  		}
  	}

  	return {
  		nodes: layoutNodes,
  		edges: layoutEdges,
  		width: result.width ?? 0,
  		height: result.height ?? 0,
  		container,
  	};
  }
  ```

- [ ] **Step 12: Run the test file; if the level1-to-own-child edge test fails, apply the documented fallback**

  Run: `npx vitest run src/renderer/layout.test.ts`

  Expected: all tests PASS, including "routes an edge from a level1 directory node to its own level2 child."

  If — and only if — that specific test fails with `sections.length === 0` (ELK silently drops the edge, the same failure mode `computeLayout`'s own regression test comments warn about for cross-hierarchy edges): the fallback is to declare that edge on the **root** graph's `edges` array instead of the level1 node's own array. Change the routing condition from populating `level1OwnEdges` to simply pushing into `rootEdges` in both branches (`fromIsParentOfTo || toIsParentOfFrom`), i.e. delete the `level1OwnEdges`-related code and let every edge go through `rootEdges` unconditionally. Re-run the test to confirm. Record which approach actually worked in the step 15 commit message / PR description, since this is a genuinely new ELK usage pattern for this codebase (the existing subdirectory-grouping boxes never have a real graph edge declared on the wrapper node itself).

- [ ] **Step 13: Run the full unit test suite**

  Run: `npm test`
  Expected: all test files PASS.

#### Part D — wire into `cli.ts` and `renderer.html`

- [ ] **Step 14: Wire the third mode into `cli.ts`**

  Change the import:
  ```ts
  import type { Layout } from "./renderer/layout.js";
  import { computeLayout } from "./renderer/layout.js";
  ```
  to:
  ```ts
  import type { Layout } from "./renderer/layout.js";
  import { computeClusteredLayout, computeLayout } from "./renderer/layout.js";
  ```

  Change `DiagramData`:
  ```ts
  interface DiagramData {
  	meta: Omit<Graph["meta"], "repoRoot">;
  	sourceRoot: string;
  	initialMode?: "all" | "diffFocused";
  	modes: { all: ModeData; diffFocused: ModeData };
  }
  ```
  to:
  ```ts
  interface DiagramData {
  	meta: Omit<Graph["meta"], "repoRoot">;
  	sourceRoot: string;
  	initialMode?: "all" | "diffFocused" | "clustered";
  	modes: { all: ModeData; diffFocused: ModeData; clustered: ModeData };
  }
  ```

  Change the layout computation block:
  ```ts
  	// Compute layouts for both view modes in parallel
  	console.log("Computing layouts...");
  	const allView = computeViewNodes(diffed, "all");
  	const diffView = computeViewNodes(diffed, "diff-focused");

  	const [allLayout, diffLayout] = await Promise.all([
  		computeLayout(
  			allView.nodes,
  			allView.edges,
  			args.sourceRoot,
  			diffed.meta.scopeDir,
  		),
  		computeLayout(
  			diffView.nodes,
  			diffView.edges,
  			args.sourceRoot,
  			diffed.meta.scopeDir,
  		),
  	]);
  ```
  to:
  ```ts
  	// Compute layouts for all three view modes in parallel
  	console.log("Computing layouts...");
  	const allView = computeViewNodes(diffed, "all");
  	const diffView = computeViewNodes(diffed, "diff-focused");
  	const clusteredView = computeViewNodes(diffed, "clustered");

  	const [allLayout, diffLayout, clusteredLayout] = await Promise.all([
  		computeLayout(
  			allView.nodes,
  			allView.edges,
  			args.sourceRoot,
  			diffed.meta.scopeDir,
  		),
  		computeLayout(
  			diffView.nodes,
  			diffView.edges,
  			args.sourceRoot,
  			diffed.meta.scopeDir,
  		),
  		computeClusteredLayout(
  			clusteredView.nodes,
  			clusteredView.edges,
  			args.sourceRoot,
  			diffed.meta.scopeDir,
  		),
  	]);
  ```

  Add a new file-write block right after the existing `diagram-all.svg` block (after its `console.log(\`Wrote ${allSvgPath}\`);` line), before the `diagram-diff.svg` conditional block:
  ```ts
  	// diagram-clustered.svg — directory-only zoomed-out view. Always written,
  	// same as diagram-all.svg: dominant-diff-state coloring per directory is
  	// still meaningful (all "unchanged") even without a base to diff against.
  	const clusteredSvg = toSvg(
  		clusteredLayout,
  		clusteredView.nodes,
  		clusteredView.edges,
  		path.basename(scopeDir),
  		args.sourceRoot,
  	);
  	const clusteredSvgPath = path.join(outDir, "diagram-clustered.svg");
  	await writeFile(clusteredSvgPath, clusteredSvg);
  	console.log(`Wrote ${clusteredSvgPath}`);
  ```

  Add `clustered` to the `modes` object in the `DiagramData` construction:
  ```ts
  		modes: {
  			all: buildModeData(allView.nodes, allView.edges, allLayout),
  			diffFocused: buildModeData(diffView.nodes, diffView.edges, diffLayout),
  		},
  ```
  becomes:
  ```ts
  		modes: {
  			all: buildModeData(allView.nodes, allView.edges, allLayout),
  			diffFocused: buildModeData(diffView.nodes, diffView.edges, diffLayout),
  			clustered: buildModeData(
  				clusteredView.nodes,
  				clusteredView.edges,
  				clusteredLayout,
  			),
  		},
  ```

- [ ] **Step 15: Add the third toggle button to `renderer.html`**

  In `src/renderer.html`, change:
  ```html
      <div class="mode-group">
        <button type="button" class="mode-btn" data-mode="all">All nodes</button>
        <button type="button" class="mode-btn" data-mode="diffFocused">Diff-focused</button>
      </div>
  ```
  to:
  ```html
      <div class="mode-group">
        <button type="button" class="mode-btn" data-mode="all">All nodes</button>
        <button type="button" class="mode-btn" data-mode="diffFocused">Diff-focused</button>
        <button type="button" class="mode-btn" data-mode="clustered">Clustered</button>
      </div>
  ```
  No other changes to this file: `renderSvg(mode)` and `draw()` already index generically into `DIFF_DIAGRAM.modes[mode]` and `nodeFill`/`nodeStroke` already handle any `GraphNode` shape via the existing diff-color path (a `"directory"`-typed node isn't `'stub'` or `out-of-scope`-only-styled, so it flows through the same fallback as a normal in-scope node).

- [ ] **Step 16: Write and run integration tests in `src/cli.test.ts`**

  Add a new describe block after the existing `"cli subdirectory grouping"` block, following that block's existing pattern (`writeFixtureFile`, `runCli`, a shared `beforeAll`/`afterAll` tmp dir):
  ```ts
  // ─── clustered view mode ───────────────────────────────────────────────────────

  describe("cli clustered view mode", () => {
  	let tmp: string;
  	let repoRoot: string;

  	beforeAll(async () => {
  		tmp = mkdtempSync(path.join(tmpdir(), "dd-cli-clustered-"));
  		repoRoot = path.join(tmp, "repo");
  		await writeFixtureFile(
  			path.join(repoRoot, "src/app/features/f/widgets/alpha.component.ts"),
  			"export const alpha = 1;\n",
  		);
  		await writeFixtureFile(
  			path.join(
  				repoRoot,
  				"src/app/features/f/data-access/store/action.ts",
  			),
  			"export const action = 1;\n",
  		);
  	}, 30_000);

  	afterAll(() => {
  		rmSync(tmp, { recursive: true, force: true });
  	});

  	it("writes diagram-clustered.svg with one box per directory, nested up to 2 levels", async () => {
  		const outDir = path.join(tmp, "out");
  		const result = await runCli([
  			"--repo-root",
  			repoRoot,
  			"--out-dir",
  			outDir,
  			"src/app/features/f",
  		]);
  		expect(result.code).toBe(0);

  		const svg = await readFile(
  			path.join(outDir, "diagram-clustered.svg"),
  			"utf8",
  		);
  		expect(svg).toContain(">widgets<");
  		expect(svg).toContain(">data-access<");
  		expect(svg).toContain(">store<");
  		// Individual file labels must not appear — this view is directory-only.
  		expect(svg).not.toContain(">alpha<");
  		expect(svg).not.toContain(">action<");
  	}, 30_000);

  	it("diagram.html embeds a clustered mode with directory-typed nodes", async () => {
  		const html = await readFile(path.join(tmp, "out/diagram.html"), "utf8");
  		expect(html).toContain('"clustered"');
  		expect(html).toContain('"type":"directory"');
  	}, 30_000);
  });
  ```

  Run: `npx vitest run src/cli.test.ts`
  Expected: all tests PASS (including the 2 new ones).

- [ ] **Step 17: Run the full unit test suite again**

  Run: `npm test`
  Expected: all test files PASS.

#### Part E — sample fixture, docs, visual regen, verify, commit

- [ ] **Step 18: Extend the sample scripts in `package.json`**

  Replace:
  ```json
  		"docs:sample:generate": "npm run diagram:sample && cp dist/diagram-diff.svg docs/sample-diff.svg && cp dist/diagram-all.svg docs/sample-all.svg",
  		"docs:sample:check-drift": "node dist/cli.js --repo-root sample-app --base-repo-root sample-app-base --out-dir dist/sample-check src/app/features/dashboard && (diff docs/sample-diff.svg dist/sample-check/diagram-diff.svg && diff docs/sample-all.svg dist/sample-check/diagram-all.svg || (echo 'docs/sample-*.svg is stale — run npm run docs:sample:generate and commit the result' >&2 && exit 1))",
  ```
  with:
  ```json
  		"docs:sample:generate": "npm run diagram:sample && cp dist/diagram-diff.svg docs/sample-diff.svg && cp dist/diagram-all.svg docs/sample-all.svg && cp dist/diagram-clustered.svg docs/sample-clustered.svg",
  		"docs:sample:check-drift": "node dist/cli.js --repo-root sample-app --base-repo-root sample-app-base --out-dir dist/sample-check src/app/features/dashboard && (diff docs/sample-diff.svg dist/sample-check/diagram-diff.svg && diff docs/sample-all.svg dist/sample-check/diagram-all.svg && diff docs/sample-clustered.svg dist/sample-check/diagram-clustered.svg || (echo 'docs/sample-*.svg is stale — run npm run docs:sample:generate and commit the result' >&2 && exit 1))",
  ```

- [ ] **Step 19: Build and generate the new sample SVG**

  Run: `npm run build && npm run docs:sample:generate`
  Expected: exits 0, creates `docs/sample-clustered.svg` (new) and rewrites `docs/sample-diff.svg`/`docs/sample-all.svg` (unchanged content, since this task added no new rendering code — but re-running keeps them byte-identical, which the drift check will confirm). Visually open `docs/sample-clustered.svg` and confirm: `widgets` renders as a plain box, `settings` renders as a box with a nested `preferences` box inside it, `layout` renders as its own box (this mode ignores diff-focused stub collapsing, so `layout` is NOT a stub here even though it's fully unchanged), and at least one directory box is visibly colored non-neutral (added/modified) reflecting the fixture's real changes.

- [ ] **Step 20: Update visual regression snapshots**

  Run: `npm run test:visual`
  Expected: This task added no changes to `draw.ts` or `renderer.html`'s existing rendering paths for the `all`/`diffFocused` modes, so the existing snapshots should still PASS unchanged. If they unexpectedly fail, investigate before proceeding — do not blindly approve.

- [ ] **Step 21: Update `README.md`**

  Replace the "What it produces" table (around line 7-12):
  ```
  | File | Purpose |
  |---|---|
  | `dist/diagram-diff.svg` | Diff-focused graph (paste as image in PR comment); written only when `--base-repo-root` is given |
  | `dist/diagram-all.svg` | All-nodes graph, same diff coloring, no collapsing |
  | `dist/diagram.html` | Interactive diagram with mode switching and hover highlights |
  | `dist/graph.json` | Full diffed graph JSON for downstream tooling |
  ```
  with:
  ```
  | File | Purpose |
  |---|---|
  | `dist/diagram-diff.svg` | Diff-focused graph (paste as image in PR comment); written only when `--base-repo-root` is given |
  | `dist/diagram-all.svg` | All-nodes graph, same diff coloring, no collapsing |
  | `dist/diagram-clustered.svg` | Directory-only zoomed-out graph — one box per subdirectory (up to 2 levels deep), colored by dominant diff state |
  | `dist/diagram.html` | Interactive diagram with mode switching and hover highlights |
  | `dist/graph.json` | Full diffed graph JSON for downstream tooling |
  ```

  Replace the "Reading the diagram" intro paragraph and image embeds:
  ```
  The tool renders two view modes from the same diff. **Diff-focused** is the primary review artifact: changed areas are expanded, unchanged areas collapse into stub nodes so the diagram stays small on large features. **All-nodes** shows every file individually with the same diff coloring — useful for seeing the full architecture at once.

  ![Sample diagram, diff-focused view](docs/sample-diff.svg)

  ![Sample diagram, all-nodes view](docs/sample-all.svg)
  ```
  with:
  ```
  The tool renders three view modes from the same diff. **Diff-focused** is the primary review artifact: changed areas are expanded, unchanged areas collapse into stub nodes so the diagram stays small on large features. **All-nodes** shows every file individually with the same diff coloring — useful for seeing the full architecture at once. **Clustered** zooms all the way out: every subdirectory (up to 2 levels deep) becomes one box, colored by the most significant change inside it — useful for orienting on a feature with many files before diving into the other two modes.

  ![Sample diagram, diff-focused view](docs/sample-diff.svg)

  ![Sample diagram, all-nodes view](docs/sample-all.svg)

  ![Sample diagram, clustered view](docs/sample-clustered.svg)
  ```

- [ ] **Step 22: Update `docs/architecture.md`**

  After the existing "Subdirectory grouping" section (the paragraph ending in "...this applies uniformly regardless of how many hierarchy levels an edge crosses." plus its spec-doc pointer line), add a new subsection:
  ```
  **Clustered view mode (`computeViewNodes(graph, "clustered")` + `computeClusteredLayout`):** a third view mode, entirely separate from the diff-focused stub-collapsing above — it collapses every in-scope subdirectory (up to 2 levels deep, same cap) and every out-of-scope parent directory to one synthetic `GraphNode` (`type: "directory"`), regardless of diff state, for high-level orientation on features with many files. A directory node's `diff` is the dominant state among every real file it represents (added > removed > modified > unchanged priority, `graph-helpers.ts`'s exported `diffPriority`). `computeClusteredLayout` reuses the same ELK compound/hierarchical-layout technique as the subdirectory-grouping boxes above, but a level1 directory node's own ELK node *is* the rendered box — it becomes a compound node containing its level2 child (if one exists) rather than a separate wrapper, so `draw.ts`/`renderer.html` need no rendering-code changes at all: a directory node is drawn exactly like any other node, just with `type: "directory"` instead of a real file's type. See `docs/superpowers/specs/2026-08-07-clustered-view-design.md`.
  ```

- [ ] **Step 23: Update `docs/spec.md`**

  Delete this line from the Planned list (currently line 128 — the feature it describes is now built):
  ```
  - **Clustered view mode** — a third view that collapses every directory to a single box regardless of diff state, for high-level orientation in large features
  ```
  Leave the rest of the Planned list untouched — in particular, keep the separate "Out-of-scope grouping" bullet (line 130): it describes collapsing OOS nodes by parent directory in the *other* two view modes, which this task does not add; clustered mode's own OOS collapsing is local to clustered mode only.

  Then add a short new bullet to the "### View modes" section (after the existing "Diff-focused" bullet description, before "Collapse rules for diff-focused:"):
  ```
  **Clustered** — a third mode for orientation on large features: every subdirectory (up to 2 levels deep) collapses to one box regardless of diff state, colored by the most significant change inside it. Independent of diff-focused's stub-collapsing rules below — a directory renders as a box here even if diff-focused would show it fully expanded or collapse it to a stub.
  ```

- [ ] **Step 24: Run the full verification gate**

  Run: `npm run verify`
  Expected: build, lint, unit tests, visual tests, and the sample drift check all PASS.

- [ ] **Step 25: Commit**

  ```bash
  git add src/types.ts src/renderer/graph-helpers.ts src/renderer/graph-helpers.test.ts \
    src/renderer/layout.ts src/renderer/layout.test.ts \
    src/cli.ts src/cli.test.ts src/renderer.html \
    package.json README.md docs/architecture.md docs/spec.md \
    docs/sample-diff.svg docs/sample-all.svg docs/sample-clustered.svg \
    test/snapshots/reference/
  git commit -m "$(cat <<'EOF'
  Add clustered (directory-only) view mode

  A third view mode, alongside All-nodes and Diff-focused: every
  subdirectory (up to 2 levels deep, same cap as the existing
  subdirectory-grouping boxes) collapses to one box regardless of diff
  state, colored by the most significant change inside it, for
  high-level orientation on features with many files. Out-of-scope
  nodes collapse the same way, flat, one box per parent directory.

  Reuses the ELK compound/hierarchical-layout technique the existing
  subdirectory-grouping boxes use, but a directory node's own ELK node
  is the rendered, colored box rather than a wrapper around real leaf
  files — so draw.ts and renderer.html need zero rendering-code
  changes; a directory node draws exactly like any other node.

  See docs/superpowers/specs/2026-08-07-clustered-view-design.md.
  EOF
  )"
  ```

---

## Self-Review Notes

- **Spec coverage:** 2-level cap ✓ (Step 6/11), dominant-color aggregation ✓ (Step 6), OOS flat collapsing ✓ (Step 6), root files stay individual ✓ (Step 6), ELK compound-node reuse with directory-node-as-content (not wrapper) ✓ (Step 11), zero rendering-code changes in draw.ts/renderer.html ✓ (Step 15 only touches the toggle button), sample fixture demonstrates both flat and nested boxes ✓ (Step 19, `widgets` vs `settings`/`preferences`), wiring (third static SVG + HTML mode) ✓ (Step 14), docs updated ✓ (Steps 21-23).
- **Type consistency:** `computeClusteredLayout(nodes, edges, sourceRoot, scopeDir)` signature used consistently in Step 11's implementation, Step 9's tests, and Step 14's `cli.ts` call site. `GraphNode.type: "directory"` used consistently in Step 6 (`makeDirNode`) and referenced correctly in Step 15's note and Step 22's docs.
- **Known open risk flagged explicitly, not hidden:** the level1-to-own-level2-child edge routing (Step 11/12) is genuinely new ELK usage for this codebase and is called out with a concrete, testable fallback rather than presented as certain — consistent with how the original subdirectory-grouping design spec treated its own ELK risks (verify empirically, document what was found).
- **No placeholders:** every step has literal code, not descriptions of code.
