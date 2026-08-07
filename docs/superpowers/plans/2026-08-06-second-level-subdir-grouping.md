# Second-level subdirectory grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing first-level subdirectory grouping boxes (issue #28) one level deeper, so a file nested two directories under the scope dir (e.g. `data-access/store/user.actions.ts`) gets its own nested box for `store`, inside the `data-access` box — capped at exactly 2 levels, same visual/layout rules as the first level.

**Architecture:** `src/renderer/layout.ts`'s `computeLayout` already builds one ELK compound node per first-level subdirectory and flattens the result generically. This plan extends the grouping-key computation and edge-LCA routing to a second level and adds one more layer of ELK compound nodes; the flattening walk, and all of `draw.ts`/`renderer.html`/`cli.ts`, need no changes because they already treat `subdirContainers` as an undifferentiated flat list.

**Tech Stack:** TypeScript, elkjs (ELK compound/hierarchical layout), Vitest.

## Global Constraints

- Depth is capped at exactly 2 levels of grouping — not arbitrary recursion. A file 3+ directories deep collapses into its level-2 box.
- Level-2 boxes use identical visual styling to level-1 boxes (no new rendering code).
- This repo requires exactly one commit per PR — all steps below land in a single commit at the end.
- `npm run verify` (build + lint + unit tests + visual tests + sample drift check) must pass before this is done. Never use `--no-verify`.
- Design reference: `docs/superpowers/specs/2026-08-06-second-level-subdir-grouping-design.md` and the original `docs/superpowers/specs/2026-07-30-subdir-grouping-design.md`.

---

## File Structure

- **Modify `src/renderer/layout.ts`** — core algorithm: grouping-key computation, ELK compound-node tree construction, edge-LCA routing, all extended from 1 to 2 levels.
- **Modify `src/renderer/layout.test.ts`** — rewrite one existing test whose asserted behavior this feature intentionally changes; add 6 new tests.
- **Create `sample-app/src/app/features/dashboard/settings/preferences/notification-prefs.model.ts`** — small type, gives the sample's existing single-file `preferences/` second-level box a second linked node.
- **Modify `sample-app/src/app/features/dashboard/settings/preferences/dashboard-notification-prefs.component.ts`** — import and use the new model type.
- **Regenerate `docs/sample-diff.svg`, `docs/sample-all.svg`** — via `npm run docs:sample:generate`.
- **Regenerate `test/snapshots/reference/*.png`** — via `npm run test:visual:approve`.
- **Modify `README.md`** — visual-encoding table row and fixture-description paragraph.
- **Modify `docs/architecture.md`** — subdirectory-grouping section, extended to describe the second level.

---

### Task 1: Second-level subdirectory grouping

**Files:**
- Modify: `src/renderer/layout.ts:50-53` (doc comment), `src/renderer/layout.ts:89-93` (id helper), `src/renderer/layout.ts:96-339` (comment + `computeLayout`)
- Modify: `src/renderer/layout.test.ts:239-254` (rewrite), append after line 289 (new tests)
- Create: `sample-app/src/app/features/dashboard/settings/preferences/notification-prefs.model.ts`
- Modify: `sample-app/src/app/features/dashboard/settings/preferences/dashboard-notification-prefs.component.ts`
- Modify: `README.md:38`, `README.md:109`
- Modify: `docs/architecture.md:119-121`

**Interfaces:**
- Produces: `computeLayout(nodes, edges, sourceRoot?, scopeDir?)` — unchanged signature. `Layout.subdirContainers?: LayoutSubdirContainer[]` — unchanged shape (`{x,y,width,height,label}`), now may contain entries from both grouping levels in one flat array.
- Consumes: nothing new from outside this task — `draw.ts`, `renderer.html`, `cli.ts` already consume `layout.subdirContainers` generically and need no changes.

