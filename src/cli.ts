#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyze } from "./analyzer.js";
import { diffGraphs } from "./diff-parser.js";
import { addContext } from "./filter.js";
import { toSvg } from "./renderer/draw.js";
import { computeViewNodes } from "./renderer/graph-helpers.js";
import type { Layout } from "./renderer/layout.js";
import { computeLayout } from "./renderer/layout.js";
import type { Graph, GraphEdge, GraphNode } from "./types.js";

// ─── Args ─────────────────────────────────────────────────────────────────────

interface Args {
	baseRepoRoot: string | null;
	outDir: string;
	tsConfig: string | null;
	repoRoot: string | null;
	scopeDir: string | null;
	sourceRoot: string;
}

function printHelp(): void {
	console.log("Usage: diff-diagram [options] <feature-dir>");
	console.log("");
	console.log(
		"Generate a dependency diagram for an Angular feature directory.",
	);
	console.log("");
	console.log("Arguments:");
	console.log(
		"  feature-dir              Feature directory to diagram (relative to --repo-root)",
	);
	console.log("");
	console.log("Options:");
	console.log(
		"  --repo-root <path>       Repo root for the current branch (default: current working directory)",
	);
	console.log(
		"  --base-repo-root <path>  Repo root for a pre-checked-out base branch (enables diff)",
	);
	console.log("  --out-dir <dir>          Output directory (default: dist)");
	console.log(
		"  --tsconfig <file>        Path to tsconfig.json (auto-detected)",
	);
	console.log(
		"  --source-root <dir>      Source root prefix for label derivation (default: src/app)",
	);
	console.log("  -h, --help               Show this help message");
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		baseRepoRoot: null,
		outDir: "dist",
		tsConfig: null,
		repoRoot: null,
		scopeDir: null,
		sourceRoot: "src/app",
	};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "-h" || argv[i] === "--help") {
			printHelp();
			process.exit(0);
		}
		if (argv[i] === "--base-repo-root") {
			args.baseRepoRoot = argv[++i];
			continue;
		}
		if (argv[i] === "--out-dir") {
			args.outDir = argv[++i];
			continue;
		}
		if (argv[i] === "--tsconfig") {
			args.tsConfig = argv[++i];
			continue;
		}
		if (argv[i] === "--repo-root") {
			args.repoRoot = argv[++i];
			continue;
		}
		if (argv[i] === "--source-root") {
			args.sourceRoot = argv[++i];
			continue;
		}
		if (!argv[i].startsWith("-")) {
			args.scopeDir = argv[i];
		}
	}
	return args;
}

// ─── Repo root detection ──────────────────────────────────────────────────────

function _detectRepoRoot(startDir: string): string {
	let dir = startDir;
	while (path.dirname(dir) !== dir) {
		if (existsSync(path.join(dir, ".git"))) return dir;
		dir = path.dirname(dir);
	}
	return startDir;
}

// ─── Diagram data builder ────────────────────────────────────────────────────

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
}

interface DiagramData {
	meta: Omit<Graph["meta"], "repoRoot">;
	sourceRoot: string;
	modes: { all: ModeData; diffFocused: ModeData };
}

function buildModeData(
	viewNodes: GraphNode[],
	viewEdges: GraphEdge[],
	layout: Layout,
): ModeData {
	const nodeById = new Map(viewNodes.map((n) => [n.id, n]));
	const edgeByKey = new Map(viewEdges.map((e) => [`${e.from}→${e.to}`, e]));

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

	const edges = layout.edges.map((le) => {
		const ge = edgeByKey.get(`${le.from}→${le.to}`);
		return ge?.diff ? { ...le, diff: ge.diff } : { ...le };
	});

	return {
		nodes,
		edges,
		width: layout.width,
		height: layout.height,
		container: layout.container,
	};
}

// ─── HTML builder ────────────────────────────────────────────────────────────

