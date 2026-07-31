# Change Magnitude Styling, Take Two — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make changed nodes visually convey *how much* they changed (issue #27), fed by a real line-level diff instead of the flawed net line-count delta PR #40 used, with fixtures that actually demonstrate the resulting gradient.

**Architecture:** `diffGraphs` (in `src/diff-parser.ts`) computes a real per-node `linesChanged` count using the `diff` npm package, then scales it into a relative `magnitude` (0–1) via a new pure `applyChangeMagnitude` helper. Both renderers (`src/renderer/draw.ts` for static SVG, `src/renderer.html` for the interactive view) lerp each changed node's fill color from the unchanged fill toward its full diff-state fill by that magnitude, leaving stroke color fixed. `src/cli.ts` threads the two new fields through to the embedded HTML data. Fixtures get a substantially expanded modified file and one small added file so the gradient has visible range to review.

**Tech Stack:** TypeScript, Vitest, the `diff` npm package (jsdiff) for line-level diffing, Biome for lint/format.

## Global Constraints

- **Design spec:** `docs/superpowers/specs/2026-07-30-change-magnitude-design.md` (landing in this same PR) — read this first if anything below is ambiguous; it has the full rationale, including why a line-count delta is wrong and why magnitude excludes out-of-scope nodes from its relative-max computation.
- **One commit per PR** (this repo enforces it with a PreToolUse hook that blocks `gh pr create` on branches more than one commit ahead of base — see project `CLAUDE.md`). **Do not commit after each task below.** Stage changes as you go (`git add`) if you want checkpoints, but the *only* `git commit` in this plan is the last step of Task 7.
- **Branch:** already created — `feat/change-magnitude-v2`, checked out in the worktree at `.claude/worktrees/change-magnitude-v2-impl`. Work there; do not create another worktree.
- **Never use `--no-verify`.** The pre-commit hook runs `npm run verify` (build + biome check + unit tests + visual tests + sample drift check) — if it fails, fix the underlying issue.
- **Formatting:** this repo uses Biome with tabs for indentation in `.ts` files (not inside template-literal strings, which preserve their own literal whitespace). **Import order is enforced as an error by `biome check`** (the `assist/source/organizeImports` rule) and is *not* fixed by `npm run format` (formatter-only) — after adding or reordering imports in any file, run `npx biome check --write <file>` to auto-sort them before running tests.
- **`npm install` side effect:** `package.json` has no top-level `"name"` field, so `npm install` derives `package-lock.json`'s `name` from the current directory's basename. Since this worktree's directory is `change-magnitude-v2-impl` (not `diff-diagram`), running `npm install` will rewrite `package-lock.json`'s `"name"` field to `"change-magnitude-v2-impl"`. After running `npm install` (Task 1, Step 1), check `git diff package-lock.json` for a `"name"` line change and revert just that line back to `"diff-diagram"` if present, before staging.
- **PR #40 is already closed** (superseded, closed with an explanatory comment). Nothing to do there.

---

## File Structure

- `package.json`, `package-lock.json` — add `diff` runtime dependency
- `src/types.ts` — `GraphNode` gains `linesChanged?: number`, `magnitude?: number`
- `src/diff-parser.ts` — `diffGraphs` computes `linesChanged` per node; new exported `applyChangeMagnitude(nodes)` pure helper computes relative `magnitude`
- `src/diff-parser.test.ts` — tests for both
- `src/renderer/draw.ts` — new exported `lerpHex(from, to, t)`; `nodeColor()` uses it when a node has a `magnitude`
- `src/renderer/draw.test.ts` — tests for both
- `src/renderer.html` — mirrors `lerpHex`/magnitude-aware fill in the client script; new legend row
- `src/renderer.html.test.ts` — DOM test for the magnitude-scaled fill and the legend row
- `src/cli.ts` — `ModeData.nodes[]` gains `linesChanged?`/`magnitude?`; `buildModeData` passes them through
- `src/cli.test.ts` — end-to-end test that `graph.json` and `diagram.html` carry the new fields
- `fake-angular-app/src/app/features/users/user-list/users-list.component.ts` — expanded modified-file fixture (wires up previously-unused sort/selection utilities)
- `fake-angular-app/src/app/features/users/user-settings/security-session.model.ts` — new small added-file fixture (5 lines)
- `test/snapshots/reference/diff-focused.png`, `test/snapshots/reference/all-nodes.png` — regenerated visual snapshots
- `docs/architecture.md`, `docs/spec.md`, `README.md`, `CLAUDE.md` — updated docs

---

### Task 1: `diffGraphs` computes `linesChanged` and relative `magnitude`

**Files:**
- Modify: `package.json`, `package-lock.json` (via `npm install`)
- Modify: `src/types.ts`
- Modify: `src/diff-parser.ts`
- Test: `src/diff-parser.test.ts`

