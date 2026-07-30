import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { analyze } from "../analyzer.js";
import { diffGraphs } from "../diff-parser.js";
import { addContext } from "../filter.js";
import { toSvg } from "./draw.js";
import { computeViewNodes } from "./graph-helpers.js";
import { computeLayout } from "./layout.js";

const SNAPSHOTS_REFERENCE = path.resolve("test/snapshots/reference");
const SNAPSHOTS_CURRENT = path.resolve("test/snapshots/current");

interface Fixture {
	repoRoot: string;
	baseRoot: string;
	scope: string;
	baseScope: string;
	sourceRoot: string;
}

const FAKE_ANGULAR_APP: Fixture = {
	repoRoot: path.resolve("fake-angular-app"),
	baseRoot: path.resolve("fake-angular-app-base"),
	scope: path.resolve("fake-angular-app/src/app/features/users"),
	baseScope: path.resolve("fake-angular-app-base/src/app/features/users"),
	sourceRoot: "src/app",
};

const SAMPLE_APP: Fixture = {
	repoRoot: path.resolve("sample-app"),
	baseRoot: path.resolve("sample-app-base"),
	scope: path.resolve("sample-app/src/app/features/dashboard"),
	baseScope: path.resolve("sample-app-base/src/app/features/dashboard"),
	sourceRoot: "src/app",
};

const FIRA_CODE_PATH = path.resolve("test/fixtures/fonts/FiraCode-Regular.ttf");

function rasterize(svg: string): {
	data: Buffer;
	width: number;
	height: number;
} {
	const resvg = new Resvg(svg, {
		fitTo: { mode: "zoom", value: 2 },
		font: { fontFiles: [FIRA_CODE_PATH], loadSystemFonts: false },
	});
	const rendered = resvg.render();
	return {
		data: Buffer.from(rendered.asPng()),
		width: rendered.width,
		height: rendered.height,
	};
}

function compareWithSnapshot(svg: string, name: string): number {
	const referencePath = path.join(SNAPSHOTS_REFERENCE, `${name}.png`);
	const currentPath = path.join(SNAPSHOTS_CURRENT, `${name}.png`);
	const { data, width, height } = rasterize(svg);

	mkdirSync(SNAPSHOTS_CURRENT, { recursive: true });
	writeFileSync(currentPath, data);

	if (!existsSync(referencePath)) {
		throw new Error(
			`No reference snapshot for "${name}" at ${referencePath}. ` +
				`Review the rendered output at ${currentPath}, then run \`npm run test:visual:approve\` to accept it as the new baseline.`,
		);
	}

	const ref = PNG.sync.read(readFileSync(referencePath));
	const actual = PNG.sync.read(data);
	const diff = new PNG({ width, height });
	return pixelmatch(ref.data, actual.data, diff.data, width, height, {
		threshold: 0.1,
	});
}

async function buildSvg(
	fixture: Fixture,
	mode: "all" | "diff-focused",
): Promise<string> {
	const [base, current] = await Promise.all([
		analyze(fixture.baseScope, { repoRoot: fixture.baseRoot }).then(addContext),
		analyze(fixture.scope, { repoRoot: fixture.repoRoot }).then(addContext),
	]);
	const diffed = diffGraphs(base, current);
	const { nodes, edges } = computeViewNodes(diffed, mode);
	const layout = await computeLayout(
		nodes,
		edges,
		fixture.sourceRoot,
		diffed.meta.scopeDir,
	);
	return toSvg(
		layout,
		nodes,
		edges,
		path.basename(fixture.scope),
		fixture.sourceRoot,
	);
}

describe("visual regression — fake-angular-app fixture", () => {
	it("diff-focused mode renders correctly", async () => {
		const svg = await buildSvg(FAKE_ANGULAR_APP, "diff-focused");
		const diff = compareWithSnapshot(svg, "diff-focused");
		expect(diff).toBe(0);
	});

	it("all-nodes mode renders correctly", async () => {
		const svg = await buildSvg(FAKE_ANGULAR_APP, "all");
		const diff = compareWithSnapshot(svg, "all-nodes");
		expect(diff).toBe(0);
	});
});

describe("visual regression — sample-app fixture", () => {
	it("diff-focused mode renders correctly", async () => {
		const svg = await buildSvg(SAMPLE_APP, "diff-focused");
		const diff = compareWithSnapshot(svg, "sample-diff-focused");
		expect(diff).toBe(0);
	});

	it("all-nodes mode renders correctly", async () => {
		const svg = await buildSvg(SAMPLE_APP, "all");
		const diff = compareWithSnapshot(svg, "sample-all-nodes");
		expect(diff).toBe(0);
	});
});
