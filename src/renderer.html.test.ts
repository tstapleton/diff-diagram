import { existsSync } from "node:fs";
import { Window } from "happy-dom";
import { beforeAll, describe, expect, it } from "vitest";
import { buildHtml } from "./cli.js";

// DOM-level tests for the client script in renderer.html. Runs the template
// through the real buildHtml() — the same function the CLI uses to produce
// diagram.html, including the compiled-render.js splice — into a happy-dom
// window so the inline <script> executes.

beforeAll(() => {
	const renderJsPath = new URL("../dist/renderer/render.js", import.meta.url)
		.pathname;
	if (!existsSync(renderJsPath)) {
		throw new Error(
			"dist/renderer/render.js not found — run `npm run build` before running this test",
		);
	}
});

const node = (id: string, diff: string, x: number) => ({
	id,
	label: `${id}.component`,
	file: `src/app/features/users/${id}/${id}.component.ts`,
	type: "file",
	scope: "in-scope",
	diff,
	x,
	y: 10,
	width: 120,
	height: 36,
});

const FIXTURE = {
	meta: { scopeDir: "src/app/features/users" },
	sourceRoot: "src/app",
	modes: {
		expanded: {
			nodes: [
				node("alpha", "unchanged", 10),
				node("beta", "added", 150),
				node("gamma", "unchanged", 290),
			],
			edges: [],
			width: 440,
			height: 120,
			subdirContainers: [
				{ x: 5, y: 5, width: 400, height: 60, label: "○ widgets (3)" },
			],
		},
		focused: {
			nodes: [node("alpha", "unchanged", 10), node("beta", "added", 150)],
			edges: [],
			width: 300,
			height: 120,
		},
		collapsed: {
			nodes: [
				{
					...node("widgets", "unchanged", 10),
					id: "dir_widgets",
					type: "directory",
					label: "widgets",
				},
			],
			edges: [],
			width: 200,
			height: 80,
		},
	},
};

async function loadDiagram(data: unknown = FIXTURE) {
	const templatePath = new URL("./renderer.html", import.meta.url).pathname;
	// biome-ignore lint/suspicious/noExplicitAny: FIXTURE is a hand-shaped test double, not a full DiagramData
	const html = await buildHtml(data as any, templatePath);
	// The template's inline script is our own trusted code, so JavaScript
	// evaluation is safe to enable here.
	const window = new Window({
		settings: {
			enableJavaScriptEvaluation: true,
			suppressInsecureJavaScriptEnvironmentWarning: true,
		},
	});
	window.document.write(html);
	await window.happyDOM.waitUntilComplete();
	return window;
}

function modeButton(window: Window, label: string) {
	const btn = [...window.document.querySelectorAll(".mode-btn")].find(
		(b) => b.textContent?.trim() === label,
	);
	if (!btn) throw new Error(`mode button "${label}" not found`);
	return btn;
}

describe("renderer.html view-mode switching", () => {
	it("opens in focused mode by default", async () => {
		const window = await loadDiagram();

		expect(window.document.querySelectorAll(".node-group")).toHaveLength(2);
		expect(window.document.getElementById("meta-nodes")?.textContent).toBe("2");
		expect(modeButton(window, "Focused").classList.contains("active")).toBe(
			true,
		);
		expect(modeButton(window, "Expanded").classList.contains("active")).toBe(
			false,
		);
	});

	it("clicking the mode buttons switches the rendered view", async () => {
		const window = await loadDiagram();

		modeButton(window, "Expanded").click();
		expect(window.document.querySelectorAll(".node-group")).toHaveLength(3);
		expect(window.document.getElementById("meta-nodes")?.textContent).toBe("3");

		modeButton(window, "Focused").click();
		expect(window.document.querySelectorAll(".node-group")).toHaveLength(2);
		expect(window.document.getElementById("meta-nodes")?.textContent).toBe("2");
		expect(modeButton(window, "Focused").classList.contains("active")).toBe(
			true,
		);
		expect(modeButton(window, "Expanded").classList.contains("active")).toBe(
			false,
		);
	});

	it("switches to collapsed mode too", async () => {
		const window = await loadDiagram();

		modeButton(window, "Collapsed").click();
		expect(window.document.querySelectorAll(".node-group")).toHaveLength(1);
		expect(window.document.getElementById("meta-nodes")?.textContent).toBe("1");
		expect(modeButton(window, "Collapsed").classList.contains("active")).toBe(
			true,
		);
	});
});