**Interfaces:**
- Produces: `GraphNode.linesChanged?: number`, `GraphNode.magnitude?: number`; `export function applyChangeMagnitude(nodes: GraphNode[]): GraphNode[]` (used by Task 2/3's renderers via the `magnitude` field they read off each node — no direct import needed elsewhere).

- [ ] **Step 1: Install the `diff` dependency**

Run: `npm install diff@^9.0.0`

Then check `git diff package-lock.json` — if the top-level `"name"` field changed to anything other than `"diff-diagram"`, revert just that line (see Global Constraints).

- [ ] **Step 2: Write failing tests for `linesChanged`**

Add to `src/diff-parser.test.ts`, after the existing `describe("diffGraphs — edge modified state", ...)` block (i.e. at the end of the file):

```typescript
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/diff-parser.test.ts`
Expected: FAIL — 4 new failures, `linesChanged` is `undefined` on all of them (property doesn't exist yet).

- [ ] **Step 4: Add the new fields to `GraphNode`**

In `src/types.ts`, the `GraphNode` interface currently ends with (lines 16–31):

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

Replace it with:

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
	 * Lines changed vs. the base branch: the file's own line count for
	 * added/removed nodes, a real line-level diff count for modified nodes,
	 * 0 for unchanged. Set by diffGraphs; absent in single-branch mode (no
	 * base to diff against).
	 */
	linesChanged?: number;
	/**
	 * linesChanged scaled to [0, 1], relative to the most-changed node among
	 * those that render a magnitude fill (in-scope and removed-ghost nodes).
	 * Set by applyChangeMagnitude; absent on out-of-scope and unchanged nodes.
	 */
	magnitude?: number;
	/**
	 * Internal only: the file's raw text, used by diffGraphs to detect content
	 * changes. Never serialized — stripped from graph.json before it's written.
	 */
	_content?: string;
}
```

- [ ] **Step 5: Implement `linesChanged` in `diffGraphs`**

In `src/diff-parser.ts`, add the import and two private helpers right after the existing import line (line 1):

```typescript
import { diffLines } from "diff";
import type { Graph, GraphEdge, GraphNode } from "./types.js";

function lineCount(content: string | undefined): number {
	return (content ?? "").split("\n").length;
}

function countChangedLines(
	base: string | undefined,
	current: string | undefined,
): number {
	return diffLines(base ?? "", current ?? "")
		.filter((change) => change.added || change.removed)
		.reduce((sum, change) => sum + change.count, 0);
}
```

Then replace the node-classification block (currently):

```typescript
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

	// Ghost nodes for removed in-scope files (not out-of-scope — those just disappear)
	for (const node of base.nodes) {
		if (node.scope === "out-of-scope") continue;
		if (!currentByFile.has(node.file)) {
			diffedNodes.push({ ...node, scope: "removed-ghost", diff: "removed" });
		}
	}
```

with:

```typescript
	for (const node of current.nodes) {
		if (!baseByFile.has(node.file)) {
			diffedNodes.push({
				...node,
				diff: "added",
				linesChanged: lineCount(node._content),
			});
		} else {
			// biome-ignore lint/style/noNonNullAssertion: guarded by baseByFile.has() in the if-branch above
			const baseNode = baseByFile.get(node.file)!;
			const changed = baseNode._content !== node._content;
			diffedNodes.push({
				...node,
				diff: changed ? "modified" : "unchanged",
				linesChanged: changed
					? countChangedLines(baseNode._content, node._content)
					: 0,
			});
		}
	}

	// Ghost nodes for removed in-scope files (not out-of-scope — those just disappear)
	for (const node of base.nodes) {
		if (node.scope === "out-of-scope") continue;
		if (!currentByFile.has(node.file)) {
			diffedNodes.push({
				...node,
				scope: "removed-ghost",
				diff: "removed",
				linesChanged: lineCount(node._content),
			});
		}
	}
```

- [ ] **Step 6: Sort the new import and run tests**

Run: `npx biome check --write src/diff-parser.ts`
Run: `npx vitest run src/diff-parser.test.ts`
Expected: PASS — all tests including the 4 new ones.

- [ ] **Step 7: Write failing tests for `applyChangeMagnitude`**

Add to `src/diff-parser.test.ts`, after the `describe("diffGraphs — linesChanged", ...)` block:

```typescript
// ─── applyChangeMagnitude ──────────────────────────────────────────────────────

describe("applyChangeMagnitude", () => {
	it("scales linesChanged relative to the max among eligible nodes", () => {
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
});
```

Also add `applyChangeMagnitude` to the import at the top of the test file — change:

```typescript
import { diffGraphs } from "./diff-parser.js";
```

to:

```typescript
import { applyChangeMagnitude, diffGraphs } from "./diff-parser.js";
```

- [ ] **Step 8: Run tests to verify they fail**

Run: `npx vitest run src/diff-parser.test.ts`
Expected: FAIL — 6 new failures (`applyChangeMagnitude` is not exported yet).

- [ ] **Step 9: Implement `applyChangeMagnitude`**

In `src/diff-parser.ts`, add after the closing brace of `diffGraphs` (i.e. after the final `}` that currently ends the file):

```typescript

// ─── applyChangeMagnitude ───────────────────────────────────────────────────
// Scales each changed node's linesChanged relative to the most-changed node
// among those that will actually render a magnitude fill (in-scope and
// removed-ghost — see docs/superpowers/specs/2026-07-30-change-magnitude-
// design.md). Out-of-scope nodes keep linesChanged but never get a magnitude,
// so a large unrelated OOS diff can't flatten every in-scope magnitude.

function isMagnitudeEligible(node: GraphNode): boolean {
	return (
		(node.scope === "in-scope" || node.scope === "removed-ghost") &&
		node.diff !== null &&
		node.diff !== "unchanged"
	);
}

export function applyChangeMagnitude(nodes: GraphNode[]): GraphNode[] {
	const max = nodes
		.filter(isMagnitudeEligible)
		.reduce((m, n) => Math.max(m, n.linesChanged ?? 0), 0);

	return nodes.map((node) => {
		if (!isMagnitudeEligible(node)) return node;
		return {
			...node,
			magnitude: max > 0 ? (node.linesChanged ?? 0) / max : 1,
		};
	});
}
```

Then wire it into `diffGraphs`'s return statement. Currently:

```typescript
	return {
		...current,
		meta: {
			...current.meta,
			nodeCount: diffedNodes.length,
			edgeCount: diffedEdges.length,
		},
		nodes: diffedNodes,
		edges: diffedEdges,
	};
}
```

Replace with:

```typescript
	const nodesWithMagnitude = applyChangeMagnitude(diffedNodes);

	return {
		...current,
		meta: {
			...current.meta,
			nodeCount: nodesWithMagnitude.length,
			edgeCount: diffedEdges.length,
		},
		nodes: nodesWithMagnitude,
		edges: diffedEdges,
	};
}
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npx vitest run src/diff-parser.test.ts`
Expected: PASS — all tests, including the 6 new `applyChangeMagnitude` tests.

- [ ] **Step 11: Full build and stage**

Run: `npm run build`
Expected: no TypeScript errors.

Run: `git add package.json package-lock.json src/types.ts src/diff-parser.ts src/diff-parser.test.ts`

(Do not commit — see Global Constraints.)

---

### Task 2: Magnitude-aware fill in the static SVG renderer

**Files:**
- Modify: `src/renderer/draw.ts`
- Test: `src/renderer/draw.test.ts`

**Interfaces:**
- Consumes: `GraphNode.magnitude?: number` (Task 1)
- Produces: `export function lerpHex(from: string, to: string, t: number): string`

- [ ] **Step 1: Write failing tests**

Add to `src/renderer/draw.test.ts`, after the closing brace of the `describe("nodeColor", ...)` block:

```typescript
// ─── lerpHex ─────────────────────────────────────────────────────────────────

describe("lerpHex", () => {
	it("returns the from color at t=0", () => {
		expect(lerpHex("#000000", "#ffffff", 0)).toBe("#000000");
	});

	it("returns the to color at t=1", () => {
		expect(lerpHex("#000000", "#ffffff", 1)).toBe("#ffffff");
	});

	it("returns the midpoint color at t=0.5", () => {
		expect(lerpHex("#000000", "#ffffff", 0.5)).toBe("#808080");
	});

	it("clamps t below 0", () => {
		expect(lerpHex("#000000", "#ffffff", -1)).toBe("#000000");
	});

	it("clamps t above 1", () => {
		expect(lerpHex("#000000", "#ffffff", 2)).toBe("#ffffff");
	});
});

