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
		type: "component",
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

	it("in-scope node shows label only — no type or diff text inside node", () => {
		const n = node("svc", {
			label: "MyService",
			type: "service",
			diff: "added",
		});
		const svg = toSvg(layout([n]), [n], []);
		expect(svg).toContain("MyService");
		expect(svg).not.toContain("service · added");
		expect(svg).not.toContain(">service<");
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

	it("renders added edges with green stroke color", () => {
		const n1 = node("a");
		const n2 = node("b");
		const e = edge("a", "b", "added");
		const svg = toSvg(layout([n1, n2], [e]), [n1, n2], [e]);
		expect(svg).toContain("#22c55e"); // green
	});

	it("renders removed edges with dashed stroke", () => {
		const n1 = node("a");
		const n2 = node("b", { scope: "removed-ghost", diff: "removed" });
		const e = edge("a", "b", "removed");
		const svg = toSvg(layout([n1, n2], [e]), [n1, n2], [e]);
		expect(svg).toContain("stroke-dasharray");
	});

	it("renders stub nodes with a solid border", () => {
		const s = node("stub-dir", { type: "stub", label: "● data-access (2)" });
		const svg = toSvg(layout([s]), [s], []);
		expect(svg).not.toContain("stroke-dasharray");
		expect(svg).toContain("data-access");
	});

	it("top-anchors a directory node's label instead of vertically centering it", () => {
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

	it("includes arrow marker definitions in <defs>", () => {
		const svg = toSvg(layout([node("a")]), [node("a")], []);
		expect(svg).toContain("<defs>");
		expect(svg).toContain("<marker");
	});

	it("sets SVG width and height from layout", () => {
		const n = node("a");
		const l = layout([n]);
		const svg = toSvg(l, [n], []);
		expect(svg).toContain(`width="${l.width}"`);
		expect(svg).toContain(`height="${l.height}"`);
	});

	it("type-only node has stroke-dasharray on rect", () => {
		const n = node("typeOnlyNode", { typeOnly: true, label: "TypeOnlyNode" });
		const svg = toSvg(layout([n]), [n], []);
		expect(svg).toContain('stroke-dasharray="4,2"');
	});

	it("type-only node label has font-style italic", () => {
		const n = node("typeOnlyNode", { typeOnly: true, label: "TypeOnlyNode" });
		const svg = toSvg(layout([n]), [n], []);
		expect(svg).toContain('font-style="italic"');
	});

	it("non-type-only node does not have stroke-dasharray (unless removed)", () => {
		const n = node("normalNode", { label: "NormalNode" });
		const svg = toSvg(layout([n]), [n], []);
		expect(svg).not.toContain("stroke-dasharray");
	});

	it("type-only out-of-scope node has stroke-dasharray and italic label", () => {
		const n = node("oosTypeOnly", {
			typeOnly: true,
			scope: "out-of-scope",
			diff: null,
			label: "OosNode",
		});
		const svg = toSvg(layout([n]), [n], []);
		expect(svg).toContain('stroke-dasharray="4,2"');
		expect(svg).toContain('font-style="italic"');
	});

	it("node with hasTests shows green dot marker", () => {
		const n = node("tested", { hasTests: true });
		const svg = toSvg(layout([n]), [n], []);
		expect(svg).toContain("#22c55e");
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

// ─── subdirectory group boxes (issue #28) ─────────────────────────────────────

describe("toSvg — subdirectory group boxes", () => {
	it("renders a solid rect and label for each subdirContainers entry", () => {
		const nodes = [node("a"), node("b")];
		const l = layout(nodes);
		l.subdirContainers = [
			{ x: 10, y: 20, width: 300, height: 100, label: "○ widgets (2)" },
		];
		const svg = toSvg(l, nodes, [], "feature");
		expect(svg).not.toContain('stroke-dasharray="3,2"');
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
		expect(svg).not.toContain('stroke-dasharray="3,2"');
	});
});
