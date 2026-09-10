import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "../types.js";
import {
	edgeStroke,
	lerpHex,
	nodeColor,
	toSvg,
	truncateLabel,
} from "./draw.js";
import type { Layout } from "./layout.js";

// ─── helpers ────────────────────────────────────────────────────────────────

function node(id: string, overrides: Partial<GraphNode> = {}): GraphNode {
	return {
		id,
		label: id,
		file: `${id}.ts`,
		type: "file",
		scope: "in-scope",
		diff: "unchanged",
		...overrides,
	};
}

function edge(from: string, to: string, diff?: GraphEdge["diff"]): GraphEdge {
	return diff
		? { from, to, kind: "import", diff }
		: { from, to, kind: "import" };
}

function layout(nodes: GraphNode[], edges: GraphEdge[] = []): Layout {
	const lnodes = nodes.map((n, i) => ({
		id: n.id,
		x: i * 200,
		y: 0,
		width: 140,
		height: 40,
	}));
	const ledges = edges.map((e) => ({
		from: e.from,
		to: e.to,
		sections: [{ startPoint: { x: 0, y: 20 }, endPoint: { x: 200, y: 20 } }],
	}));
	return {
		nodes: lnodes,
		edges: ledges,
		width: nodes.length * 200 + 100,
		height: 100,
	};
}

// ─── nodeColor ───────────────────────────────────────────────────────────────

describe("nodeColor", () => {
	it("added node uses green fill", () => {
		const { fill } = nodeColor(node("a", { diff: "added" }));
		expect(fill).toBe("#1f6b3d");
	});

	it("modified node uses amber fill", () => {
		const { fill } = nodeColor(node("a", { diff: "modified" }));
		expect(fill).toBe("#9a5510");
	});

	it("removed node uses red fill", () => {
		const { fill } = nodeColor(node("a", { diff: "removed" }));
		expect(fill).toBe("#a03333");
	});

	it("unchanged node uses slate fill", () => {
		const { fill } = nodeColor(node("a", { diff: "unchanged" }));
		expect(fill).toBe("#2d3f5c");
	});

	it("out-of-scope node uses OOS fill regardless of diff", () => {
		const { fill } = nodeColor(
			node("a", { scope: "out-of-scope", diff: "added" }),
		);
		expect(fill).toBe("#1f3355");
	});

	it("added node has green stroke", () => {
		const { stroke } = nodeColor(node("a", { diff: "added" }));
		expect(stroke).toBe("#22c55e");
	});

	it("removed node has red stroke", () => {
		const { stroke } = nodeColor(node("a", { diff: "removed" }));
		expect(stroke).toBe("#ef4444");
	});
});

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
		expect(high.fill).toBe("#1f6b3d"); // full intensity at magnitude 1
		expect(low.fill).toBe(lerpHex("#2d3f5c", "#1f6b3d", 0.1));
		expect(low.stroke).toBe(high.stroke);
		expect(low.stroke).toBe("#22c55e");
	});

	it("falls back to the flat diff fill when magnitude is absent", () => {
		const { fill } = nodeColor(node("a", { diff: "modified" }));
		expect(fill).toBe("#9a5510");
	});

	it("out-of-scope node ignores magnitude entirely", () => {
		const { fill } = nodeColor(
			node("a", { scope: "out-of-scope", diff: "added", magnitude: 0.1 }),
		);
		expect(fill).toBe("#1f3355");
	});
});

// ─── edgeStroke ──────────────────────────────────────────────────────────────

describe("edgeStroke", () => {
	it("added edge is green", () => expect(edgeStroke("added")).toBe("#22c55e"));
	it("removed edge is red", () =>
		expect(edgeStroke("removed")).toBe("#ef4444"));
	it("unchanged edge is slate", () =>
		expect(edgeStroke("unchanged")).toBe("#8fa8d6"));
	it("undefined diff falls back to unchanged color", () =>
		expect(edgeStroke(undefined)).toBe("#8fa8d6"));
});

// ─── truncateLabel ────────────────────────────────────────────────────────────