// ─── nodeColor — magnitude ─────────────────────────────────────────────────────

describe("nodeColor — magnitude", () => {
	it("scales fill toward the diff color by magnitude, leaving stroke fixed", () => {
		const low = nodeColor(node("a", { diff: "added", magnitude: 0.1 }));
		const high = nodeColor(node("a", { diff: "added", magnitude: 1 }));
		expect(high.fill).toBe("#14532d"); // full intensity at magnitude 1
		expect(low.fill).toBe(lerpHex("#1e293b", "#14532d", 0.1));
		expect(low.stroke).toBe(high.stroke);
		expect(low.stroke).toBe("#22c55e");
	});

	it("falls back to the flat diff fill when magnitude is absent", () => {
		const { fill } = nodeColor(node("a", { diff: "modified" }));
		expect(fill).toBe("#78350f");
	});

	it("out-of-scope node ignores magnitude entirely", () => {
		const { fill } = nodeColor(
			node("a", { scope: "out-of-scope", diff: "added", magnitude: 0.1 }),
		);
		expect(fill).toBe("#0a1829");
	});
});
```

Update the import line at the top of the file — change:

```typescript
import { edgeStroke, nodeColor, toSvg, truncateLabel } from "./draw.js";
```

to:

```typescript
import { edgeStroke, lerpHex, nodeColor, toSvg, truncateLabel } from "./draw.js";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer/draw.test.ts`
Expected: FAIL — `lerpHex` is not exported yet; magnitude tests get the flat (non-lerped) fill.

- [ ] **Step 3: Implement `lerpHex`**

In `src/renderer/draw.ts`, add after the color palette constants (after the `TEST_DOT`/`STORY_DOT` declarations, before the `// ─── Label truncation` comment, i.e. after line 34):

```typescript
// ─── Color interpolation ──────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } {
	const n = Number.parseInt(hex.slice(1), 16);
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
	return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function lerpHex(from: string, to: string, t: number): string {
	const clamped = Math.min(1, Math.max(0, t));
	const a = hexToRgb(from);
	const b = hexToRgb(to);
	return rgbToHex(
		Math.round(a.r + (b.r - a.r) * clamped),
		Math.round(a.g + (b.g - a.g) * clamped),
		Math.round(a.b + (b.b - a.b) * clamped),
	);
}
```

- [ ] **Step 4: Update `nodeColor` to use it**

Currently (lines 49–57):

```typescript
export function nodeColor(node: GraphNode): { fill: string; stroke: string } {
	if (node.scope === "out-of-scope" || node.type === "stub") {
		return node.scope === "out-of-scope"
			? { fill: OOS_FILL, stroke: OOS_STROKE }
			: { fill: "#0f172a", stroke: "#334155" };
	}
	const diff = node.diff ?? "unchanged";
	return { fill: NODE_FILL[diff], stroke: NODE_STROKE[diff] };
}
```

Replace with:

```typescript
export function nodeColor(node: GraphNode): { fill: string; stroke: string } {
	if (node.scope === "out-of-scope" || node.type === "stub") {
		return node.scope === "out-of-scope"
			? { fill: OOS_FILL, stroke: OOS_STROKE }
			: { fill: "#0f172a", stroke: "#334155" };
	}
	const diff = node.diff ?? "unchanged";
	const fill =
		node.magnitude !== undefined
			? lerpHex(NODE_FILL.unchanged, NODE_FILL[diff], node.magnitude)
			: NODE_FILL[diff];
	return { fill, stroke: NODE_STROKE[diff] };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer/draw.test.ts`
Expected: PASS — all tests, including the new `lerpHex` and magnitude tests.

- [ ] **Step 6: Build and stage**

Run: `npm run build`
Run: `git add src/renderer/draw.ts src/renderer/draw.test.ts`

---

### Task 3: Mirror magnitude fill in the interactive HTML renderer + legend

**Files:**
- Modify: `src/renderer.html`
- Test: `src/renderer.html.test.ts`

**Interfaces:**
- Consumes: `magnitude?: number` on embedded node data (set by Task 4's `buildModeData`, but this task's tests supply it directly via fixture data — no ordering dependency on Task 4)

- [ ] **Step 1: Write failing tests**

In `src/renderer.html.test.ts`, change `loadDiagram` to accept an optional fixture override — currently:

```typescript
async function loadDiagram() {
	const template = await readFile(
		new URL("./renderer.html", import.meta.url),
		"utf8",
	);
	const html = template.replace(
		"__DIFF_DIAGRAM_DATA__",
		JSON.stringify(FIXTURE),
	);
```

Replace with:

```typescript
async function loadDiagram(data: unknown = FIXTURE) {
	const template = await readFile(
		new URL("./renderer.html", import.meta.url),
		"utf8",
	);
	const html = template.replace(
		"__DIFF_DIAGRAM_DATA__",
		JSON.stringify(data),
	);
```

(the rest of the function body is unchanged).

Then add, at the end of the file:

```typescript

describe("renderer.html change magnitude", () => {
	const MAGNITUDE_FIXTURE = {
		meta: { scopeDir: "src/app/features/users" },
		sourceRoot: "src/app",
		modes: {
			all: {
				nodes: [
					{ ...node("low", "added", 10), magnitude: 0.1 },
					{ ...node("high", "added", 150), magnitude: 1 },
				],
				edges: [],
				width: 300,
				height: 120,
			},
			diffFocused: {
				nodes: [
					{ ...node("low", "added", 10), magnitude: 0.1 },
					{ ...node("high", "added", 150), magnitude: 1 },
				],
				edges: [],
				width: 300,
				height: 120,
			},
		},
	};

	it("scales a changed node's fill by magnitude instead of using the flat diff color", async () => {
		const window = await loadDiagram(MAGNITUDE_FIXTURE);
		const rects = [...window.document.querySelectorAll(".node-group rect")];
		const lowFill = rects[0].getAttribute("fill");
		const highFill = rects[1].getAttribute("fill");
		expect(highFill).toBe("#14532d");
		expect(lowFill).not.toBe("#14532d");
		expect(lowFill).not.toBe("#1e293b");
	});

	it("includes a change-magnitude legend row", async () => {
		const window = await loadDiagram();
		expect(window.document.body.textContent).toContain("Change magnitude");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/renderer.html.test.ts`
Expected: FAIL — fill is not scaled by magnitude yet; no "Change magnitude" text in the sidebar yet.

- [ ] **Step 3: Implement `lerpHex` and magnitude-aware `nodeFill` in the client script**

In `src/renderer.html`, the color palette and fill functions currently read (lines 96–102):

