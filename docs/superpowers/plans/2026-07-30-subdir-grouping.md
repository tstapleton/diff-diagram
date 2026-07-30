# Subdirectory Grouping Inside Scope Container — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Within the in-scope feature container, visually group nodes by their first-level subdirectory (e.g. `user-list/`, `widgets/`) as a subtle, non-overlapping background box with a label, using real ELK compound/hierarchical layout nodes.

**Architecture:** `computeLayout` (`src/renderer/layout.ts`) gains an optional 4th parameter, `scopeDir`. When given, each in-scope node's first-level subdirectory becomes a real ELK compound node (`children: [...]`) instead of a flat sibling; ELK's hierarchical layout algorithm sizes and positions each subdirectory's box from its own children, guaranteeing non-overlap structurally rather than inferring a bounding box from loose post-layout positions. `elk.hierarchyHandling: INCLUDE_CHILDREN` is required on the root graph or cross-subdirectory edges silently fail to route. Both rendering paths (`src/renderer/draw.ts` for SVG, `src/renderer.html` for the interactive HTML view) draw the resulting `subdirContainers` the same way they already draw the outer feature container.

**Tech Stack:** TypeScript, elkjs (ELK layout engine), Vitest, Biome, `@resvg/resvg-js` + `pixelmatch` for visual regression.

## Global Constraints