- [ ] **Step 1: Write the failing/updated tests in `src/renderer/layout.test.ts`**

  Replace the existing test (lines 239-254):

  ```ts
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
  ```

  with:

  ```ts
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
  ```

  Then append these 6 new tests immediately before the `describe` block's closing `});` (after the last existing test, which ends at line 289):

  ```ts
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
  ```

- [ ] **Step 2: Run the test file and confirm the expected failures**

  Run: `npx vitest run src/renderer/layout.test.ts`
  Expected: the rewritten test and the 5 new tests referencing `"nested"`, `"inner"`, or 2 `subdirContainers` entries FAIL (current code only produces first-level boxes); all other tests in the file still PASS.

- [ ] **Step 3: Replace the id helper (`src/renderer/layout.ts:89-93`)**

  Replace:

  ```ts
  const SUBDIR_CONTAINER_PREFIX = "__subdir__";

  function subdirContainerId(key: string): string {
  	return `${SUBDIR_CONTAINER_PREFIX}${key}`;
  }
  ```

  with:

  ```ts
  const SUBDIR_CONTAINER_PREFIX = "__subdir__";

  function subdirContainerId(level1: string, level2?: string): string {
  	return level2
  		? `${SUBDIR_CONTAINER_PREFIX}${level1}/${level2}`
  		: `${SUBDIR_CONTAINER_PREFIX}${level1}`;
  }
  ```

- [ ] **Step 4: Update the `LayoutSubdirContainer` doc comment (`src/renderer/layout.ts:50`)**

  Replace:

  ```ts
  // One box per in-scope first-level subdirectory (issue #28).
  ```

  with:

  ```ts
  // One box per in-scope subdirectory, up to 2 levels deep (issue #28).
  ```