```javascript
const NODE_FILL   = { added: '#14532d', modified: '#78350f', removed: '#7f1d1d', unchanged: '#1e293b' };
const NODE_STROKE = { added: '#22c55e', modified: '#f59e0b', removed: '#ef4444', unchanged: '#475569' };
const EDGE_STROKE = { added: '#22c55e', modified: '#f59e0b', removed: '#ef4444', unchanged: '#475569' };

function nodeFill(n)   { if (n.scope==='out-of-scope') return '#0a1829'; if (n.type==='stub') return '#0f172a'; return NODE_FILL[n.diff]  || NODE_FILL.unchanged; }
function nodeStroke(n) { if (n.scope==='out-of-scope') return '#1e3a5f'; if (n.type==='stub') return '#334155'; return NODE_STROKE[n.diff] || NODE_STROKE.unchanged; }
function edgeColor(d)  { return EDGE_STROKE[d] || EDGE_STROKE.unchanged; }
```

Replace with:

```javascript
const NODE_FILL   = { added: '#14532d', modified: '#78350f', removed: '#7f1d1d', unchanged: '#1e293b' };
const NODE_STROKE = { added: '#22c55e', modified: '#f59e0b', removed: '#ef4444', unchanged: '#475569' };
const EDGE_STROKE = { added: '#22c55e', modified: '#f59e0b', removed: '#ef4444', unchanged: '#475569' };

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}
function lerpHex(from, to, t) {
  const clamped = Math.min(1, Math.max(0, t));
  const a = hexToRgb(from), b = hexToRgb(to);
  return rgbToHex(
    Math.round(a.r + (b.r - a.r) * clamped),
    Math.round(a.g + (b.g - a.g) * clamped),
    Math.round(a.b + (b.b - a.b) * clamped),
  );
}

function nodeFill(n) {
  if (n.scope==='out-of-scope') return '#0a1829';
  if (n.type==='stub') return '#0f172a';
  const base = NODE_FILL[n.diff] || NODE_FILL.unchanged;
  return n.magnitude !== undefined ? lerpHex(NODE_FILL.unchanged, base, n.magnitude) : base;
}
function nodeStroke(n) { if (n.scope==='out-of-scope') return '#1e3a5f'; if (n.type==='stub') return '#334155'; return NODE_STROKE[n.diff] || NODE_STROKE.unchanged; }
function edgeColor(d)  { return EDGE_STROKE[d] || EDGE_STROKE.unchanged; }
```

- [ ] **Step 4: Add the legend row**

In the `Node Legend` card, currently (lines 61–70):

```html
    <div class="legend">
      <div class="legend-row"><div class="swatch" style="background:#14532d;border:1.5px solid #22c55e"></div>Added</div>
      <div class="legend-row"><div class="swatch" style="background:#78350f;border:1.5px solid #f59e0b"></div>Modified</div>
      <div class="legend-row"><div class="swatch" style="background:#7f1d1d;border:1.5px dashed #ef4444"></div>Removed (ghost)</div>
      <div class="legend-row"><div class="swatch" style="background:#1e293b;border:1.5px solid #475569"></div>Unchanged</div>
      <div class="legend-row"><div class="swatch" style="background:#0a1829;border:1.5px solid #1e3a5f"></div>External (1-hop)</div>
      <div class="legend-row"><div class="swatch" style="background:#0f172a;border:1px dashed #334155"></div>Collapsed dir</div>
      <div class="legend-row"><svg aria-hidden="true" width="16" height="16" style="margin-right:8px;flex-shrink:0"><circle cx="8" cy="8" r="4" fill="#22c55e"/></svg>Has unit test</div>
      <div class="legend-row"><svg aria-hidden="true" width="16" height="16" style="margin-right:8px;flex-shrink:0"><circle cx="8" cy="8" r="4" fill="#a855f7"/></svg>Has Storybook story</div>
    </div>
```

Add a new row after "Unchanged" and before "External (1-hop)":

```html
    <div class="legend">
      <div class="legend-row"><div class="swatch" style="background:#14532d;border:1.5px solid #22c55e"></div>Added</div>
      <div class="legend-row"><div class="swatch" style="background:#78350f;border:1.5px solid #f59e0b"></div>Modified</div>
      <div class="legend-row"><div class="swatch" style="background:#7f1d1d;border:1.5px dashed #ef4444"></div>Removed (ghost)</div>
      <div class="legend-row"><div class="swatch" style="background:#1e293b;border:1.5px solid #475569"></div>Unchanged</div>
      <div class="legend-row"><div class="swatch" style="background:linear-gradient(90deg,#1e293b,#78350f)"></div>Change magnitude (least → most lines changed)</div>
      <div class="legend-row"><div class="swatch" style="background:#0a1829;border:1.5px solid #1e3a5f"></div>External (1-hop)</div>
      <div class="legend-row"><div class="swatch" style="background:#0f172a;border:1px dashed #334155"></div>Collapsed dir</div>
      <div class="legend-row"><svg aria-hidden="true" width="16" height="16" style="margin-right:8px;flex-shrink:0"><circle cx="8" cy="8" r="4" fill="#22c55e"/></svg>Has unit test</div>
      <div class="legend-row"><svg aria-hidden="true" width="16" height="16" style="margin-right:8px;flex-shrink:0"><circle cx="8" cy="8" r="4" fill="#a855f7"/></svg>Has Storybook story</div>
    </div>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/renderer.html.test.ts`
Expected: PASS — all tests, including the 2 new ones. (Existing tests must still pass — `loadDiagram()` called with no argument must behave exactly as before.)

- [ ] **Step 6: Stage**

Run: `git add src/renderer.html src/renderer.html.test.ts`

---

### Task 4: Wire `linesChanged`/`magnitude` through the CLI

**Files:**
- Modify: `src/cli.ts`
- Test: `src/cli.test.ts`

**Interfaces:**
- Consumes: `GraphNode.linesChanged?`, `GraphNode.magnitude?` (Task 1)
- Produces: `ModeData.nodes[]` entries carry `linesChanged?: number`, `magnitude?: number` when present on the source `GraphNode`

- [ ] **Step 1: Write failing tests**

Add to `src/cli.test.ts`, after the closing brace of `describe("cli graph.json output", ...)` (before the `// ─── BUG-04...` comment):