async function buildHtml(
	data: DiagramData,
	templatePath: string,
): Promise<string> {
	const template = await readFile(templatePath, "utf8");
	return template.replace("__DIFF_DIAGRAM_DATA__", JSON.stringify(data));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));

	if (!args.scopeDir) {
		printHelp();
		process.exit(1);
	}

	const repoRoot = args.repoRoot ? path.resolve(args.repoRoot) : process.cwd();
	const scopeDir = path.resolve(repoRoot, args.scopeDir);
	const outDir = path.resolve(args.outDir);

	if (!existsSync(scopeDir)) {
		console.error(`Error: feature directory not found: ${scopeDir}`);
		process.exit(1);
	}

	console.log(`Analyzing ${path.relative(repoRoot, scopeDir)} ...`);
	const current = addContext(
		await analyze(scopeDir, { repoRoot, tsConfigPath: args.tsConfig }),
	);
	console.log(
		`  ${current.nodes.filter((n) => n.scope === "in-scope").length} in-scope nodes, ${current.edges.length} edges`,
	);
	console.log(
		`  +${current.nodes.filter((n) => n.scope === "out-of-scope").length} out-of-scope context nodes`,
	);
	if (current.nodes.length === 0) {
		console.warn(
			`Warning: current graph has 0 nodes — no TypeScript files found in ${scopeDir}`,
		);
	}

	let diffed: Graph = current;

	if (args.baseRepoRoot) {
		const baseRepoRoot = path.resolve(args.baseRepoRoot);
		const baseScopeDir = path.resolve(baseRepoRoot, args.scopeDir);

		if (!existsSync(baseScopeDir)) {
			console.log("Feature dir absent in base — treating all files as added");
		}
		console.log(
			`Analyzing base at ${path.relative(baseRepoRoot, baseScopeDir)} ...`,
		);
		const base = addContext(
			await analyze(baseScopeDir, {
				repoRoot: baseRepoRoot,
				tsConfigPath: args.tsConfig,
			}),
		);
		console.log(
			`  ${base.nodes.filter((n) => n.scope === "in-scope").length} in-scope nodes`,
		);

		diffed = diffGraphs(base, current);
		const added = diffed.nodes.filter((n) => n.diff === "added").length;
		const modified = diffed.nodes.filter((n) => n.diff === "modified").length;
		const removed = diffed.nodes.filter((n) => n.diff === "removed").length;
		console.log(
			`  Diff: ${added} added, ${modified} modified, ${removed} removed`,
		);
	}

	// Compute layouts for both view modes in parallel
	console.log("Computing layouts...");
	const allView = computeViewNodes(diffed, "all");
	const diffView = computeViewNodes(diffed, "diff-focused");

	const [allLayout, diffLayout] = await Promise.all([
		computeLayout(allView.nodes, allView.edges, args.sourceRoot),
		computeLayout(diffView.nodes, diffView.edges, args.sourceRoot),
	]);

	await mkdir(outDir, { recursive: true });

	// diagram.svg — diff-focused, real layout
	const svg = toSvg(
		diffLayout,
		diffView.nodes,
		diffView.edges,
		path.basename(scopeDir),
		args.sourceRoot,
	);
	const svgPath = path.join(outDir, "diagram.svg");
	await writeFile(svgPath, svg);
	console.log(`Wrote ${svgPath}`);

	// diagram.html — interactive, all modes embedded
	const { repoRoot: _root, ...metaWithoutRoot } = diffed.meta;
	const diagramData: DiagramData = {
		meta: metaWithoutRoot,
		sourceRoot: args.sourceRoot,
		modes: {
			all: buildModeData(allView.nodes, allView.edges, allLayout),
			diffFocused: buildModeData(diffView.nodes, diffView.edges, diffLayout),
		},
	};
	const templatePath = new URL("../src/renderer.html", import.meta.url)
		.pathname;
	const html = await buildHtml(diagramData, templatePath);
	const htmlPath = path.join(outDir, "diagram.html");
	await writeFile(htmlPath, html);
	console.log(`Wrote ${htmlPath}`);

	// graph.json
	const { _oosEdges, ...graphOut } = diffed;
	const jsonPath = path.join(outDir, "graph.json");
	await writeFile(jsonPath, JSON.stringify(graphOut, null, 2));
	console.log(`Wrote ${jsonPath}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