- Follow the design in `docs/superpowers/specs/2026-07-30-subdir-grouping-design.md` — read it before starting if anything below is ambiguous.
- TDD red-green: write the failing test, watch it fail, write minimal code to pass, watch it pass. Test files live next to the source they test (already the project's convention).
- Run `npm run build` before any manual CLI invocation — the CLI runs from `dist/`, not `src/`.
- Never use `--no-verify` or otherwise bypass the pre-commit hook (`npm run verify`: build + lint + unit tests + visual tests).
- This is one feature / one task. Commit after each numbered task below (small, reviewable commits during development), but **before opening a PR, squash all of this plan's commits into a single commit** — the repo's pre-commit hook (`.claude/hooks/block-multi-commit-pr.sh`) blocks `gh pr create` on branches more than one commit ahead of `main`.
- Any task that changes rendered SVG output requires updating and approving the visual regression snapshots (Task 6 does this once, at the end, covering all prior rendering changes) — never run `npm run test:visual:approve` to silence a failure you haven't explained.
- Do not modify `docs/superpowers/specs/2026-07-30-subdir-grouping-design.md` — it's already committed as the accepted design.

---

### Task 1: `computeLayout` — subdirectory compound-node grouping

**Files:**
- Modify: `src/renderer/layout.ts`
- Test: `src/renderer/layout.test.ts`

**Interfaces:**
- Produces: `computeLayout(nodes: GraphNode[], edges: GraphEdge[], sourceRoot = "src/app", scopeDir?: string): Promise<Layout>` — 4th parameter is new and optional; omitting it must reproduce prior behavior exactly (all existing tests in this file already call it without a 4th argument and must keep passing unmodified).
- Produces: `Layout.subdirContainers?: LayoutSubdirContainer[]`, where `LayoutSubdirContainer = LayoutContainer & { label: string }`.
- Consumes: nothing new from other tasks — this is the foundation task.

- [ ] **Step 1: Write the failing tests**

Add this new `describe` block to the end of `src/renderer/layout.test.ts` (keep the existing `node`/`edge` helpers as-is; add one more helper alongside them):

```typescript
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
```

Replace the file's top import block (currently `import { describe, expect, it } from "vitest";` / `import type { GraphEdge, GraphNode } from "../types.js";` / `import { computeLayout } from "./layout.js";`) with:

```typescript
import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "../types.js";
import { computeLayout } from "./layout.js";
import type { LayoutContainer, LayoutNode } from "./layout.js";
```

(This adds one new type-only import line for `LayoutContainer`/`LayoutNode`, used by the `within()` helper below — it does not replace the existing `computeLayout` value import.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/layout.test.ts`
Expected: FAIL — `computeLayout` doesn't accept a 4th argument yet and `subdirContainers` doesn't exist on `Layout`, so most new assertions fail or the file fails to type-check.

- [ ] **Step 3: Implement `computeLayout`'s subdirectory grouping**

Replace the entire contents of `src/renderer/layout.ts` with:

```typescript
import { createRequire } from "node:module";
import path from "node:path";
import type {
	ELK as ELKInstance,
	ElkExtendedEdge,
	ElkNode,
} from "elkjs/lib/elk-api.js";
import { oosDisplayPath } from "../analyzer.js";
import type { GraphEdge, GraphNode } from "../types.js";

const _require = createRequire(import.meta.url);
const ELKClass = _require("elkjs/lib/elk.bundled.js") as {
	new (): ELKInstance;
};

// ─── Output types ─────────────────────────────────────────────────────────────

export interface LayoutPoint {
	x: number;
	y: number;
}

export interface LayoutEdgeSection {
	startPoint: LayoutPoint;
	endPoint: LayoutPoint;
	bendPoints?: LayoutPoint[];
}

export interface LayoutNode {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface LayoutEdge {
	from: string;
	to: string;
	sections: LayoutEdgeSection[];
}

export interface LayoutContainer {
	x: number;
	y: number;
	width: number;
	height: number;
}

// One box per in-scope first-level subdirectory (issue #28).
export interface LayoutSubdirContainer extends LayoutContainer {
	label: string;
}

export interface Layout {
	nodes: LayoutNode[];
	edges: LayoutEdge[];
	width: number;
	height: number;
	container?: LayoutContainer;
	subdirContainers?: LayoutSubdirContainer[];
}

// ─── Node dimensions ──────────────────────────────────────────────────────────

const MIN_NODE_WIDTH = 140;
const NODE_HEIGHT = 40;
const STUB_WIDTH = 120;
const STUB_HEIGHT = 32;
const APPROX_CHAR_WIDTH = 7;
const APPROX_CHAR_WIDTH_SMALL = 5; // px per char at font-size 8
const NODE_PADDING = 24;

function nodeDims(
	node: GraphNode,
	sourceRoot = "src/app",
): { width: number; height: number } {
	if (node.type === "stub") return { width: STUB_WIDTH, height: STUB_HEIGHT };
	const labelWidth = node.label.length * APPROX_CHAR_WIDTH + NODE_PADDING;
	let pathWidth = 0;
	if (node.scope === "out-of-scope") {
		const dir = oosDisplayPath(node.file, sourceRoot);
		pathWidth = dir.length * APPROX_CHAR_WIDTH_SMALL + NODE_PADDING;
	}
	const width = Math.max(MIN_NODE_WIDTH, labelWidth, pathWidth);
	return { width, height: NODE_HEIGHT };
}

const SUBDIR_CONTAINER_PREFIX = "__subdir__";

function subdirContainerId(key: string): string {
	return `${SUBDIR_CONTAINER_PREFIX}${key}`;
}

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
// node (issue #28), instead of being flat siblings. ELK's hierarchical layout
// sizes each container from its own children and never overlaps sibling nodes
// at a given level (compound or leaf), so subdir boxes are a structural
// guarantee rather than a bounding box inferred after the fact from loose
// positions — see docs/superpowers/specs/2026-07-30-subdir-grouping-design.md
// for why an ELK-partitioning-based approach was tried first and rejected.

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

	// node id -> first-level subdir under scopeDir ("" = feature-root, no box)
	const subdirOf = new Map<string, string>();
	if (scopeDir) {
		for (const n of inScopeNodes) {
			const rel = path.relative(scopeDir, n.file);
			const parts = rel.split(path.sep);
			subdirOf.set(n.id, parts.length > 1 ? parts[0] : "");
		}
	}
	const subdirKeys = [...new Set(subdirOf.values())].filter((k) => k !== "");
	subdirKeys.sort();
	const useSubdirGroups = subdirKeys.length > 0;

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

	const rootLevelInScope = inScopeNodes.filter(
		(n) => (subdirOf.get(n.id) ?? "") === "",
	);
	const bySubdir = new Map<string, GraphNode[]>(subdirKeys.map((k) => [k, []]));
	for (const n of inScopeNodes) {
		const key = subdirOf.get(n.id) ?? "";
		if (key !== "") bySubdir.get(key)?.push(n);
	}

	// Deduplicate edges, then route each to the ELK node whose `edges` array it
	// belongs on. ELK requires an edge to be declared on the lowest common
	// ancestor of its endpoints; with a 2-level hierarchy (root -> subdir ->
	// file) that reduces to: the subdir itself when both endpoints share one,
	// otherwise the root graph.
	type ElkEdgeInput = { id: string; sources: string[]; targets: string[] };
	const seen = new Set<string>();
	const rootEdges: ElkEdgeInput[] = [];
	const subdirEdges = new Map<string, ElkEdgeInput[]>(
		subdirKeys.map((k) => [k, []]),
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
		const fromKey = subdirOf.get(e.from) ?? "";
		const toKey = subdirOf.get(e.to) ?? "";
		if (fromKey !== "" && fromKey === toKey) {
			subdirEdges.get(fromKey)?.push(elkEdge);
		} else {
			rootEdges.push(elkEdge);
		}
	});

	const subdirContainerNodes: ElkNode[] = subdirKeys.map((key) => ({
		id: subdirContainerId(key),
		layoutOptions: {
			"elk.algorithm": "layered",
			"elk.direction": "RIGHT",
			"elk.spacing.nodeNode": "20",
			"elk.layered.spacing.nodeNodeBetweenLayers": "40",
			// Top reserves room for the subdir label drawn inside the box.
			"elk.padding": "[top=16, left=6, bottom=6, right=6]",
			...(usePartitions ? { "elk.partitioning.partition": "0" } : {}),
		},
		children: (bySubdir.get(key) ?? []).map(leafElkNode),
		edges: subdirEdges.get(key) ?? [],
	}));
	const labelByContainerId = new Map(
		subdirKeys.map((key) => [subdirContainerId(key), key]),
	);

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
			// When partitioning, top needs 55px so the container label (minY − 35) stays above y=0.
			// Left needs 40px so the container left edge (minX − 15) isn't cramped.
			"elk.padding": usePartitions
				? "[top=55, left=40, bottom=35, right=35]"
				: "[top=20, left=20, bottom=20, right=20]",
			// Without this, ELK treats each subdir compound node as an isolated
			// sub-layout and silently fails to route any edge crossing into or
			// out of it (0 sections returned, nothing drawn) — every edge
			// touching a subdir-grouped node needs the whole hierarchy
			// considered together.
			...(useSubdirGroups
				? { "elk.hierarchyHandling": "INCLUDE_CHILDREN" }
				: {}),
		},
		children: [...rootLeafNodes, ...subdirContainerNodes],
		edges: rootEdges,
	};

	const result = await elk.layout(graph);

	// Recursively flatten the (at most 2-level) hierarchy back to absolute
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
	// Partitioning guarantees all oos nodes are at higher x values, so no oos
	// node falls inside this bounding box.
	let container: LayoutContainer | undefined;
	if (usePartitions) {
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/layout.test.ts`
Expected: PASS — all tests in the file, old and new.

- [ ] **Step 5: Build and lint**

Run: `npm run build && npx biome check --write .`
Expected: both succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/layout.ts src/renderer/layout.test.ts
git commit -m "Group in-scope nodes into per-subdirectory ELK compound boxes (#28)"
```

---

### Task 2: Render subdirectory boxes in `draw.ts` (SVG output)

**Files:**
- Modify: `src/renderer/draw.ts`
- Test: `src/renderer/draw.test.ts`

**Interfaces:**
- Consumes: `Layout.subdirContainers?: LayoutSubdirContainer[]` from Task 1 (`{ x, y, width, height, label }`).
- Produces: nothing new consumed by later tasks — `toSvg`'s signature is unchanged.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to the end of `src/renderer/draw.test.ts`:

```typescript
// ─── subdirectory group boxes (issue #28) ─────────────────────────────────────

describe("toSvg — subdirectory group boxes", () => {
	it("renders a dashed rect and label for each subdirContainers entry", () => {
		const nodes = [node("a"), node("b")];
		const l = layout(nodes);
		l.subdirContainers = [
			{ x: 10, y: 20, width: 300, height: 100, label: "widgets" },
		];
		const svg = toSvg(l, nodes, [], "feature");
		expect(svg).toContain('stroke-dasharray="3,2"');
		expect(svg).toContain(">widgets<");
	});

	it("renders one box per entry when there are multiple subdirectories", () => {
		const nodes = [node("a"), node("b")];
		const l = layout(nodes);
		l.subdirContainers = [
			{ x: 0, y: 0, width: 100, height: 50, label: "alpha" },
			{ x: 200, y: 0, width: 100, height: 50, label: "beta" },
		];
		const svg = toSvg(l, nodes, [], "feature");
		expect(svg).toContain(">alpha<");
		expect(svg).toContain(">beta<");
	});

	it("renders nothing extra when subdirContainers is absent", () => {
		const nodes = [node("a")];
		const l = layout(nodes);
		const svg = toSvg(l, nodes, [], "feature");
		expect(svg).not.toContain("stroke-dasharray=\"3,2\"");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/draw.test.ts`
Expected: FAIL — `toSvg` doesn't render anything for `subdirContainers` yet.

- [ ] **Step 3: Implement the rendering**

In `src/renderer/draw.ts`, find the `toSvg` function. Immediately after the existing `containerRect` block (which starts with `// Container box: ELK compound layout positions __scope__ precisely; use it directly`) and before `const { width, height } = layout;`, insert:

```typescript
	// Subdirectory group boxes (issue #28): one subtle dashed rect + label per
	// entry, subordinate to the outer feature container above it.
	const subdirRects = (layout.subdirContainers ?? []).map((c) => {
		return [
			`  <rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="4" fill="none" stroke="#2d3f5c" stroke-width="1" stroke-dasharray="3,2"/>`,
			`  <text x="${c.x + 8}" y="${c.y + 11}" font-family="${FONT_FAMILY}" font-size="8" fill="#5a7096">${c.label}</text>`,
		].join("\n");
	});
```

Then update the final returned array to include `...subdirRects` between `...(containerRect ? [containerRect] : [])` and `...renderedEdges`:

```typescript
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
		`<defs>${arrowMarkers()}</defs>`,
		`<rect width="${width}" height="${height}" fill="#0f172a"/>`,
		...(containerRect ? [containerRect] : []),
		...subdirRects,
		...renderedEdges,
		...renderedNodes,
		`</svg>`,
	].join("\n");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/renderer/draw.test.ts`
Expected: PASS — all tests, old and new.

- [ ] **Step 5: Build and lint**

Run: `npm run build && npx biome check --write .`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/draw.ts src/renderer/draw.test.ts
git commit -m "Render subdirectory group boxes in SVG output (#28)"
```

---

### Task 3: Wire `scopeDir` through `cli.ts` and embed `subdirContainers` in the HTML data

**Files:**
- Modify: `src/cli.ts`
- Test: `src/cli.test.ts`

**Interfaces:**
- Consumes: `computeLayout(nodes, edges, sourceRoot, scopeDir?)` from Task 1; `Layout.subdirContainers` from Task 1.
- Produces: `ModeData.subdirContainers?: Array<{ x: number; y: number; width: number; height: number; label: string }>`, embedded in `diagram.html`'s JSON — consumed by Task 4 (`renderer.html`).

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to the end of `src/cli.test.ts` (follows the same pattern as the existing `describe("cli single-branch mode output views", ...)` block above it):

```typescript
// ─── subdirectory grouping (issue #28) ────────────────────────────────────────

describe("cli subdirectory grouping", () => {
	let tmp: string;
	let repoRoot: string;

	beforeAll(async () => {
		tmp = mkdtempSync(path.join(tmpdir(), "dd-cli-subdir-"));
		repoRoot = path.join(tmp, "repo");
		await writeFixtureFile(
			path.join(
				repoRoot,
				"src/app/features/f/widgets/alpha.component.ts",
			),
			"export const alpha = 1;\n",
		);
		await writeFixtureFile(
			path.join(repoRoot, "src/app/features/f/widgets/beta.component.ts"),
			"export const beta = 1;\n",
		);
	}, 30_000);

	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("diagram.svg draws a subdirectory group box labeled with the subdirectory name", async () => {
		const outDir = path.join(tmp, "out");
		const result = await runCli([
			"--repo-root",
			repoRoot,
			"--out-dir",
			outDir,
			"src/app/features/f",
		]);
		expect(result.code).toBe(0);

		const svg = await readFile(path.join(outDir, "diagram.svg"), "utf8");
		expect(svg).toContain(">widgets<");
	}, 30_000);

	it("diagram.html embeds subdirContainers data", async () => {
		const html = await readFile(path.join(tmp, "out/diagram.html"), "utf8");
		expect(html).toContain('"subdirContainers"');
		expect(html).toContain('"label":"widgets"');
	}, 30_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && npx vitest run src/cli.test.ts -t "cli subdirectory grouping"`
Expected: FAIL — `diagram.svg` has no `widgets` label yet; `diagram.html` has no `subdirContainers` key.

- [ ] **Step 3: Wire `scopeDir` through and add `subdirContainers` to `ModeData`**

In `src/cli.ts`, update the `ModeData` interface (add `subdirContainers` alongside the existing `container` field):

```typescript
interface ModeData {
	nodes: Array<{
		id: string;
		x: number;
		y: number;
		width: number;
		height: number;
		label: string;
		type: string;
		diff: string | null;
		scope: string;
		file: string;
		typeOnly?: boolean;
		hasTests?: boolean;
		hasStories?: boolean;
	}>;
	edges: Array<{
		from: string;
		to: string;
		sections: Layout["edges"][number]["sections"];
		diff?: string;
	}>;
	width: number;
	height: number;
	container?: { x: number; y: number; width: number; height: number };
	subdirContainers?: Array<{
		x: number;
		y: number;
		width: number;
		height: number;
		label: string;
	}>;
}
```

Update `buildModeData`'s return statement to include the new field:

```typescript
	return {
		nodes,
		edges,
		width: layout.width,
		height: layout.height,
		container: layout.container,
		subdirContainers: layout.subdirContainers,
	};
```

Update the two `computeLayout` calls in `main()` to pass `diffed.meta.scopeDir` as the 4th argument:

```typescript
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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && npx vitest run src/cli.test.ts`
Expected: PASS — the full file, old and new tests.

- [ ] **Step 5: Build and lint**

Run: `npm run build && npx biome check --write .`

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts src/cli.test.ts
git commit -m "Wire scopeDir into computeLayout and embed subdirContainers in CLI output (#28)"
```

---

### Task 4: Render subdirectory boxes in `renderer.html` (interactive HTML view)

**Files:**
- Modify: `src/renderer.html`
- Test: `src/renderer.html.test.ts`

**Interfaces:**
- Consumes: `subdirContainers` field embedded in `DIFF_DIAGRAM.modes[mode]`, produced by Task 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

In `src/renderer.html.test.ts`, add a `subdirContainers` array to the `FIXTURE.modes.all` object (leave `diffFocused` without one, to also cover the "absent" case):

```typescript
const FIXTURE = {
	meta: { scopeDir: "src/app/features/users" },
	sourceRoot: "src/app",
	modes: {
		all: {
			nodes: [
				node("alpha", "unchanged", 10),
				node("beta", "added", 150),
				node("gamma", "unchanged", 290),
			],
			edges: [],
			width: 440,
			height: 120,
			subdirContainers: [
				{ x: 5, y: 5, width: 400, height: 60, label: "widgets" },
			],
		},
		diffFocused: {
			nodes: [node("alpha", "unchanged", 10), node("beta", "added", 150)],
			edges: [],
			width: 300,
			height: 120,
		},
	},
};
```

Add this new `describe` block at the end of the file:

```typescript
describe("renderer.html subdirectory group boxes", () => {
	it("renders one .subdir-group element per subdirContainers entry", async () => {
		const window = await loadDiagram();
		modeButton(window, "All nodes").click();
		expect(window.document.querySelectorAll(".subdir-group")).toHaveLength(1);
		expect(window.document.querySelector(".subdir-group")?.textContent).toBe(
			"widgets",
		);
	});

	it("renders no .subdir-group elements when subdirContainers is absent", async () => {
		const window = await loadDiagram();
		// starts in diff-focused mode by default, which has no subdirContainers
		expect(window.document.querySelectorAll(".subdir-group")).toHaveLength(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderer.html.test.ts`
Expected: FAIL — no `.subdir-group` elements exist yet.

- [ ] **Step 3: Implement the client-side rendering**

In `src/renderer.html`, find `function renderSvg(mode) {`. Update its destructuring line to also pull `subdirContainers`:

```javascript
  const { nodes, edges, width, height, container, subdirContainers } = DIFF_DIAGRAM.modes[mode];
```

Immediately after the existing `containerSvg` block (which ends with the closing `` ` `` of the template literal assigned to `containerSvg`), add:

```javascript
  const subdirSvg = (subdirContainers || []).map(c =>
    `<g class="subdir-group"><rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="4" fill="none" stroke="#2d3f5c" stroke-width="1" stroke-dasharray="3,2"/>
<text x="${c.x + 8}" y="${c.y + 11}" font-family="monospace" font-size="8" fill="#5a7096">${c.label}</text></g>`
  ).join('');
```

Update the final returned template literal (the one starting `` return `<svg ... ` ``) to include `${subdirSvg}` on its own line between `${containerSvg}` and `${edgePaths}`:

```javascript
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<defs>${markers}</defs>
<rect width="${width}" height="${height}" fill="#0f172a"/>
${containerSvg}
${subdirSvg}
${edgePaths}
${nodeElems}
</svg>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderer.html.test.ts`
Expected: PASS — all tests, old and new.

- [ ] **Step 5: Build and lint**

Run: `npm run build && npx biome check --write .`

- [ ] **Step 6: Commit**

```bash
git add src/renderer.html src/renderer.html.test.ts
git commit -m "Render subdirectory group boxes in the interactive HTML view (#28)"
```

---

### Task 5: Restructure `sample-app`'s dashboard fixture to demonstrate the feature

**Files:**
- Modify: `sample-app/src/app/features/dashboard/dashboard.component.ts`
- Move: `sample-app/src/app/features/dashboard/dashboard-card.component.ts` → `sample-app/src/app/features/dashboard/widgets/dashboard-card.component.ts`
- Move: `sample-app/src/app/features/dashboard/dashboard-chart.component.ts` → `sample-app/src/app/features/dashboard/widgets/dashboard-chart.component.ts`
- Move: `sample-app/src/app/features/dashboard/dashboard-settings.component.ts` → `sample-app/src/app/features/dashboard/settings/dashboard-settings.component.ts`
- Create: `sample-app/src/app/features/dashboard/settings/preferences/dashboard-notification-prefs.component.ts`
- Delete: `sample-app-base/src/app/features/dashboard/dashboard-card.component.ts`

**Rationale (from the design spec):** `sample-app`'s dashboard feature is currently flat (no subdirectories), so it can't demonstrate this feature in `docs/sample.svg`. This restructuring gives it: 3 files at the feature root (`dashboard.component.ts`, `dashboard-stats.component.ts`, and `dashboard-nav.component.ts` — the last exists only in the base branch, so it renders as a removed ghost), a `widgets/` subdirectory with 2 files (both added), and a `settings/` subdirectory with 1 root file (added) plus a nested `settings/preferences/` file (added) — exercising the "nested two levels deep still groups under the first-level subdirectory" case. `sample-app-base` needs only one change: deleting its root-level `dashboard-card.component.ts`, so the relocated `dashboard-card` reads as a clean "added" file at its new path rather than a spurious move (`diffGraphs` matches by exact file path — relocating a file without a matching base-side move always reads as remove-at-old-path + add-at-new-path, which is expected, documented `diffGraphs` behavior, not something this task changes).

There is no automated test for this task — `sample-app` is a demo fixture, not covered by any test suite (confirmed by `README.md`: "Not used by any automated test"). Verification is visual, via Task 6.

- [ ] **Step 1: Move and delete files**

```bash
mkdir -p sample-app/src/app/features/dashboard/widgets
mkdir -p sample-app/src/app/features/dashboard/settings/preferences
git mv sample-app/src/app/features/dashboard/dashboard-card.component.ts sample-app/src/app/features/dashboard/widgets/dashboard-card.component.ts
git mv sample-app/src/app/features/dashboard/dashboard-chart.component.ts sample-app/src/app/features/dashboard/widgets/dashboard-chart.component.ts
git mv sample-app/src/app/features/dashboard/dashboard-settings.component.ts sample-app/src/app/features/dashboard/settings/dashboard-settings.component.ts
git rm sample-app-base/src/app/features/dashboard/dashboard-card.component.ts
```

- [ ] **Step 2: Fix the relative import in the moved `dashboard-card.component.ts`**

Set `sample-app/src/app/features/dashboard/widgets/dashboard-card.component.ts` to:

```typescript
import { CommonModule } from "@angular/common";
import { Component, Input } from "@angular/core";
import type { CardConfig } from "../../../shared/models/card-config.model";

@Component({
	selector: "app-dashboard-card",
	standalone: true,
	imports: [CommonModule],
	template: `
    <div class="dashboard-card">
      <span class="dashboard-card__title">{{ config.title }}</span>
    </div>
  `,
})
export class DashboardCardComponent {
	@Input() config!: CardConfig;
}
```

- [ ] **Step 3: Fix the relative import in the moved `dashboard-chart.component.ts`**

Set `sample-app/src/app/features/dashboard/widgets/dashboard-chart.component.ts` to:

```typescript
import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { ChartPoint } from "../../../shared/models/chart-point.model";

@Component({
	selector: "app-dashboard-chart",
	standalone: true,
	imports: [CommonModule],
	template: `
    <div class="dashboard-chart">
      <span *ngFor="let p of points">{{ p.x }},{{ p.y }}</span>
    </div>
  `,
})
export class DashboardChartComponent {
	points: ChartPoint[] = [new ChartPoint(0, 0), new ChartPoint(1, 4)];
}
```

- [ ] **Step 4: Update the moved `dashboard-settings.component.ts` — fix its import and add the new nested preferences component**

Set `sample-app/src/app/features/dashboard/settings/dashboard-settings.component.ts` to:

```typescript
import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { ThemeService } from "../../../shared/services/theme.service";
import { DashboardNotificationPrefsComponent } from "./preferences/dashboard-notification-prefs.component";

@Component({
	selector: "app-dashboard-settings",
	standalone: true,
	imports: [CommonModule, DashboardNotificationPrefsComponent],
	providers: [ThemeService],
	template: `
    <div class="dashboard-settings">
      <button type="button" (click)="toggleTheme()">Toggle theme</button>
      <app-dashboard-notification-prefs />
    </div>
  `,
})
export class DashboardSettingsComponent {
	constructor(private theme: ThemeService) {}

	toggleTheme(): void {
		this.theme.set(this.theme.get() === "dark" ? "light" : "dark");
	}
}
```

- [ ] **Step 5: Create the new nested preferences component**

Create `sample-app/src/app/features/dashboard/settings/preferences/dashboard-notification-prefs.component.ts`:

```typescript
import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";

@Component({
	selector: "app-dashboard-notification-prefs",
	standalone: true,
	imports: [CommonModule],
	template: `
    <div class="notification-prefs">
      <label>
        <input type="checkbox" checked />
        Email me weekly summaries
      </label>
    </div>
  `,
})
export class DashboardNotificationPrefsComponent {}
```

- [ ] **Step 6: Update `dashboard.component.ts`'s import paths**

Set `sample-app/src/app/features/dashboard/dashboard.component.ts` to:

```typescript
import { CommonModule } from "@angular/common";
import { Component } from "@angular/core";
import { DashboardStatsComponent } from "./dashboard-stats.component";
import { DashboardSettingsComponent } from "./settings/dashboard-settings.component";
import { DashboardChartComponent } from "./widgets/dashboard-chart.component";

@Component({
	selector: "app-dashboard",
	standalone: true,
	imports: [
		CommonModule,
		DashboardStatsComponent,
		DashboardChartComponent,
		DashboardSettingsComponent,
	],
	template: `
    <div class="dashboard">
      <app-dashboard-stats />
      <app-dashboard-chart />
      <app-dashboard-settings />
    </div>
  `,
})
export class DashboardComponent {}
```

- [ ] **Step 7: Verify the fixture parses correctly**

Run: `npm run build && npm run diagram:sample`
Expected: exits 0, prints a line like `Diff: N added, 1 modified, 1 removed` (exact added count isn't asserted by this plan — the new `sample-app-base` output showing `dashboard-card` correctly as `added`, not causing an error, is what this step checks). Then run:

```bash
grep -c '>widgets<\|>settings<' dist/diagram.svg
```

Expected: prints `2` (one occurrence of each label somewhere in the SVG — the label text elements added in Task 2).

- [ ] **Step 8: Commit**

```bash
git add sample-app sample-app-base
git commit -m "Restructure sample-app dashboard fixture to demonstrate subdirectory grouping (#28)"
```

---

### Task 6: Update visual regression baseline

**Files:**
- Modify: `src/renderer/visual.test.ts`
- Modify (generated, not hand-edited): `test/snapshots/reference/diff-focused.png`, `test/snapshots/reference/all-nodes.png`

**Interfaces:**
- Consumes: `computeLayout`'s new `scopeDir` parameter (Task 1); nothing produced for later tasks.

**Why this is needed:** `visual.test.ts`'s `buildSvg()` helper currently calls `computeLayout(nodes, edges, "src/app")` without a `scopeDir`, so the visual regression suite has never exercised subdirectory grouping even after Tasks 1–4 land — the shipped CLI (which now always passes `scopeDir`, per Task 3) would render differently than what this suite tests. This task closes that gap, which also means the existing reference snapshots (rendered without subdir boxes) will now legitimately mismatch and need approving as the new baseline — this is the one visual change in the whole plan (all other tasks are additive/backward-compatible when `scopeDir` is omitted, so nothing else could invalidate a snapshot rendered without it).

- [ ] **Step 1: Update `buildSvg` to pass `scopeDir`**

In `src/renderer/visual.test.ts`, find `async function buildSvg`. Change:

```typescript
	const layout = await computeLayout(nodes, edges, "src/app");
```

to:

```typescript
	const layout = await computeLayout(nodes, edges, "src/app", diffed.meta.scopeDir);
```

- [ ] **Step 2: Run the visual regression suite to confirm it now fails**

Run: `npm run test:visual`
Expected: FAIL — `diff-focused` and `all-nodes` both mismatch the existing reference PNGs (pixelmatch diff > 0), because `fake-angular-app`'s 9 real subdirectories now render group boxes that weren't there before.

- [ ] **Step 3: Visually review the new output before approving**

Open `test/snapshots/current/diff-focused.png` and `test/snapshots/current/all-nodes.png` directly (e.g. with the Read tool, which renders PNGs visually, or any image viewer) and confirm:
- Subdirectory boxes appear around `user-list/`, `user-settings/`, `data-access/`, `models/`, `shared-ui/`, `user-detail/`, `user-edit/`, `user-export/`, `user-permissions/` (9 total, per `fake-angular-app`'s real directory structure).
- No box overlaps another box or the outer feature container.
- Every edge is drawn (no edge silently missing where a node crosses into or out of a subdirectory box — this was a real bug caught during spiking; if any edge looks like it's missing, stop and investigate `elk.hierarchyHandling` in `layout.ts` before proceeding).

Do not proceed to Step 4 until this visual check passes. This is a judgment call, not a scriptable assertion — that's exactly why it's a separate step instead of folded into the automated test.

- [ ] **Step 4: Approve the new snapshots**

Run: `npm run test:visual:approve`
Expected: copies `test/snapshots/current/*.png` over `test/snapshots/reference/*.png`.

- [ ] **Step 5: Re-run the visual suite to confirm it now passes**

Run: `npm run test:visual`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/visual.test.ts test/snapshots/reference/diff-focused.png test/snapshots/reference/all-nodes.png
git commit -m "Update visual regression baseline for subdirectory group boxes (#28)"
```

**Note for whoever opens the PR:** call out in the PR body that `test/snapshots/reference/*.png` were regenerated and need image review, per this repo's standing rule for any intentional rendering change.

---

### Task 7: Update `README.md` and `docs/architecture.md`

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Add a legend row to `README.md`**

In the "Reading the diagram" table (the one starting `| Element | Meaning |`), add a new row immediately after the existing `| Outlined box around the in-scope files | ... |` row:

```markdown
| Dashed subtle box inside the feature container | Files grouped by first-level subdirectory (e.g. `user-list/`); files at the feature root get no box |
```

- [ ] **Step 2: Update the `sample-app` fixture description in `README.md`**

Find this paragraph (under `## Fixture apps`):

```markdown
Fixture diff: designed so `npm run diagram:sample` produces one diagram containing every visual element the renderer can produce (added/modified/removed/unchanged nodes, out-of-scope and type-only dependencies, test/story markers). Not used by any automated test.
```

Replace it with:

```markdown
Fixture diff: designed so `npm run diagram:sample` produces one diagram containing every visual element the renderer can produce (added/modified/removed/unchanged nodes, out-of-scope and type-only dependencies, test/story markers, and subdirectory group boxes). The dashboard feature has 3 files at its root, a `widgets/` subdirectory (2 files), and a `settings/` subdirectory (1 root file plus a nested `settings/preferences/` file, demonstrating that nested files still group under their first-level subdirectory). Not used by any automated test.
```

- [ ] **Step 3: Document the algorithm in `docs/architecture.md`**

Find the `### \`src/renderer/layout.ts\`` section. Replace its contents (everything between that heading and the next `###` heading) with:

```markdown
### `src/renderer/layout.ts`

**`computeLayout(nodes, edges, sourceRoot?, scopeDir?)`** — async elkjs wrapper. Takes `GraphNode[]` and `GraphEdge[]`, returns `Layout` with `{ nodes: LayoutNode[], edges: LayoutEdge[], width, height, container?, subdirContainers? }`.

ELK settings: `layered` algorithm, `RIGHT` direction, 20px node spacing, 40px layer spacing, 20px padding.

Node dimensions: regular nodes 140×40px, stub nodes 120×32px.

Uses `createRequire` to import elkjs (CJS module in an ESM project).

LayoutEdge sections contain `startPoint`, `endPoint`, and optional `bendPoints` — these are the raw ELK output coordinates used for bezier path rendering.

**Subdirectory grouping (`scopeDir` parameter, issue #28):** when given, each in-scope node's first-level subdirectory under `scopeDir` becomes a real ELK compound node (`children: [...]`), instead of a flat sibling of the root graph — the same relative-path computation `computeViewNodes` uses for its own subdir grouping (`path.relative(scopeDir, node.file)`, first path segment; deeper nesting folds into that same first-level key). ELK's hierarchical layout sizes and positions each compound node from its own children, so non-overlap between subdir boxes is a structural guarantee, not inferred from post-layout positions. Two things this depends on:
- **Edge placement follows ELK's lowest-common-ancestor rule.** In this 2-level hierarchy (root → subdir container → file), an edge whose endpoints share a subdirectory is declared on that subdirectory's own `edges` array; every other edge (cross-subdirectory, touching a root-level node, or touching an out-of-scope node) is declared on the root graph's `edges` array.
- **`elk.hierarchyHandling: INCLUDE_CHILDREN`** must be set on the root graph whenever subdir groups are used, or ELK silently returns 0 sections (no routing at all) for any edge crossing a subdirectory boundary.

After `elk.layout()`, the result tree is flattened recursively back to absolute canvas coordinates — ELK returns each child's `x`/`y` relative to its own parent's origin, and edge sections declared on a compound node are in that same local frame, so both need the accumulated parent offset added during the walk.

An ELK-partitioning-based alternative (one partition per subdirectory, reusing the in-scope/out-of-scope partition trick below) was tried first and rejected: it only reliably orders nodes when there are 2 partitions and a guaranteed direction between them; with N independent subdirectories and no such direction, weakly-connected nodes fall back to normal longest-path layering and partition membership stops correlating with position, producing boxes that overlapped and enclosed unrelated nodes. See `docs/superpowers/specs/2026-07-30-subdir-grouping-design.md` for the full comparison.

When both in-scope and out-of-scope nodes exist, ELK partitioning is enabled for the outer container: in-scope nodes (and any subdirectory container) get partition 0, out-of-scope partition 1. This forces ELK to place in-scope content in earlier (leftward) layers than oos nodes, guaranteeing no oos node falls inside the in-scope bounding box. This part is unchanged by subdirectory grouping.
```

- [ ] **Step 4: Regenerate the sample diagram**

Run: `npm run build && npm run diagram:sample`
Expected: exits 0, updates `docs/sample.svg` in place (this should already reflect Task 5's fixture and Task 1–4's rendering — this step just re-confirms it's current after the doc edits).

- [ ] **Step 5: Commit**

```bash
git add README.md docs/architecture.md docs/sample.svg
git commit -m "Document subdirectory grouping in README and architecture.md (#28)"
```

---

### Task 8: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full verify suite**

Run: `npm run verify`
Expected: PASS — build, lint, unit tests, and visual tests all succeed with zero failures.

- [ ] **Step 2: Manual smoke test against both fixtures**

```bash
node dist/cli.js --repo-root fake-angular-app --base-repo-root fake-angular-app-base --out-dir /tmp/dd-smoke src/app/features/users
```

Open `/tmp/dd-smoke/diagram.html` in a browser (or via the Read tool on a rasterized screenshot) and confirm both view modes (All nodes / Diff-focused) show subdirectory boxes, hover-highlighting still works, and no box overlaps another.

- [ ] **Step 3: Squash for PR**

This plan's tasks were committed incrementally (Tasks 1–7, one commit each). Before opening a PR, squash them into a single commit, per this repo's one-commit-per-PR rule:

```bash
git log --oneline main..HEAD
```

Confirm the list matches Tasks 1–7's commit messages, then:

```bash
git reset --soft main
git commit -m "Add subdirectory grouping inside the scope container (#28)"
```

- [ ] **Step 4: Open the PR**

Follow the project's PR conventions (see `CLAUDE.md`). Call out in the PR body that `test/snapshots/reference/*.png` were regenerated and should be reviewed as images, per the repo's standing rule for intentional rendering changes.