describe("truncateLabel", () => {
	it("returns full label when it fits", () => {
		expect(truncateLabel("Short", 200)).toBe("Short");
	});

	it("truncates and appends ellipsis when label is too long", () => {
		const result = truncateLabel("VeryLongComponentName", 80);
		expect(result.endsWith("…")).toBe(true);
		expect(result.length).toBeLessThan("VeryLongComponentName".length);
	});

	it("truncated label fits within given width", () => {
		const APPROX_CHAR_WIDTH = 7;
		const maxWidth = 80;
		const result = truncateLabel(
			"VeryLongComponentNameThatShouldBeTruncated",
			maxWidth,
		);
		expect(result.length * APPROX_CHAR_WIDTH + 16).toBeLessThanOrEqual(
			maxWidth + APPROX_CHAR_WIDTH,
		);
	});
});

// ─── toSvg ───────────────────────────────────────────────────────────────────

describe("toSvg", () => {
	it("returns a string starting with <svg", () => {
		const svg = toSvg(layout([node("a")]), [node("a")], []);
		expect(svg.trimStart().startsWith("<svg")).toBe(true);
	});

	it("contains node label text", () => {
		const n = node("UserCard", { label: "UserCard" });
		const svg = toSvg(layout([n]), [n], []);
		expect(svg).toContain("UserCard");
	});

	it("in-scope node shows label only — no diff text inside node", () => {
		const n = node("svc", {
			label: "MyService",
			diff: "added",
		});
		const svg = toSvg(layout([n]), [n], []);
		expect(svg).toContain("MyService");
		expect(svg).not.toContain(">added<");
	});

	it("out-of-scope node shows stripped directory path as subtitle", () => {
		const n = node("oos", {
			label: "Analytics",
			scope: "out-of-scope",
			file: "src/app/shared/services/analytics.service.ts",
		});
		const svg = toSvg(layout([n]), [n], [], undefined, "src/app");
		expect(svg).toContain("Analytics");
		expect(svg).toContain("shared/services");
		expect(svg).not.toContain(">src/app/shared/services<");
	});

	it("out-of-scope directory box (Collapsed view) shows a path subtitle (its own full group directory, not a truncated one), unlike an in-scope directory box", () => {
		// A collapsed out-of-scope *directory* box's label is just a bare
		// basename ("services"), which can be genuinely ambiguous — so
		// unlike an in-scope directory box (whose label is already a
		// relative path under the feature being diagrammed), it keeps the
		// path subtitle. Since node.file for a directory/stub node is
		// already the group's own directory (not a file with a basename to
		// strip), the subtitle must be the group's full path
		// ("shared/services"), not one level shallower ("shared") — a
		// naive dirname() of an already-a-directory path would be wrong.
		const oosDir = node("dir-oos", {
			label: "● services (2)",
			type: "directory",
			scope: "out-of-scope",
			file: "src/app/shared/services",
		});
		const inScopeDir = node("dir-in", {
			label: "● users (2)",
			type: "directory",
			file: "src/app/features/users",
		});
		const svg = toSvg(
			layout([oosDir, inScopeDir]),
			[oosDir, inScopeDir],
			[],
			undefined,
			"src/app",
		);
		expect(svg).toContain(">shared/services<");
		expect(svg).not.toContain(">features/users<");
		const oosLabel = svg.match(/<text[^>]*>● services \(2\)<\/text>/)?.[0];
		const inScopeLabel = svg.match(/<text[^>]*>● users \(2\)<\/text>/)?.[0];
		expect(oosLabel).toContain('font-size="11"');
		expect(oosLabel).toContain('fill="#ffffff"');
		expect(inScopeLabel).toContain('font-size="11"');
		expect(inScopeLabel).toContain('fill="#ffffff"');
		// Stroke width is unaffected by the subtitle — both are still
		// collapsed-group boxes, drawn with the same heavier border.
		const oosGroup =
			svg.match(
				/<g class="node-group" data-id="dir-oos"[^>]*>[\s\S]*?<\/g>/,
			)?.[0] ?? "";
		const inScopeGroup =
			svg.match(
				/<g class="node-group" data-id="dir-in"[^>]*>[\s\S]*?<\/g>/,
			)?.[0] ?? "";
		expect(oosGroup).toContain('stroke-width="1.25"');
		expect(inScopeGroup).toContain('stroke-width="1.25"');
	});

	it("stub node (Focused view) and directory box (Collapsed view) render with identical text styling", () => {
		const stub = node("stub-x", {
			label: "● widgets (2)",
			type: "stub",
		});
		const dir = node("dir-x", {
			label: "● widgets (2)",
			type: "directory",
		});
		const svgStub = toSvg(layout([stub]), [stub], []);
		const svgDir = toSvg(layout([dir]), [dir], []);
		const stubText = svgStub.match(/<text[^>]*>● widgets \(2\)<\/text>/)?.[0];
		const dirText = svgDir.match(/<text[^>]*>● widgets \(2\)<\/text>/)?.[0];
		expect(stubText).toBe(dirText);
	});

	it("out-of-scope stub (Focused view) shows its own full group directory as a path subtitle, same as an out-of-scope directory box (Collapsed view)", () => {
		const stub = node("stub-oos", {
			label: "● services (2)",
			type: "stub",
			scope: "out-of-scope",
			file: "src/app/shared/services",
		});
		const svg = toSvg(layout([stub]), [stub], [], undefined, "src/app");
		expect(svg).toContain(">shared/services<");
	});

	it("renders added edges with green stroke color", () => {
		const n1 = node("a");
		const n2 = node("b");
		const e = edge("a", "b", "added");
		const svg = toSvg(layout([n1, n2], [e]), [n1, n2], [e]);
		expect(svg).toContain("#22c55e"); // green
	});

	it("renders removed edges with red stroke, no dash", () => {
		const n1 = node("a");
		const n2 = node("b", { scope: "removed-ghost", diff: "removed" });
		const e = edge("a", "b", "removed");
		const svg = toSvg(layout([n1, n2], [e]), [n1, n2], [e]);
		expect(svg).toContain("#ef4444"); // red
		expect(svg).not.toContain("stroke-dasharray");
	});

	it("an unchanged edge between two untouched nodes renders at reduced opacity", () => {
		const n1 = node("a");
		const n2 = node("b");
		const e = edge("a", "b"); // no diff → unchanged
		const svg = toSvg(layout([n1, n2], [e]), [n1, n2], [e]);
		const path = svg.match(/<path[^>]*data-from="a"[^>]*\/>/)?.[0] ?? "";
		expect(path).toMatch(/opacity="0\.\d+"/);
		expect(Number(path.match(/opacity="([\d.]+)"/)?.[1])).toBeLessThan(1);
	});

	it.each([
		"added",
		"modified",
		"removed",
	] as const)("%s edges render at full opacity (no opacity attribute)", (diff) => {
		const n1 = node("a");
		const n2 = node("b", { diff });
		const e = edge("a", "b", diff);
		const svg = toSvg(layout([n1, n2], [e]), [n1, n2], [e]);
		const path = svg.match(/<path[^>]*data-from="a"[^>]*\/>/)?.[0] ?? "";
		expect(path).not.toContain("opacity=");
	});

	it("an added/removed edge renders at full opacity even when both endpoint nodes' own diff is unchanged", () => {
		// e.g. a barrel re-export change can add/remove a resolved edge
		// without either endpoint file's own content changing — the edge's
		// own diff state alone is enough to keep it at full opacity.
		const n1 = node("a");
		const n2 = node("b");
		const e = edge("a", "b", "added");
		const svg = toSvg(layout([n1, n2], [e]), [n1, n2], [e]);
		const path = svg.match(/<path[^>]*data-from="a"[^>]*\/>/)?.[0] ?? "";
		expect(path).not.toContain("opacity=");
	});

	it("an unchanged edge into a node that itself changed renders at full opacity — proximity, not the edge's own diff state, governs dimming", () => {
		const n1 = node("a"); // unchanged
		const n2 = node("b", { diff: "modified" }); // touched via its own diff
		const e = edge("a", "b"); // edge itself carries no diff (unchanged)
		const svg = toSvg(layout([n1, n2], [e]), [n1, n2], [e]);
		const path = svg.match(/<path[^>]*data-from="a"[^>]*\/>/)?.[0] ?? "";
		expect(path).not.toContain("opacity=");
	});

	it("an unchanged edge stays dimmed even when its neighbor node was only reached by a changed edge, not changed itself", () => {
		// a --(unchanged)--> b --(added)--> c
		// b's own diff state is unchanged — being an endpoint of the added
		// b→c edge does NOT make the unrelated a→b edge light up too. Dimming
		// only follows nodes that changed themselves, not edge-to-edge
		// propagation through an untouched intermediary — otherwise one
		// added/removed edge would light up every other edge on that node,
		// well beyond the actual change.
		const n1 = node("a");
		const n2 = node("b");
		const n3 = node("c", { diff: "added" });
		const eAB = edge("a", "b");
		const eBC = edge("b", "c", "added");
		const svg = toSvg(
			layout([n1, n2, n3], [eAB, eBC]),
			[n1, n2, n3],
			[eAB, eBC],
		);
		const pathAB = svg.match(/<path[^>]*data-from="a"[^>]*\/>/)?.[0] ?? "";
		expect(pathAB).toMatch(/opacity="0\.\d+"/);
	});

	it("an unchanged edge landing on an existing, content-unchanged node still renders at full opacity, because the source node changed", () => {
		// a --(added)--> b: a is a changed node (diff added on the edge
		// implies a's own content changed too, but even if it hadn't) — the
		// edge itself is added, so it's full opacity regardless of b's own
		// diff state, which stays unchanged.
		const n1 = node("a", { diff: "modified" });
		const n2 = node("b");
		const e = edge("a", "b", "added");
		const svg = toSvg(layout([n1, n2], [e]), [n1, n2], [e]);
		const path = svg.match(/<path[^>]*data-from="a"[^>]*\/>/)?.[0] ?? "";
		expect(path).not.toContain("opacity=");
	});

	it("an unchanged edge stays dimmed even when an unrelated change exists elsewhere in the graph", () => {
		// a --(unchanged)--> b, plus an unrelated added edge c→d elsewhere.
		// Neither a nor b is touched by the c→d change, so a→b stays dimmed.
		const n1 = node("a");
		const n2 = node("b");
		const n3 = node("c");
		const n4 = node("d", { diff: "added" });
		const eAB = edge("a", "b");
		const eCD = edge("c", "d", "added");
		const svg = toSvg(
			layout([n1, n2, n3, n4], [eAB, eCD]),
			[n1, n2, n3, n4],
			[eAB, eCD],
		);
		const pathAB = svg.match(/<path[^>]*data-from="a"[^>]*\/>/)?.[0] ?? "";
		expect(pathAB).toMatch(/opacity="0\.\d+"/);
	});

	it("no edge ever has a stroke-dasharray, diff-colored or unchanged", () => {
		const n1 = node("a");
		const n2 = node("b");
		const n3 = node("c", { diff: "removed" });
		const edges = [edge("a", "b"), edge("b", "c", "removed")];
		const svg = toSvg(layout([n1, n2, n3], edges), [n1, n2, n3], edges);
		expect(svg).not.toContain("stroke-dasharray");
	});

	it("renders stub nodes with a solid border and the directory label", () => {
		const s = node("stub-dir", { type: "stub", label: "● data-access (2)" });
		const svg = toSvg(layout([s]), [s], []);
		expect(svg).not.toContain("stroke-dasharray");
		expect(svg).toContain("data-access");
	});

	it("places a stub node's label at the same position as a directory node's label", () => {
		// Same underlying fact (a fully-collapsed directory), shown by two
		// different view modes — the label should sit in the same spot
		// either way, even though color still differs between the two.
		const s = node("stub-dir", { type: "stub", label: "widgets" });
		const d = node("dir-node", { type: "directory", label: "widgets" });
		const svgStub = toSvg(layout([s]), [s], []);
		const svgDir = toSvg(layout([d]), [d], []);
		const stubMatch = svgStub.match(
			/<text x="([\d.]+)" y="([\d.]+)"[^>]*>widgets<\/text>/,
		);
		const dirMatch = svgDir.match(
			/<text x="([\d.]+)" y="([\d.]+)"[^>]*>widgets<\/text>/,
		);
		expect(stubMatch).not.toBeNull();
		expect(dirMatch).not.toBeNull();
		expect([stubMatch?.[1], stubMatch?.[2]]).toEqual([
			dirMatch?.[1],
			dirMatch?.[2],
		]);
	});

	it("does not truncate a stub label even when the layout box is narrow", () => {
		// The label's trailing "(N)" count must always survive — draw.ts no
		// longer truncates stub labels at all; layout.ts is responsible for
		// sizing the box to fit (see layout.test.ts).
		const s = node("stub-dir", {
			type: "stub",
			label: "● a-very-long-directory-name (12)",
		});
		const narrowLayout: Layout = {
			nodes: [{ id: "stub-dir", x: 0, y: 0, width: 60, height: 32 }],
			edges: [],
			width: 100,
			height: 100,
		};
		const svg = toSvg(narrowLayout, [s], []);
		expect(svg).toContain("a-very-long-directory-name (12)");
	});

	it("top-anchors a directory node's label regardless of box height", () => {
		// A compound level1 directory box is taller than a leaf (room for a
		// nested level2 child in its lower portion) — a vertically-centered
		// label would sit right where that child's opaque rect is drawn,
		// covering it. The label must stay near the top of the box regardless
		// of box height.
		const dir = node("settings", {
			type: "directory",
			label: "settings",
			diff: "added",
		});
		const tallLayout: Layout = {
			nodes: [{ id: "settings", x: 0, y: 0, width: 156, height: 76 }],
			edges: [],
			width: 200,
			height: 100,
		};
		const svg = toSvg(tallLayout, [dir], []);
		const textMatch = svg.match(
			/<text x="[\d.]+" y="([\d.]+)"[^>]*>settings<\/text>/,
		);
		expect(textMatch).not.toBeNull();
		const labelY = Number(textMatch?.[1]);
		// Top-anchored (y + 13 from this box's y=0) rather than vertically
		// centered (would be y=42 for a height-76 box, well below the top).
		expect(labelY).toBeLessThan(20);
	});

	it("top-anchors a leaf directory node's label too (no nested child)", () => {
		// A leaf directory box (collapsed mode, no level2 child) has nothing
		// below the label, but it still top-anchors — every directory box's
		// label sits in the same place, whether or not it happens to have a
		// nested child.
		const dir = node("widgets", { type: "directory", label: "● widgets (2)" });
		const svg = toSvg(layout([dir]), [dir], []); // default layout() height is 40
		const textMatch = svg.match(
			/<text x="[\d.]+" y="([\d.]+)"[^>]*>[^<]*widgets[^<]*<\/text>/,
		);
		expect(textMatch).not.toBeNull();
		const labelY = Number(textMatch?.[1]);
		// Top-anchored: y + 13 from this box's y=0.
		expect(labelY).toBe(13);
	});

	it("includes arrow marker definitions in <defs>", () => {
		const svg = toSvg(layout([node("a")]), [node("a")], []);
		expect(svg).toContain("<defs>");
		expect(svg).toContain("<marker");
	});

	it("smooths a bend-point edge into a curve, still anchored at ELK's start/end points, with an arrowhead", () => {
		const n1 = node("a");
		const n2 = node("b");
		const e = edge("a", "b");
		const bentLayout: Layout = {
			nodes: [
				{ id: "a", x: 0, y: 0, width: 140, height: 40 },
				{ id: "b", x: 300, y: 100, width: 140, height: 40 },
			],
			edges: [
				{
					from: "a",
					to: "b",
					sections: [
						{
							startPoint: { x: 140, y: 20 },
							bendPoints: [
								{ x: 200, y: 20 },
								{ x: 200, y: 120 },
							],
							endPoint: { x: 300, y: 120 },
						},
					],
				},
			],
			width: 500,
			height: 200,
		};
		const svg = toSvg(bentLayout, [n1, n2], [e]);
		const path = svg.match(/<path[^>]*data-from="a"[^>]*\/>/)?.[0] ?? "";
		// Still starts and ends exactly at ELK's computed anchor points.
		expect(path).toContain('d="M 140 20');
		expect(path).toContain("300 120");
		// Bends are now rounded via a quadratic Bezier arc at each corner,
		// not a sharp L corner exactly at the bend point.
		expect(path).toContain(" Q ");
		expect(path).not.toMatch(/L 200 20\b/);
		expect(path).not.toMatch(/L 200 120\b/);
		// Arrowhead marker still attached.
		expect(path).toContain("marker-end=");
	});

	it("sets SVG width and height from layout", () => {
		const n = node("a");
		const l = layout([n]);
		const svg = toSvg(l, [n], []);
		expect(svg).toContain(`width="${l.width}"`);
		expect(svg).toContain(`height="${l.height}"`);
	});

	it("no node ever has a stroke-dasharray", () => {
		const n = node("normalNode", { label: "NormalNode" });
		const svg = toSvg(layout([n]), [n], []);
		expect(svg).not.toContain("stroke-dasharray");
	});

	it("a typeOnly node renders identically to any other node — no distinct styling", () => {
		const n = node("typeOnlyNode", { typeOnly: true, label: "TypeOnlyNode" });
		const svg = toSvg(layout([n]), [n], []);
		expect(svg).not.toContain("stroke-dasharray");
		expect(svg).not.toContain('font-style="italic"');
	});

	it("node with hasTests shows cyan dot marker", () => {
		const n = node("tested", { hasTests: true });
		const svg = toSvg(layout([n]), [n], []);
		expect(svg).toContain("#06b6d4");
		expect(svg).toContain("<circle");
	});

	it("node with hasStories shows purple dot marker", () => {
		const n = node("storied", { hasStories: true });
		const svg = toSvg(layout([n]), [n], []);
		expect(svg).toContain("#a855f7");
		expect(svg).toContain("<circle");
	});

	it("node without markers has no circle elements", () => {
		const n = node("plain");
		const svg = toSvg(layout([n]), [n], []);
		expect(svg).not.toContain("<circle");
	});
});