- [ ] **Step 5: Rewrite `computeLayout` (`src/renderer/layout.ts:96-339`, from the leading comment block through the end of the function)**

  Replace the whole block — the comment above `computeLayout`, its signature, and its full body — with:

  ```ts
  // ─── computeLayout ────────────────────────────────────────────────────────────
  // Pure async function; runs in Node only (elkjs uses WASM).
  //
  // When both in-scope and out-of-scope nodes exist, ELK partitioning is enabled:
  // in-scope nodes get partition 0, out-of-scope partition 1. This forces ELK to
  // place in-scope nodes in earlier (leftward) layers than oos nodes, guaranteeing
  // no oos node falls inside the in-scope bounding box. All edges remain flat so
  // ELK routes them normally — no cross-hierarchy issues.
  //
  // When scopeDir is given, in-scope nodes under a first-level subdirectory are
  // additionally nested as real ELK compound children of a per-subdir container
  // node (issue #28), instead of being flat siblings. A node one directory
  // deeper still (e.g. data-access/store/x.ts) additionally nests inside a
  // second compound node for its own subdirectory, capped at 2 levels total —
  // deeper nesting folds into that second-level key, the same simplification
  // the first level already makes one level up. ELK's hierarchical layout
  // sizes each container from its own children and never overlaps sibling
  // nodes at a given level (compound or leaf), so subdir boxes — including a
  // second-level box nested inside its parent's box — are a structural
  // guarantee rather than a bounding box inferred after the fact from loose
  // positions — see docs/superpowers/specs/2026-07-30-subdir-grouping-design.md
  // and docs/superpowers/specs/2026-08-06-second-level-subdir-grouping-design.md.

  export async function computeLayout(
  	nodes: GraphNode[],
  	edges: GraphEdge[],
  	sourceRoot = "src/app",
  	scopeDir?: string,
  ): Promise<Layout> {
  	const elk = new ELKClass();

  	const inScopeNodes = nodes.filter(
  		(n) => n.scope === "in-scope" || n.scope === "removed-ghost",
  	);
  	const oosNodes = nodes.filter((n) => n.scope === "out-of-scope");
  	const usePartitions = inScopeNodes.length > 0 && oosNodes.length > 0;
  	// The in-scope container box (drawn below) only needs in-scope nodes to
  	// exist — it doesn't depend on partitioning, which is solely about keeping
  	// oos nodes out of that box when oos nodes are present.
  	const showContainer = inScopeNodes.length > 0;

  	// node id -> { level1, level2 } under scopeDir. level1 = "" means the node
  	// is at the feature root (no box). level2 = "" means the node sits
  	// directly in its level1 subdirectory (no nested box); a file 3+
  	// directories deep still collapses into its level2 key, the same
  	// simplification the level1 key already makes one level up.
  	interface SubdirKey {
  		level1: string;
  		level2: string;
  	}
  	const subdirOf = new Map<string, SubdirKey>();
  	if (scopeDir) {
  		for (const n of inScopeNodes) {
  			const rel = path.relative(scopeDir, n.file);
  			const parts = rel.split(path.sep);
  			const level1 = parts.length > 1 ? parts[0] : "";
  			const level2 = level1 !== "" && parts.length > 2 ? parts[1] : "";
  			subdirOf.set(n.id, { level1, level2 });
  		}
  	}
  	const level1Keys = [
  		...new Set([...subdirOf.values()].map((k) => k.level1)),
  	].filter((k) => k !== "");
  	level1Keys.sort();
  	const useSubdirGroups = level1Keys.length > 0;

  	const level2KeysByLevel1 = new Map<string, string[]>();
  	for (const key1 of level1Keys) {
  		const keys2 = [
  			...new Set(
  				[...subdirOf.values()]
  					.filter((k) => k.level1 === key1)
  					.map((k) => k.level2),
  			),
  		].filter((k) => k !== "");
  		keys2.sort();
  		level2KeysByLevel1.set(key1, keys2);
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

  	function subdirLayoutOptions(): Record<string, string> {
  		return {
  			"elk.algorithm": "layered",
  			"elk.direction": "RIGHT",
  			"elk.spacing.nodeNode": "20",
  			"elk.layered.spacing.nodeNodeBetweenLayers": "40",
  			// Top reserves room for the subdir label drawn inside the box.
  			"elk.padding": "[top=16, left=6, bottom=6, right=6]",
  			...(usePartitions ? { "elk.partitioning.partition": "0" } : {}),
  		};
  	}

  	const rootLevelInScope = inScopeNodes.filter(
  		(n) => (subdirOf.get(n.id)?.level1 ?? "") === "",
  	);

  	// Nodes directly in a level1 dir (level2 === ""), and nodes under a
  	// level1/level2 pair.
  	const directByLevel1 = new Map<string, GraphNode[]>(
  		level1Keys.map((k) => [k, []]),
  	);
  	const byLevel1Level2 = new Map<string, GraphNode[]>();
  	for (const key1 of level1Keys) {
  		for (const key2 of level2KeysByLevel1.get(key1) ?? []) {
  			byLevel1Level2.set(`${key1}/${key2}`, []);
  		}
  	}
  	for (const n of inScopeNodes) {
  		const key = subdirOf.get(n.id);
  		if (!key || key.level1 === "") continue;
  		if (key.level2 === "") {
  			directByLevel1.get(key.level1)?.push(n);
  		} else {
  			byLevel1Level2.get(`${key.level1}/${key.level2}`)?.push(n);
  		}
  	}

  	// Deduplicate edges, then route each to the ELK node whose `edges` array it
  	// belongs on. ELK requires an edge to be declared on the lowest common
  	// ancestor of its endpoints; with an up-to-3-level hierarchy (root ->
  	// level1 -> level2 -> file) that reduces to: the level2 container when
  	// both endpoints share one, else the level1 container when both endpoints
  	// share that, else the root graph.
  	type ElkEdgeInput = { id: string; sources: string[]; targets: string[] };
  	const seen = new Set<string>();
  	const rootEdges: ElkEdgeInput[] = [];
  	const level1Edges = new Map<string, ElkEdgeInput[]>(
  		level1Keys.map((k) => [k, []]),
  	);
  	const level2Edges = new Map<string, ElkEdgeInput[]>(
  		[...byLevel1Level2.keys()].map((k) => [k, []]),
  	);
  	edges.forEach((e, i) => {
  		const key = `${e.from}→${e.to}`;
  		if (seen.has(key)) return;
  		seen.add(key);
  		const elkEdge: ElkEdgeInput = {
  			id: `e${i}`,
  			sources: [e.from],
  			targets: [e.to],
  		};
  		const fromKey = subdirOf.get(e.from);
  		const toKey = subdirOf.get(e.to);
  		const from1 = fromKey?.level1 ?? "";
  		const to1 = toKey?.level1 ?? "";
  		const from2 = fromKey?.level2 ?? "";
  		const to2 = toKey?.level2 ?? "";
  		if (from1 !== "" && from1 === to1 && from2 !== "" && from2 === to2) {
  			level2Edges.get(`${from1}/${from2}`)?.push(elkEdge);
  		} else if (from1 !== "" && from1 === to1) {
  			level1Edges.get(from1)?.push(elkEdge);
  		} else {
  			rootEdges.push(elkEdge);
  		}
  	});

  	const level2ContainerNodesByLevel1 = new Map<string, ElkNode[]>();
  	for (const key1 of level1Keys) {
  		const nodes2: ElkNode[] = (level2KeysByLevel1.get(key1) ?? []).map(
  			(key2) => ({
  				id: subdirContainerId(key1, key2),
  				layoutOptions: subdirLayoutOptions(),
  				children: (byLevel1Level2.get(`${key1}/${key2}`) ?? []).map(
  					leafElkNode,
  				),
  				edges: level2Edges.get(`${key1}/${key2}`) ?? [],
  			}),
  		);
  		level2ContainerNodesByLevel1.set(key1, nodes2);
  	}

  	const subdirContainerNodes: ElkNode[] = level1Keys.map((key1) => ({
  		id: subdirContainerId(key1),
  		layoutOptions: subdirLayoutOptions(),
  		children: [
  			...(directByLevel1.get(key1) ?? []).map(leafElkNode),
  			...(level2ContainerNodesByLevel1.get(key1) ?? []),
  		],
  		edges: level1Edges.get(key1) ?? [],
  	}));

  	const labelByContainerId = new Map<string, string>();
  	for (const key1 of level1Keys) {
  		labelByContainerId.set(subdirContainerId(key1), key1);
  		for (const key2 of level2KeysByLevel1.get(key1) ?? []) {
  			labelByContainerId.set(subdirContainerId(key1, key2), key2);
  		}
  	}

  	const rootLeafNodes: ElkNode[] = [
  		...rootLevelInScope.map(leafElkNode),
  		...oosNodes.map(leafElkNode),
  	];

  	const graph: ElkNode = {
  		id: "root",
  		layoutOptions: {
  			"elk.algorithm": "layered",
  			"elk.direction": "RIGHT",
  			...(usePartitions ? { "elk.partitioning.activate": "true" } : {}),
  			"elk.spacing.nodeNode": "20",
  			"elk.layered.spacing.nodeNodeBetweenLayers": "40",
  			// When the container box will be drawn, top needs 55px so its label
  			// (minY − 35) stays above y=0. Left needs 40px so the container left
  			// edge (minX − 15) isn't cramped.
  			"elk.padding": showContainer
  				? "[top=55, left=40, bottom=35, right=35]"
  				: "[top=20, left=20, bottom=20, right=20]",
  			// Without this, ELK treats each subdir compound node as an isolated
  			// sub-layout and silently fails to route any edge crossing into or
  			// out of it (0 sections returned, nothing drawn) — every edge
  			// touching a subdir-grouped node needs the whole hierarchy
  			// considered together, regardless of how many levels it crosses.
  			...(useSubdirGroups
  				? { "elk.hierarchyHandling": "INCLUDE_CHILDREN" }
  				: {}),
  		},
  		children: [...rootLeafNodes, ...subdirContainerNodes],
  		edges: rootEdges,
  	};

  	const result = await elk.layout(graph);

  	// Recursively flatten the (at most 3-level) hierarchy back to absolute
  	// canvas coordinates. ELK returns each child's x/y relative to its own
  	// parent's origin, and edge sections declared on a compound node are in
  	// that same local frame — so both need the accumulated parent offset added.
  	const layoutNodes: LayoutNode[] = [];
  	const layoutEdges: LayoutEdge[] = [];
  	const subdirContainers: LayoutSubdirContainer[] = [];

  	function walk(node: ElkNode, offsetX: number, offsetY: number): void {
  		for (const child of node.children ?? []) {
  			const absX = offsetX + (child.x ?? 0);
  			const absY = offsetY + (child.y ?? 0);
  			const label = labelByContainerId.get(child.id);
  			if (label !== undefined) {
  				subdirContainers.push({
  					x: absX,
  					y: absY,
  					width: child.width ?? 0,
  					height: child.height ?? 0,
  					label,
  				});
  				walk(child, absX, absY);
  			} else {
  				layoutNodes.push({
  					id: child.id,
  					x: absX,
  					y: absY,
  					width: child.width ?? MIN_NODE_WIDTH,
  					height: child.height ?? NODE_HEIGHT,
  				});
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

  	// Compute the in-scope container box from actual node positions post-layout.
  	// When oos nodes are present, partitioning guarantees they're at higher x
  	// values, so none fall inside this bounding box.
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
  		subdirContainers: useSubdirGroups ? subdirContainers : undefined,
  	};
  }
  ```

