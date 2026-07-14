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
		expect(fill).toBe("#14532d");
	});

	it("modified node uses amber fill", () => {
		const { fill } = nodeColor(node("a", { diff: "modified" }));
		expect(fill).toBe("#78350f");
	});

	it("removed node uses red fill", () => {
		const { fill } = nodeColor(node("a", { diff: "removed" }));
		expect(fill).toBe("#7f1d1d");
	});

	it("unchanged node uses slate fill", () => {
		const { fill } = nodeColor(node("a", { diff: "unchanged" }));
		expect(fill).toBe("#1e293b");
	});

	it("out-of-scope node uses OOS fill regardless of diff", () => {
		const { fill } = nodeColor(
			node("a", { scope: "out-of-scope", diff: "added" }),
		);
		expect(fill).toBe("#0a1829");
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

// ─── edgeStroke ──────────────────────────────────────────────────────────────

describe("edgeStroke", () => {
	it("added edge is green", () => expect(edgeStroke("added")).toBe("#22c55e"));
	it("removed edge is red", () =>
		expect(edgeStroke("removed")).toBe("#ef4444"));
	it("unchanged edge is slate", () =>
		expect(edgeStroke("unchanged")).toBe("#475569"));
	it("undefined diff falls back to unchanged color", () =>
		expect(edgeStroke(undefined)).toBe("#475569"));
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

	it("renders stub nodes with dashed border", () => {
		const s = node("stub-dir", { type: "stub", label: "data-access" });
		const svg = toSvg(layout([s]), [s], []);
		expect(svg).toContain("stroke-dasharray");
		expect(svg).toContain("data-access");
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

	it("non-type-only node does not have stroke-dasharray (unless stub or removed)", () => {
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

// ─── lerpHex ─────────────────────────────────────────────────────────────────

describe("lerpHex", () => {
	it("returns the from color at t = 0", () => {
		expect(lerpHex("#1e293b", "#78350f", 0)).toBe("#1e293b");
	});

	it("returns the to color at t = 1", () => {
		expect(lerpHex("#1e293b", "#78350f", 1)).toBe("#78350f");
	});

	it("returns the per-channel midpoint at t = 0.5", () => {
		expect(lerpHex("#000000", "#ffffff", 0.5)).toBe("#808080");
	});

	it("interpolates each channel independently", () => {
		// #1e293b = (30,41,59), #78350f = (120,53,15) → mid (75,47,37) = #4b2f25
		expect(lerpHex("#1e293b", "#78350f", 0.5)).toBe("#4b2f25");
	});

	it("clamps t below 0", () => {
		expect(lerpHex("#1e293b", "#78350f", -1)).toBe("#1e293b");
	});

	it("clamps t above 1", () => {
		expect(lerpHex("#1e293b", "#78350f", 2)).toBe("#78350f");
	});

	it("pads channels so the result is always 6 hex digits", () => {
		expect(lerpHex("#000000", "#00000f", 1)).toBe("#00000f");
	});
});

// ─── nodeColor with change magnitude ─────────────────────────────────────────

describe("nodeColor with magnitude", () => {
	it("magnitude 1 keeps exactly the full diff-state fill", () => {
		const { fill } = nodeColor(node("a", { diff: "added", magnitude: 1 }));
		expect(fill).toBe("#14532d");
	});

	it("magnitude 0 renders the unchanged fill", () => {
		const { fill } = nodeColor(node("a", { diff: "modified", magnitude: 0 }));
		expect(fill).toBe("#1e293b");
	});

	it("intermediate magnitude lerps toward the diff-state fill", () => {
		const { fill } = nodeColor(node("a", { diff: "modified", magnitude: 0.5 }));
		expect(fill).toBe("#4b2f25");
	});

	it("removed nodes lerp toward the removed fill", () => {
		// #1e293b = (30,41,59), #7f1d1d = (127,29,29) → mid (79,35,44) = #4f232c
		const { fill } = nodeColor(node("a", { diff: "removed", magnitude: 0.5 }));
		expect(fill).toBe("#4f232c");
	});

	it("added nodes lerp toward the added fill", () => {
		// #1e293b = (30,41,59), #14532d = (20,83,45) → mid (25,62,52) = #193e34
		const { fill } = nodeColor(node("a", { diff: "added", magnitude: 0.5 }));
		expect(fill).toBe("#193e34");
	});

	it("changed node without magnitude keeps the full diff-state fill", () => {
		const { fill } = nodeColor(node("a", { diff: "modified" }));
		expect(fill).toBe("#78350f");
	});

	it("unchanged node keeps its exact fill even if magnitude is present", () => {
		const { fill } = nodeColor(
			node("a", { diff: "unchanged", magnitude: 0.5 }),
		);
		expect(fill).toBe("#1e293b");
	});

	it("magnitude does not affect the stroke", () => {
		const { stroke } = nodeColor(
			node("a", { diff: "modified", magnitude: 0.1 }),
		);
		expect(stroke).toBe("#f59e0b");
	});

	it("out-of-scope nodes ignore magnitude", () => {
		const { fill } = nodeColor(
			node("a", { scope: "out-of-scope", diff: "added", magnitude: 0.5 }),
		);
		expect(fill).toBe("#0a1829");
	});
});