describe("toSvg — node opacity", () => {
	it("unchanged in-scope node renders at reduced opacity", () => {
		const n = node("a", { diff: "unchanged" });
		const svg = toSvg(layout([n]), [n], []);
		const group =
			svg.match(/<g class="node-group" data-id="a"[^>]*>/)?.[0] ?? "";
		expect(group).toMatch(/opacity="0\.\d+"/);
		expect(Number(group.match(/opacity="([\d.]+)"/)?.[1])).toBeLessThan(1);
	});

	it.each([
		"added",
		"modified",
		"removed",
	] as const)("%s node renders at full opacity (no opacity attribute)", (diff) => {
		const n = node("a", { diff });
		const svg = toSvg(layout([n]), [n], []);
		const group =
			svg.match(/<g class="node-group" data-id="a"[^>]*>/)?.[0] ?? "";
		expect(group).not.toContain("opacity=");
	});

	it("in-scope stub node dims like any other unchanged node — a collapsed subdirectory is, by construction, entirely unchanged", () => {
		const n = node("stub-dir", { type: "stub", label: "widgets" });
		const svg = toSvg(layout([n]), [n], []);
		const group =
			svg.match(/<g class="node-group" data-id="stub-dir"[^>]*>/)?.[0] ?? "";
		expect(group).toMatch(/opacity="0\.\d+"/);
	});

	it("in-scope stub node stays full opacity if a changed edge was remapped onto it", () => {
		// The stub itself never earns its own diff state — it's still hardcoded
		// "unchanged" — but a changed edge touching it should still light it up,
		// same as any other node reached by the broader touchedIds definition.
		const stub = node("stub-dir", { type: "stub", label: "widgets" });
		const other = node("other", { diff: "modified" });
		const e = edge("other", "stub-dir", "added");
		const svg = toSvg(layout([stub, other], [e]), [stub, other], [e]);
		const group =
			svg.match(/<g class="node-group" data-id="stub-dir"[^>]*>/)?.[0] ?? "";
		expect(group).not.toContain("opacity=");
	});

	it("out-of-scope leaf node is exempt from dimming regardless of diff", () => {
		const n = node("oos", { scope: "out-of-scope", diff: "unchanged" });
		const svg = toSvg(layout([n]), [n], []);
		const group =
			svg.match(/<g class="node-group" data-id="oos"[^>]*>/)?.[0] ?? "";
		expect(group).not.toContain("opacity=");
	});

	it("out-of-scope stub (collapsed out-of-scope directory) dims when untouched, same as an in-scope stub", () => {
		const n = node("stub-oos", {
			type: "stub",
			scope: "out-of-scope",
			label: "vendor",
		});
		const svg = toSvg(layout([n]), [n], []);
		const group =
			svg.match(/<g class="node-group" data-id="stub-oos"[^>]*>/)?.[0] ?? "";
		expect(group).toMatch(/opacity="0\.\d+"/);
	});

	it("out-of-scope stub stays full opacity if a changed edge was remapped onto it", () => {
		const stub = node("stub-oos", {
			type: "stub",
			scope: "out-of-scope",
			label: "vendor",
		});
		const other = node("other", { diff: "modified" });
		const e = edge("other", "stub-oos", "added");
		const svg = toSvg(layout([stub, other], [e]), [stub, other], [e]);
		const group =
			svg.match(/<g class="node-group" data-id="stub-oos"[^>]*>/)?.[0] ?? "";
		expect(group).not.toContain("opacity=");
	});

	it("out-of-scope directory box (Collapsed view) dims when untouched, same as an in-scope directory box", () => {
		const n = node("dir-oos", {
			type: "directory",
			scope: "out-of-scope",
			label: "vendor",
		});
		const svg = toSvg(layout([n]), [n], []);
		const group =
			svg.match(/<g class="node-group" data-id="dir-oos"[^>]*>/)?.[0] ?? "";
		expect(group).toMatch(/opacity="0\.\d+"/);
	});

	it("content-unchanged node with a changed edge going into it renders at full opacity", () => {
		// b's own content is unchanged, but a modified file a just gained a new
		// import into it — that's context a reviewer needs to see, not context
		// that should recede.
		const a = node("a", { diff: "modified" });
		const b = node("b"); // unchanged
		const e = edge("a", "b", "added");
		const svg = toSvg(layout([a, b], [e]), [a, b], [e]);
		const group =
			svg.match(/<g class="node-group" data-id="b"[^>]*>/)?.[0] ?? "";
		expect(group).not.toContain("opacity=");
	});

	it("content-unchanged node with no changed edges anywhere near it renders dimmed", () => {
		const a = node("a"); // unchanged
		const b = node("b"); // unchanged
		const e = edge("a", "b"); // unchanged edge
		const svg = toSvg(layout([a, b], [e]), [a, b], [e]);
		const group =
			svg.match(/<g class="node-group" data-id="b"[^>]*>/)?.[0] ?? "";
		expect(group).toMatch(/opacity="0\.\d+"/);
	});

	it("unchanged directory node renders at reduced opacity like any other unchanged node", () => {
		const n = node("dir", { type: "directory", diff: "unchanged" });
		const svg = toSvg(layout([n]), [n], []);
		const group =
			svg.match(/<g class="node-group" data-id="dir"[^>]*>/)?.[0] ?? "";
		expect(group).toMatch(/opacity="0\.\d+"/);
	});
});

// ─── subdirectory group boxes (issue #28) ─────────────────────────────────────

describe("toSvg — subdirectory group boxes", () => {
	it("renders a solid rect and label for each subdirContainers entry", () => {
		const nodes = [node("a"), node("b")];
		const l = layout(nodes);
		l.subdirContainers = [
			{ x: 10, y: 20, width: 300, height: 100, label: "○ widgets (2)" },
		];
		const svg = toSvg(l, nodes, [], "feature");
		expect(svg).not.toContain("stroke-dasharray");
		expect(svg).toContain(">○ widgets (2)<");
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
		expect(svg).not.toContain("stroke-dasharray");
	});
});