- [ ] **Step 6: Run the test file and confirm everything passes**

  Run: `npx vitest run src/renderer/layout.test.ts`
  Expected: all tests PASS (21 pre-existing + 6 new − 1 replaced = 26 tests).

- [ ] **Step 7: Run the full unit test suite**

  Run: `npm test`
  Expected: all test files PASS. (`draw.test.ts`, `renderer.html.test.ts`, and `cli.test.ts`'s subdirectory-grouping tests use hand-built layouts or a synthetic tmp fixture, not `fake-angular-app`, so they're unaffected by `fake-angular-app`'s real `data-access/store/` nesting now producing an extra box.)

- [ ] **Step 8: Create the sample fixture model file**

  Create `sample-app/src/app/features/dashboard/settings/preferences/notification-prefs.model.ts`:

  ```ts
  export interface NotificationPrefs {
  	weeklySummary: boolean;
  	mentions: boolean;
  	digest: boolean;
  }
  ```

- [ ] **Step 9: Wire the model into the existing preferences component**

  In `sample-app/src/app/features/dashboard/settings/preferences/dashboard-notification-prefs.component.ts`, add the import and use the type:

  Replace:

  ```ts
  import { CommonModule } from "@angular/common";
  import { Component } from "@angular/core";
  ```

  with:

  ```ts
  import { CommonModule } from "@angular/common";
  import { Component } from "@angular/core";
  import type { NotificationPrefs } from "./notification-prefs.model";
  ```

  Replace:

  ```ts
  export class DashboardNotificationPrefsComponent {
  	prefs = { weeklySummary: true, mentions: true, digest: false };

  	toggle(key: keyof typeof this.prefs): void {
  		this.prefs[key] = !this.prefs[key];
  	}
  }
  ```

  with:

  ```ts
  export class DashboardNotificationPrefsComponent {
  	prefs: NotificationPrefs = {
  		weeklySummary: true,
  		mentions: true,
  		digest: false,
  	};

  	toggle(key: keyof NotificationPrefs): void {
  		this.prefs[key] = !this.prefs[key];
  	}
  }
  ```

  This file (and the model) exist only in `sample-app`, not `sample-app-base`, so both nodes render as "added" — leave `sample-app-base` untouched.

- [ ] **Step 10: Build and regenerate the sample SVGs**

  Run: `npm run build && npm run docs:sample:generate`
  Expected: exits 0, overwrites `docs/sample-diff.svg` and `docs/sample-all.svg`. Open both (or `dist/diagram.html` from a manual `node dist/cli.js --repo-root sample-app --base-repo-root sample-app-base src/app/features/dashboard`) and visually confirm: `widgets/` still renders as a plain first-level box (no nesting), and `settings/` now renders a nested `preferences` box containing 2 linked nodes.

- [ ] **Step 11: Update visual regression snapshots**

  Run: `npm run test:visual`
  Expected: FAILS — `fake-angular-app`'s `data-access/store/` and `sample-app`'s `settings/preferences/` now render an extra nested box each, so pixel snapshots differ. This is an intentional rendering change per the design spec, not a bug.

  Run: `npm run test:visual:approve`
  Expected: updates `test/snapshots/reference/*.png`.

  Run: `npm run test:visual` again
  Expected: PASSES.

- [ ] **Step 12: Update `README.md`**

  Replace (line 38):

  ```
  | Dashed subtle box inside the feature container | Files grouped by first-level subdirectory (e.g. `user-list/`); files at the feature root get no box |
  ```

  with:

  ```
  | Dashed subtle box inside the feature container | Files grouped by subdirectory, up to 2 levels deep (e.g. `user-list/`, with a nested box for `data-access/store/`); files at the feature root, or directly in a first-level subdirectory, get no box for that level |
  ```

  Replace (line 109):

  ```
  Fixture diff: designed so `npm run diagram:sample` produces one diagram containing every visual element the renderer can produce (added/modified/removed/unchanged nodes, out-of-scope and type-only dependencies, test/story markers, and subdirectory group boxes). The dashboard feature has 3 files at its root, a `widgets/` subdirectory (2 files), a `settings/` subdirectory (1 root file plus a nested `settings/preferences/` file, demonstrating that nested files still group under their first-level subdirectory), and a `layout/` subdirectory whose one file is unchanged between branches — the only subdirectory diff-focused mode collapses to a stub, so it's the one place the two sample images above actually differ. Not used by any automated test.
  ```

  with:

  ```
  Fixture diff: designed so `npm run diagram:sample` produces one diagram containing every visual element the renderer can produce (added/modified/removed/unchanged nodes, out-of-scope and type-only dependencies, test/story markers, and both first- and second-level subdirectory group boxes). The dashboard feature has 3 files at its root, a `widgets/` subdirectory (2 files, first-level box only), a `settings/` subdirectory (1 root file plus a nested `settings/preferences/` directory with 2 linked files, demonstrating a second-level grouping box nested inside the first-level one), and a `layout/` subdirectory whose one file is unchanged between branches — the only subdirectory diff-focused mode collapses to a stub, so it's the one place the two sample images above actually differ. Not used by any automated test.
  ```

- [ ] **Step 13: Update `docs/architecture.md`**

  Replace (lines 119-121):

  ```
  **Subdirectory grouping (`scopeDir` parameter, issue #28):** when given, each in-scope node's first-level subdirectory under `scopeDir` becomes a real ELK compound node (`children: [...]`), instead of a flat sibling of the root graph — the same relative-path computation `computeViewNodes` uses for its own subdir grouping (`path.relative(scopeDir, node.file)`, first path segment; deeper nesting folds into that same first-level key). ELK's hierarchical layout sizes and positions each compound node from its own children, so non-overlap between subdir boxes is a structural guarantee, not inferred from post-layout positions. Two things this depends on:
  - **Edge placement follows ELK's lowest-common-ancestor rule.** In this 2-level hierarchy (root → subdir container → file), an edge whose endpoints share a subdirectory is declared on that subdirectory's own `edges` array; every other edge (cross-subdirectory, touching a root-level node, or touching an out-of-scope node) is declared on the root graph's `edges` array.
  - **`elk.hierarchyHandling: INCLUDE_CHILDREN`** must be set on the root graph whenever subdir groups are used, or ELK silently returns 0 sections (no routing at all) for any edge crossing a subdirectory boundary.
  ```

  with:

  ```
  **Subdirectory grouping (`scopeDir` parameter, issue #28):** when given, each in-scope node's first-level subdirectory under `scopeDir` becomes a real ELK compound node (`children: [...]`), instead of a flat sibling of the root graph. A node one directory deeper still (e.g. `data-access/store/user.actions.ts`) additionally nests inside a second compound node for its own subdirectory (`store`), capped at 2 levels total — deeper nesting folds into that second-level key, the same simplification the first level already makes one level up. Grouping keys reuse the same relative-path computation `computeViewNodes` uses for its own subdir grouping (`path.relative(scopeDir, node.file)`, first and second path segments). ELK's hierarchical layout sizes and positions each compound node from its own children, so non-overlap between subdir boxes — including a second-level box nested inside its parent's box — is a structural guarantee, not inferred from post-layout positions. Two things this depends on:
  - **Edge placement follows ELK's lowest-common-ancestor rule.** In this up-to-3-level hierarchy (root → first-level container → second-level container → file), an edge whose endpoints share both subdirectory levels is declared on the second-level container's `edges` array; an edge whose endpoints share only the first level is declared on that first-level container's `edges` array; every other edge (cross-subdirectory, touching a root-level node, or touching an out-of-scope node) is declared on the root graph's `edges` array.
  - **`elk.hierarchyHandling: INCLUDE_CHILDREN`** must be set on the root graph whenever subdir groups are used, or ELK silently returns 0 sections (no routing at all) for any edge crossing a subdirectory boundary — this applies uniformly regardless of how many hierarchy levels an edge crosses.

  See `docs/superpowers/specs/2026-08-06-second-level-subdir-grouping-design.md` for the second-level extension's design.
  ```

- [ ] **Step 14: Run the full verification gate**

  Run: `npm run verify`
  Expected: build, lint, unit tests, visual tests, and the sample drift check (`docs:sample:check-drift`, now comparing against the SVGs regenerated in Step 10) all PASS.

- [ ] **Step 15: Commit**

  ```bash
  git add src/renderer/layout.ts src/renderer/layout.test.ts \
    sample-app/src/app/features/dashboard/settings/preferences/notification-prefs.model.ts \
    sample-app/src/app/features/dashboard/settings/preferences/dashboard-notification-prefs.component.ts \
    docs/sample-diff.svg docs/sample-all.svg \
    test/snapshots/reference/ \
    README.md docs/architecture.md
  git commit -m "$(cat <<'EOF'
  Add second-level subdirectory grouping boxes

  Extends the existing first-level subdir grouping (issue #28) one level
  deeper: a file nested two directories under the scope dir now gets its
  own nested box (e.g. data-access/store/), capped at 2 levels total,
  using the same ELK compound-node approach and visual style as the
  first level. sample-app's settings/preferences/ demonstrates the new
  box alongside widgets/, which continues to demonstrate a first-level-
  only box.

  See docs/superpowers/specs/2026-08-06-second-level-subdir-grouping-design.md.
  EOF
  )"
  ```

---

## Self-Review Notes

- **Spec coverage:** grouping-key extension ✓ (Step 5), ELK tree nesting ✓ (Step 5), edge LCA extension ✓ (Step 5), no rendering-code changes ✓ (design relies on `draw.ts`/`renderer.html`/`cli.ts` being untouched — verified no step modifies them), sample fixture showing both 1-level and 2-level boxes ✓ (Steps 8-10), docs updated ✓ (Steps 12-13), existing test's changed contract handled ✓ (Step 1).
- **Type consistency:** `subdirContainerId(level1: string, level2?: string)` used consistently across Steps 3 and 5. `LayoutSubdirContainer` shape (`{x,y,width,height,label}`) unchanged throughout — no new fields introduced, so `draw.ts`/`cli.ts`/`renderer.html` genuinely need no changes.
- **No placeholders:** every step has literal code, not descriptions of code.