```typescript

// ─── change magnitude ───────────────────────────────────────────────────────

describe("cli change-magnitude output", () => {
	let tmp: string;
	let baseRepoRoot: string;
	let repoRoot: string;

	beforeAll(async () => {
		tmp = mkdtempSync(path.join(tmpdir(), "dd-cli-magnitude-"));
		baseRepoRoot = path.join(tmp, "base");
		repoRoot = path.join(tmp, "repo");
		await writeFixtureFile(
			path.join(baseRepoRoot, "src/app/features/f/a.component.ts"),
			"export const a = 1;\n",
		);
		await writeFixtureFile(
			path.join(repoRoot, "src/app/features/f/a.component.ts"),
			"export const a = 2;\nexport const b = 3;\n",
		);
	}, 30_000);

	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("graph.json's changed node carries linesChanged and magnitude", async () => {
		const outDir = path.join(tmp, "out");
		const result = await runCli([
			"--repo-root",
			repoRoot,
			"--base-repo-root",
			baseRepoRoot,
			"--out-dir",
			outDir,
			"src/app/features/f",
		]);
		expect(result.code).toBe(0);

		const graph: Graph = JSON.parse(
			await readFile(path.join(outDir, "graph.json"), "utf8"),
		);
		const node = graph.nodes.find((n) => n.file.endsWith("a.component.ts"));
		expect(node?.diff).toBe("modified");
		expect(node?.linesChanged).toBeGreaterThan(0);
		expect(node?.magnitude).toBe(1);
	}, 30_000);

	it("diagram.html embeds magnitude on the changed node", async () => {
		const outDir = path.join(tmp, "out");
		const html = await readFile(path.join(outDir, "diagram.html"), "utf8");
		expect(html).toContain('"magnitude"');
	}, 30_000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run build && npx vitest run src/cli.test.ts -t "change-magnitude"`
Expected: FAIL — `linesChanged`/`magnitude` are `undefined` in `graph.json`; `diagram.html` doesn't contain `"magnitude"`.

