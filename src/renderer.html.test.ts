import { readFile } from "node:fs/promises";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

// DOM-level tests for the client script in renderer.html. Loads the template
// with embedded data (same substitution the CLI's buildHtml performs) into a
// happy-dom window so the inline <script> executes.

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
		all: {
			nodes: [
				node("alpha", "unchanged", 10),
				node("beta", "added", 150),
				node("gamma", "unchanged", 290),
			],
			edges: [],
			width: 440,
			height: 120,
		},
		diffFocused: {
			nodes: [node("alpha", "unchanged", 10), node("beta", "added", 150)],
			edges: [],
			width: 300,
			height: 120,
		},
	},
};

async function loadDiagram() {
	const template = await readFile(
		new URL("./renderer.html", import.meta.url),
		"utf8",
	);
	const html = template.replace(
		"__DIFF_DIAGRAM_DATA__",
		JSON.stringify(FIXTURE),
	);
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
	it("opens in diff-focused mode by default", async () => {
		const window = await loadDiagram();

		expect(window.document.querySelectorAll(".node-group")).toHaveLength(2);
		expect(window.document.getElementById("meta-nodes")?.textContent).toBe("2");
		expect(
			modeButton(window, "Diff-focused").classList.contains("active"),
		).toBe(true);
		expect(modeButton(window, "All nodes").classList.contains("active")).toBe(
			false,
		);
	});

	it("clicking the mode buttons switches the rendered view", async () => {
		const window = await loadDiagram();

		modeButton(window, "All nodes").click();
		expect(window.document.querySelectorAll(".node-group")).toHaveLength(3);
		expect(window.document.getElementById("meta-nodes")?.textContent).toBe("3");

		modeButton(window, "Diff-focused").click();
		expect(window.document.querySelectorAll(".node-group")).toHaveLength(2);
		expect(window.document.getElementById("meta-nodes")?.textContent).toBe("2");
		expect(
			modeButton(window, "Diff-focused").classList.contains("active"),
		).toBe(true);
		expect(modeButton(window, "All nodes").classList.contains("active")).toBe(
			false,
		);
	});
});
