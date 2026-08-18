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
	type: "component",
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