(Note: `cli.test.ts` runs the *built* CLI via `dist/cli.js` — `npm run build` must be run first, and again after Step 3's edit, or the test will exercise stale JS.)

- [ ] **Step 3: Update `ModeData` and `buildModeData`**

In `src/cli.ts`, the `ModeData` node type currently reads (lines 118–133):

```typescript
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
```

Replace with:

```typescript
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
		linesChanged?: number;
		magnitude?: number;
	}>;
```

Then in `buildModeData`, currently (lines 167–180):

```typescript
	const nodes = layout.nodes.map((ln) => {
		const gn = nodeById.get(ln.id);
		return {
			...ln,
			label: gn?.label ?? ln.id,
			type: gn?.type ?? "constants",
			diff: gn?.diff ?? null,
			scope: gn?.scope ?? "in-scope",
			file: gn?.file ?? "",
			...(gn?.typeOnly ? { typeOnly: true } : {}),
			...(gn?.hasTests ? { hasTests: true } : {}),
			...(gn?.hasStories ? { hasStories: true } : {}),
		};
	});
```

Replace with:

```typescript
	const nodes = layout.nodes.map((ln) => {
		const gn = nodeById.get(ln.id);
		return {
			...ln,
			label: gn?.label ?? ln.id,
			type: gn?.type ?? "constants",
			diff: gn?.diff ?? null,
			scope: gn?.scope ?? "in-scope",
			file: gn?.file ?? "",
			...(gn?.typeOnly ? { typeOnly: true } : {}),
			...(gn?.hasTests ? { hasTests: true } : {}),
			...(gn?.hasStories ? { hasStories: true } : {}),
			...(gn?.linesChanged !== undefined
				? { linesChanged: gn.linesChanged }
				: {}),
			...(gn?.magnitude !== undefined ? { magnitude: gn.magnitude } : {}),
		};
	});
```

- [ ] **Step 4: Build and run tests to verify they pass**

Run: `npm run build`
Run: `npx vitest run src/cli.test.ts`
Expected: PASS — all tests, including the 2 new ones.

- [ ] **Step 5: Stage**

Run: `git add src/cli.ts src/cli.test.ts`

---

### Task 5: Fixture updates and visual snapshot review

**Files:**
- Modify: `fake-angular-app/src/app/features/users/user-list/users-list.component.ts`
- Create: `fake-angular-app/src/app/features/users/user-settings/security-session.model.ts`
- Modify: `test/snapshots/reference/diff-focused.png`, `test/snapshots/reference/all-nodes.png` (regenerated)

This task has no new unit tests of its own — it feeds the visual regression tests that already exist (`src/renderer/visual.test.ts`) and the manual review gate the project always requires for rendering changes.

- [ ] **Step 1: Replace the modified-file fixture**

Overwrite `fake-angular-app/src/app/features/users/user-list/users-list.component.ts` (currently a 2-line diff vs. base — too small to show the magnitude gradient) with a substantially larger rewrite that wires up the fixture's already-present but currently-unused `SortStateService`/`sortComparator` (see `fake-angular-app/src/app/features/users/user-list/sort-state.service.ts` and `user-sort.utils.ts` — `user-table-header.component.ts` already toggles sort state on click, but nothing consumed it) and adds row-selection UI. This content has already been validated against this repo's Biome config (`npx biome check --write`) — write it exactly as follows, with no further formatting needed:

```typescript
import { CommonModule } from "@angular/common";
import { Component, type OnInit } from "@angular/core";
import { combineLatest } from "rxjs";
import { PaginationComponent } from "../../../shared/components/pagination.component";
import type { AnalyticsService } from "../../../shared/services";
import type { UsersService } from "../data-access/users.service";
import type { UserModel } from "../models/user.model";
import type { SortStateService } from "./sort-state.service";
import { UserCardComponent } from "./user-card.component";
import { UserFilterComponent } from "./user-filter.component";
import { sortComparator } from "./user-sort.utils";
import { UserTableHeaderComponent } from "./user-table-header.component";

@Component({
	selector: "app-users-list",
	standalone: true,
	imports: [
		CommonModule,
		UserCardComponent,
		UserFilterComponent,
		UserTableHeaderComponent,
		PaginationComponent,
	],
	template: `
    <div class="users-list">
      <app-user-filter />
      <table>
        <app-user-table-header />
        <tbody>
          <tr
            *ngFor="let user of sortedUsers; trackBy: trackByUserId"
            [class.selected]="isSelected(user)"
          >
            <td>
              <input
                type="checkbox"
                [checked]="isSelected(user)"
                (change)="toggleSelect(user)"
              />
            </td>
            <td><app-user-card [user]="user" /></td>
          </tr>
        </tbody>
      </table>
      <div class="bulk-bar" *ngIf="selectedIds.size > 0">
        <span>{{ selectedIds.size }} selected</span>
        <button type="button" (click)="clearSelection()">Clear</button>
      </div>
      <app-pagination [page]="page" [totalPages]="totalPages" (pageChange)="onPageChange($event)" />
    </div>
  `,
})
export class UsersListComponent implements OnInit {
	users: UserModel[] = [];
	sortedUsers: UserModel[] = [];
	selectedIds = new Set<string>();
	page = 1;
	totalPages = 1;

	constructor(
		private usersService: UsersService,
		private sortState: SortStateService,
		// biome-ignore lint/correctness/noUnusedPrivateClassMembers: fixture stub
		private analytics: AnalyticsService,
	) {}

	ngOnInit(): void {
		combineLatest([this.usersService.getAll(), this.sortState.sort$]).subscribe(
			([users, sort]) => {
				this.users = users;
				this.sortedUsers = [...users].sort(sortComparator(sort));
				this.totalPages = Math.ceil(users.length / 20);
			},
		);
	}

	onPageChange(page: number): void {
		this.page = page;
	}

	toggleSelect(user: UserModel): void {
		if (this.selectedIds.has(user.id)) {
			this.selectedIds.delete(user.id);
		} else {
			this.selectedIds.add(user.id);
		}
	}

	isSelected(user: UserModel): boolean {
		return this.selectedIds.has(user.id);
	}

	clearSelection(): void {
		this.selectedIds.clear();
	}

	trackByUserId(_index: number, user: UserModel): string {
		return user.id;
	}
}
```

This keeps every previously-true fact about this file's diff intact — the `UserSearchResultsComponent` import/usage removal and the `AnalyticsService` addition are both still present — so the existing `src/integration.test.ts` assertions about this file (`users-list.component is modified`, `edge users-list → user-search-results is removed`, `edge users-list → analytics-service (OOS) is added`, `edge users-list → pagination (OOS) is unchanged`) all continue to hold; this only adds new content and new in-scope edges (to `SortStateService` and `user-sort.utils`) on top.

- [ ] **Step 2: Add the small added-file fixture**

Create `fake-angular-app/src/app/features/users/user-settings/security-session.model.ts`:

```typescript
export interface SecuritySession {
	userId: string;
	lastLoginAt: string;
	mfaEnabled: boolean;
}
```

(5 lines — deliberately tiny next to `user-security.component.ts` (33 lines) and `user-notification-prefs.component.ts` (40 lines), the fixture's two other added files, so the `added`-node magnitude gradient has visible range.)

- [ ] **Step 3: Verify fixtures pass lint as-is**

Run: `npx biome check fake-angular-app/src/app/features/users/user-list/users-list.component.ts fake-angular-app/src/app/features/users/user-settings/security-session.model.ts`
Expected: no errors (both files were pre-validated against this exact Biome config while writing this plan).

- [ ] **Step 4: Build and run the full test suite**

Run: `npm run build && npm test`
Expected: PASS. In particular, `src/integration.test.ts`'s existing fixture-diff assertions (see Step 1) must still pass unmodified.

- [ ] **Step 5: Run the CLI against the fixtures and review the diagram**

Run: `node dist/cli.js --repo-root fake-angular-app --base-repo-root fake-angular-app-base --out-dir /tmp/change-magnitude-review src/app/features/users`

Open `/tmp/change-magnitude-review/diagram.html` in a browser (or view the SVGs directly). Confirm:
- `UsersListComponent` (now the largest modified diff) renders visibly more saturated than `UserSettingsComponent`, `UserDetailComponent`, and `UserTableHeaderComponent` (the three small modified diffs).
- `SecuritySession` (the new 5-line model) renders visibly more muted than `UserSecurityComponent` and `UserNotificationPrefsComponent` (the two larger added files).
- The "Change magnitude" legend row is present and its gradient swatch is visible.

**This is the point where the primary design bet — a gradient fill is legible enough — gets tested against real content.** If it's still hard to distinguish nodes by eye at this point, stop and flag it before continuing to Step 6 — per the design spec, the fallback (a GitHub-style diffstat bar) is a separate follow-up, not a silent substitution here.

- [ ] **Step 6: Run the visual regression tests to see what changed**

Run: `npm run test:visual`
Expected: FAIL — the fixture and rendering changes alter both `fake-angular-app` reference snapshots (`diff-focused` and `all-nodes` modes). This failure is expected and will be resolved in the next step.

- [ ] **Step 7: Approve the new snapshots**

Having visually reviewed the output in Step 5, run: `npm run test:visual:approve`

Then run: `npm run verify`
Expected: PASS.

- [ ] **Step 8: Stage**

Run: `git add fake-angular-app/src/app/features/users/user-list/users-list.component.ts fake-angular-app/src/app/features/users/user-settings/security-session.model.ts test/snapshots/reference/diff-focused.png test/snapshots/reference/all-nodes.png`

---

### Task 6: Update product docs

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/spec.md`
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: `docs/architecture.md` — `GraphNode` type reference**

Line 39 currently reads:

```
- `GraphNode` — `{ id, label, file, type: NodeType | 'stub', scope: NodeScope, diff: DiffState | null, typeOnly?: boolean, hasTests?: boolean, hasStories?: boolean, _content?: string }` (`_content` is internal only — raw file text used by `diffGraphs` to detect content changes, stripped from `graph.json` before it's written)
```

Replace with:

```
- `GraphNode` — `{ id, label, file, type: NodeType | 'stub', scope: NodeScope, diff: DiffState | null, typeOnly?: boolean, hasTests?: boolean, hasStories?: boolean, linesChanged?: number, magnitude?: number, _content?: string }` (`linesChanged`/`magnitude` are set by `diffGraphs`/`applyChangeMagnitude` — see below; `_content` is internal only — raw file text used by `diffGraphs` to detect content changes, stripped from `graph.json` before it's written)
```

- [ ] **Step 2: `docs/architecture.md` — `diffGraphs` algorithm**

The `src/diff-parser.ts` section's algorithm list currently reads (lines 76–86):

```
Algorithm:
1. Index base and current nodes by `node.file` (repo-relative path — stable across branches)
2. Index base and current edges by `"fromFile→toFile"` key
3. Current nodes not in base → `diff: 'added'`
4. Current nodes in base → `diff: 'modified'` if the node's `_content` differs from its base counterpart, else `'unchanged'`
5. Base in-scope nodes not in current → ghost node, `scope: 'removed-ghost'`, `diff: 'removed'`
   - Out-of-scope removed nodes are dropped (no ghost)
6. Current edges not in base → `diff: 'added'`
7. Current edges in base → compare imported-name sets: `diff: 'modified'` if the set changed, else `'unchanged'`
8. Base edges not in current → re-keyed to current/ghost node IDs, `diff: 'removed'`
```

Replace with:

```
Algorithm:
1. Index base and current nodes by `node.file` (repo-relative path — stable across branches)
2. Index base and current edges by `"fromFile→toFile"` key
3. Current nodes not in base → `diff: 'added'`, `linesChanged` = the file's own line count
4. Current nodes in base → `diff: 'modified'` if the node's `_content` differs from its base counterpart (else `'unchanged'`); `linesChanged` = a real line-level diff count (via the `diff` npm package's `diffLines`) between base and current content, or 0 if unchanged
5. Base in-scope nodes not in current → ghost node, `scope: 'removed-ghost'`, `diff: 'removed'`, `linesChanged` = the base file's own line count
   - Out-of-scope removed nodes are dropped (no ghost)
6. Current edges not in base → `diff: 'added'`
7. Current edges in base → compare imported-name sets: `diff: 'modified'` if the set changed, else `'unchanged'`
8. Base edges not in current → re-keyed to current/ghost node IDs, `diff: 'removed'`
9. `applyChangeMagnitude(nodes)` scales each node's `linesChanged` into `magnitude` ∈ [0, 1], relative to the max `linesChanged` among in-scope and removed-ghost nodes (out-of-scope nodes are excluded from this max, and never receive a `magnitude`, so an unrelated large OOS diff can't flatten every in-scope node's magnitude toward zero)
```

- [ ] **Step 3: `docs/architecture.md` — `draw.ts` color scheme**

Currently (lines 128–139):

```
### `src/renderer/draw.ts`

**`toSvg(layout, nodes, edges)`** — pure function, no DOM, no side effects. Produces an SVG string from pre-computed layout positions.

Color scheme:
- Node fill by diff: `added=#14532d`, `modified=#78350f`, `removed=#7f1d1d`, `unchanged=#1e293b`
- Node stroke by diff: `added=#22c55e`, `modified=#f59e0b`, `removed=#ef4444`, `unchanged=#475569`
- Out-of-scope fill: `#0a1829`, stroke: `#1e3a5f`
- Stub: fill `#0f172a`, stroke `#334155`, dashed border
- Edge stroke same as node stroke; removed edges are dashed + 50% opacity

Exports: `toSvg`, `nodeColor`, `edgeStroke`, `truncateLabel`
```

Replace with:

```
### `src/renderer/draw.ts`

**`toSvg(layout, nodes, edges)`** — pure function, no DOM, no side effects. Produces an SVG string from pre-computed layout positions.

Color scheme:
- Node fill by diff: `added=#14532d`, `modified=#78350f`, `removed=#7f1d1d`, `unchanged=#1e293b`
- Node stroke by diff: `added=#22c55e`, `modified=#f59e0b`, `removed=#ef4444`, `unchanged=#475569`
- Out-of-scope fill: `#0a1829`, stroke: `#1e3a5f`
- Stub: fill `#0f172a`, stroke `#334155`, dashed border
- Edge stroke same as node stroke; removed edges are dashed + 50% opacity
- **Change magnitude:** when a node has a `magnitude` (in-scope and removed-ghost changed nodes — see `diffGraphs` above), its fill is `lerpHex(unchangedFill, diffStateFill, magnitude)` — an sRGB per-channel lerp — instead of the flat diff-state fill. Stroke is unaffected by magnitude; it always renders at full diff-state intensity, so even a barely-changed node's diff state stays unambiguous.

Exports: `toSvg`, `nodeColor`, `edgeStroke`, `truncateLabel`, `lerpHex`
```

- [ ] **Step 4: `docs/architecture.md` — `renderer.html` section**

Currently (lines 143–162), the "Client-side renderer" line reads:

```
Client-side renderer: builds SVG string from layout positions using the same color palette as `draw.ts`. Adds `data-id` to node groups and `data-from`/`data-to` to edge paths for hover event delegation.
```

Replace with:

```
Client-side renderer: builds SVG string from layout positions using the same color palette and magnitude-fill logic (`lerpHex`, mirrored from `draw.ts`) as `draw.ts`. Adds `data-id` to node groups and `data-from`/`data-to` to edge paths for hover event delegation.
```

- [ ] **Step 5: `docs/architecture.md` — test fixtures**

Currently (lines 200–210):

```
## Test fixtures

`fake-angular-app/` — 79 .ts files, represents the "after PR" state.
`fake-angular-app-base/` — 76 .ts files, represents the "before PR" state.

Fixture diff:
- Added: `user-settings/user-security.component.ts`, `user-settings/user-notification-prefs.component.ts`; also current-only: `user-list/user-card.stories.ts` (Storybook sidecar, excluded from the graph) and `shared/services/index.ts` (out-of-scope barrel)
- Removed: `user-list/user-search-results.component.ts`
- Modified: `user-settings/user-settings.component.ts` (new imports), `user-list/users-list.component.ts` (new OOS dep `AnalyticsService`, dropped import of the removed component), `user-detail/user-detail.component.ts` (dropped `CacheService`), `user-list/user-table-header.component.ts` (template content changed, imports unchanged — demonstrates node diff is content-based, not import-based)

Integration tests in `src/integration.test.ts` run the full analyze→addContext→diffGraphs pipeline against these fixtures and assert all 5 node diff states and 3 edge diff states.
```

Replace with:

```
## Test fixtures

`fake-angular-app/` — 80 .ts files, represents the "after PR" state.
`fake-angular-app-base/` — 76 .ts files, represents the "before PR" state.

Fixture diff:
- Added: `user-settings/user-security.component.ts`, `user-settings/user-notification-prefs.component.ts`, `user-settings/security-session.model.ts` (a deliberately tiny 5-line model, next to the two ~35-line components above — gives the change-magnitude gradient visible range on the `added` side); also current-only: `user-list/user-card.stories.ts` (Storybook sidecar, excluded from the graph) and `shared/services/index.ts` (out-of-scope barrel)
- Removed: `user-list/user-search-results.component.ts`
- Modified: `user-settings/user-settings.component.ts` (new imports), `user-list/users-list.component.ts` (wires up the previously-unused `SortStateService`/`sortComparator` and adds row-selection UI — a substantially larger rewrite than the other three modified files, deliberately the "hottest" node, to give the change-magnitude gradient visible range on the `modified` side), `user-detail/user-detail.component.ts` (dropped `CacheService`), `user-list/user-table-header.component.ts` (template content changed, imports unchanged — demonstrates node diff is content-based, not import-based)

Integration tests in `src/integration.test.ts` run the full analyze→addContext→diffGraphs pipeline against these fixtures and assert all 5 node diff states and 3 edge diff states.
```

- [ ] **Step 6: `docs/spec.md` — remove magnitude from non-goals, document it under Visual encoding**

Line 118 currently reads (in the Non-goals list):

```
- **Change magnitude** — the tool detects *that* a file's content changed (node `modified` state), but not *how much*. Line-level diff statistics are not computed today; see "Change magnitude styling" under Planned.
```

Delete this line entirely.

In the "Visual encoding" section, currently (lines 94–102):

```
### Visual encoding

**Node fill and stroke color** encodes diff state:
- `added` — green
- `modified` — amber
- `removed` — red
- `unchanged` — dark slate

Out-of-scope nodes use a distinct dark background and blue stroke regardless of diff state.
```

Replace with:

```
### Visual encoding

**Node fill and stroke color** encodes diff state:
- `added` — green
- `modified` — amber
- `removed` — red
- `unchanged` — dark slate

For `added`, `modified`, and `removed` nodes, fill intensity additionally scales with **change magnitude** — how much of the file changed (a real line-level diff for `modified` nodes, the file's own length for `added`/`removed`), relative to the most-changed node in the diagram. The most heavily changed node renders at full diff-state color; more lightly changed nodes fade toward the unchanged fill. Border color always stays at full diff-state intensity regardless of magnitude, so a node's diff state is never ambiguous even when barely changed.

Out-of-scope nodes use a distinct dark background and blue stroke regardless of diff state, and do not participate in change-magnitude styling.
```

- [ ] **Step 7: `docs/spec.md` — remove from Planned**

Line 130 currently reads (in the "Planned" list):

```
- **Change magnitude styling** — visually encode how much a file changed, so a reviewer's eye is drawn to the most heavily modified files first
```

Delete this line entirely.

- [ ] **Step 8: `README.md` — fixture diff description**

Line 103 currently reads:

```
Fixture diff: two files added in `user-settings/`, one removed in `user-list/`, three files with changed imports, plus a Storybook story and an out-of-scope `shared/services` barrel added in the current branch. Used by the integration and visual regression tests.
```

Replace with:

```
Fixture diff: three files added in `user-settings/` (two components plus a small model, deliberately sized apart to show the change-magnitude gradient's range), one removed in `user-list/`, four files modified (three small, one substantially larger — also demonstrating the gradient), plus a Storybook story and an out-of-scope `shared/services` barrel added in the current branch. Used by the integration and visual regression tests.
```

- [ ] **Step 9: `CLAUDE.md` — fixture diff description**

The repo-root `CLAUDE.md`'s "Fake app fixtures" section currently ends with:

```
Both are domain-organized (not type-organized): `user-list/`, `user-detail/`, `user-edit/`, etc. No barrel files inside the feature directory (the current branch adds one out-of-scope barrel at `shared/services/index.ts`). Fixture diff: two files added in `user-settings/`, one removed in `user-list/`, three files with changed imports, one file with changed content only (imports unchanged, proves node diff is content-based), plus a Storybook story added in `user-list/`.
```

Replace with:

```
Both are domain-organized (not type-organized): `user-list/`, `user-detail/`, `user-edit/`, etc. No barrel files inside the feature directory (the current branch adds one out-of-scope barrel at `shared/services/index.ts`). Fixture diff: three files added in `user-settings/` (two components at ~33–40 lines, plus a 5-line model — sized apart to demonstrate the change-magnitude gradient on added nodes), one removed in `user-list/`, four files modified (three small edits plus one substantially larger rewrite in `user-list/users-list.component.ts`, wiring up previously-unused sort/selection utilities — demonstrating the gradient on modified nodes), one of the small modifications has changed content only (imports unchanged, proves node diff is content-based), plus a Storybook story added in `user-list/`.
```

- [ ] **Step 10: Stage**

Run: `git add docs/architecture.md docs/spec.md README.md CLAUDE.md`

---

### Task 7: Final verification and the single commit

**Files:** none (verification + commit only).

- [ ] **Step 1: Full verify**

Run: `npm run verify`
Expected: PASS — build, biome check, all unit tests, visual tests, and the sample drift check. (The sample drift check uses `sample-app`/`sample-app-base`, not `fake-angular-app`, so it's unaffected by Task 5's fixture changes and should already pass — if it doesn't, something unrelated broke and needs investigation, not a docs/sample regeneration.)

- [ ] **Step 2: Manual CLI smoke test**

Run: `node dist/cli.js --repo-root fake-angular-app --base-repo-root fake-angular-app-base src/app/features/users`
Expected: exits 0, writes `dist/diagram-diff.svg`, `dist/diagram-all.svg`, `dist/diagram.html`, `dist/graph.json`.

Inspect `dist/graph.json`: confirm the `UsersListComponent` node has `"diff": "modified"`, a `linesChanged` well above the other three modified files, and `"magnitude": 1` (it should be the max). Confirm the `SecuritySession` node has `"diff": "added"` and a `magnitude` well below `UserSecurityComponent`/`UserNotificationPrefsComponent`.

- [ ] **Step 3: Confirm nothing is left unstaged**

Run: `git status --short`
Expected: everything from Tasks 1–6 is staged (`git add` was the last step of each). If anything shows as unstaged, `git add` it now.

- [ ] **Step 4: Confirm branch is exactly one commit ahead... of nothing yet (this is the first commit)**

Run: `git log origin/main..HEAD --oneline`
Expected: empty (no commits yet on this branch — this task makes the first and only one).

- [ ] **Step 5: Make the one commit**

```bash
git commit -m "$(cat <<'EOF'
Add relative change-magnitude gradient fills, fed by a real line-level diff

Redoes change-magnitude styling (#27) after PR #40 (predating #46's
content-based node diff state) turned out to compute magnitude as a net
line-count delta — a same-length rewrite would score linesChanged=0 and
render fully muted despite correctly showing as modified.

diffGraphs now computes linesChanged from a real line-level diff (the
`diff` npm package) for modified nodes, and from the file's own length
for added/removed nodes. applyChangeMagnitude scales linesChanged into a
0-1 magnitude relative to the most-changed node that actually renders a
magnitude fill (out-of-scope nodes are excluded from that max, so an
unrelated large OOS diff can't flatten every in-scope magnitude).

Both renderers lerp each changed node's fill from the unchanged color
toward its full diff-state color by magnitude; stroke stays fixed so
diff state is never ambiguous. Fixtures gained a substantially larger
modified-file rewrite and one small added file so the gradient has
visible range to review — both axes were previously too tightly
clustered (1-10 line diffs) to show a gradient at all.

Fixes #27

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Verify the commit**

Run: `git status --short && git log origin/main..HEAD --oneline`
Expected: `nothing to commit, working tree clean`, and exactly one commit ahead of `origin/main`.

- [ ] **Step 7: Push and open the PR**

Run: `git push -u origin feat/change-magnitude-v2`

Then open a PR referencing this plan and the closed PR #40, including the design spec (`docs/superpowers/specs/2026-07-30-change-magnitude-design.md`) directly in this PR. **Call out the regenerated visual snapshots prominently in the PR body** (per this project's standing rule for rendering changes) — link both new reference PNGs and summarize what changed in them (per Task 5 Step 5's review).