describe("renderer.html hover highlighting", () => {
	const HOVER_FIXTURE = {
		meta: { scopeDir: "src/app/features/users" },
		sourceRoot: "src/app",
		modes: {
			expanded: {
				nodes: [
					node("alpha", "unchanged", 10),
					node("beta", "unchanged", 150),
					node("gamma", "unchanged", 290),
				],
				edges: [
					{
						from: "alpha",
						to: "beta",
						sections: [
							{ startPoint: { x: 130, y: 28 }, endPoint: { x: 150, y: 28 } },
						],
					},
					{
						from: "beta",
						to: "gamma",
						sections: [
							{ startPoint: { x: 270, y: 28 }, endPoint: { x: 290, y: 28 } },
						],
					},
				],
				width: 440,
				height: 120,
			},
			focused: {
				nodes: [
					node("alpha", "unchanged", 10),
					node("beta", "unchanged", 150),
					node("gamma", "unchanged", 290),
				],
				edges: [
					{
						from: "alpha",
						to: "beta",
						sections: [
							{ startPoint: { x: 130, y: 28 }, endPoint: { x: 150, y: 28 } },
						],
					},
					{
						from: "beta",
						to: "gamma",
						sections: [
							{ startPoint: { x: 270, y: 28 }, endPoint: { x: 290, y: 28 } },
						],
					},
				],
				width: 440,
				height: 120,
			},
		},
	};

	function nodeGroup(window: Window, id: string) {
		const g = window.document.querySelector(`[data-id="${id}"]`);
		if (!g) throw new Error(`node group "${id}" not found`);
		return g;
	}

	function edgePath(window: Window, from: string, to: string) {
		const p = window.document.querySelector(
			`path[data-from="${from}"][data-to="${to}"]`,
		);
		if (!p) throw new Error(`edge path ${from}->${to} not found`);
		return p as HTMLElement;
	}

	it("dims edges not connected to the hovered node", async () => {
		const window = await loadDiagram(HOVER_FIXTURE);

		// mouseover bubbles from a child of the node-group, exercising the
		// same closest('[data-id]') lookup a real pointer event would hit.
		const event = new window.MouseEvent("mouseover", { bubbles: true });
		nodeGroup(window, "beta").querySelector("rect")?.dispatchEvent(event);

		expect(edgePath(window, "alpha", "beta").style.opacity).toBe("1");
		expect(edgePath(window, "beta", "gamma").style.opacity).toBe("1");
	});

	it("keeps unconnected edges dimmed and connected edges at full opacity", async () => {
		const window = await loadDiagram(HOVER_FIXTURE);

		const event = new window.MouseEvent("mouseover", { bubbles: true });
		nodeGroup(window, "alpha").querySelector("rect")?.dispatchEvent(event);

		expect(edgePath(window, "alpha", "beta").style.opacity).toBe("1");
		expect(edgePath(window, "beta", "gamma").style.opacity).toBe("0.2");
	});

	it("restores full opacity on mouseleave", async () => {
		const window = await loadDiagram(HOVER_FIXTURE);
		// Scoped to #svg-wrap: the sidebar legend has its own small <svg> icons
		// (test/story markers), so a bare "svg" selector can match those instead
		// of the diagram — which is exactly what attachHover() is bound to.
		const svg = window.document.querySelector("#svg-wrap svg") as HTMLElement;

		nodeGroup(window, "alpha")
			.querySelector("rect")
			?.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
		expect(edgePath(window, "beta", "gamma").style.opacity).toBe("0.2");

		svg.dispatchEvent(new window.MouseEvent("mouseleave", { bubbles: true }));
		expect(edgePath(window, "alpha", "beta").style.opacity).toBe("");
		expect(edgePath(window, "beta", "gamma").style.opacity).toBe("");
	});
});

describe("renderer.html subdirectory group boxes", () => {
	it("renders one .subdir-group element per subdirContainers entry", async () => {
		const window = await loadDiagram();
		modeButton(window, "Expanded").click();
		expect(window.document.querySelectorAll(".subdir-group")).toHaveLength(1);
		expect(window.document.querySelector(".subdir-group")?.textContent).toBe(
			"○ widgets (3)",
		);
	});

	it("renders no .subdir-group elements when subdirContainers is absent", async () => {
		const window = await loadDiagram();
		// starts in focused mode by default, which has no subdirContainers
		expect(window.document.querySelectorAll(".subdir-group")).toHaveLength(0);
	});
});

describe("renderer.html change magnitude", () => {
	const MAGNITUDE_FIXTURE = {
		meta: { scopeDir: "src/app/features/users" },
		sourceRoot: "src/app",
		modes: {
			expanded: {
				nodes: [
					{ ...node("low", "added", 10), magnitude: 0.1 },
					{ ...node("high", "added", 150), magnitude: 1 },
				],
				edges: [],
				width: 300,
				height: 120,
			},
			focused: {
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
		expect(highFill).toBe("#1f6b3d");
		expect(lowFill).not.toBe("#1f6b3d");
		expect(lowFill).not.toBe("#2d3f5c");
	});

	it("includes a change-magnitude legend row", async () => {
		const window = await loadDiagram();
		expect(window.document.body.textContent).toContain("Change magnitude");
	});
});
