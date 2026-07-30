#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
		"  --source-root <dir>      Source root prefix for label derivation (default: src/app)",
	);
	console.log("  -h, --help               Show this help message");
}

// Reads the value for a flag at `argv[index]`, erroring if it's missing or
// looks like another flag (e.g. `--out-dir` as the last token, or immediately
// followed by another `-`-prefixed option).
function requireFlagValue(argv: string[], index: number, flag: string): string {
	const value = argv[index];
	if (value === undefined || value.startsWith("-")) {
		throw new Error(`Error: ${flag} requires a value`);
	}
	return value;
}

export function parseArgs(argv: string[]): Args {
	const args: Args = {
		baseRepoRoot: null,
		outDir: "dist",
		repoRoot: null,
		scopeDir: null,
		sourceRoot: "src/app",
	};
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];
		if (token === "-h" || token === "--help") {
			printHelp();
			process.exit(0);
		}
		if (token === "--base-repo-root") {
			args.baseRepoRoot = requireFlagValue(argv, ++i, token);
			continue;
		}
		if (token === "--out-dir") {
			args.outDir = requireFlagValue(argv, ++i, token);
			continue;
		}
		if (token === "--repo-root") {
			args.repoRoot = requireFlagValue(argv, ++i, token);
			continue;
		}
		if (token === "--source-root") {
			args.sourceRoot = requireFlagValue(argv, ++i, token);
			continue;
		}
		if (token.startsWith("-")) {
			throw new Error(`Error: unknown option: ${token}`);
		}
		if (args.scopeDir !== null) {
			throw new Error(
				`Error: unexpected extra argument "${token}" (feature directory already set to "${args.scopeDir}")`,
			);
		}
		args.scopeDir = token;
	}
	return args;
}

// ─── Repo root detection ──────────────────────────────────────────────────────

export function detectRepoRoot(startDir: string): string {
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
	subdirContainers?: Array<{
		x: number;
		y: number;
		width: number;
		height: number;
		label: string;
	}>;
}

interface DiagramData {
	meta: Omit<Graph["meta"], "repoRoot">;
	sourceRoot: string;
	initialMode?: "all" | "diffFocused";
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
		subdirContainers: layout.subdirContainers,
	};
}

// ─── HTML builder ────────────────────────────────────────────────────────────

export async function buildHtml(
	data: DiagramData,
	templatePath: string,
): Promise<string> {
	const template = await readFile(templatePath, "utf8");
	// Escape "</" so a label/path containing "</script>" can't terminate the
	// inline script block early; "\/" is a valid JSON escape for "/", so this
	// still round-trips through JSON.parse.
	const json = JSON.stringify(data).replaceAll("</", "<\\/");
	// Passed as a function, the replacement value is used literally. Passed as
	// a string (the previous behavior), String.replace treats it as a
	// replacement *pattern* — "$&", "$'", "$`", "$$" are special substitution
	// sequences, so any of those appearing inside the JSON (e.g. in a node
	// label or file path) would corrupt the embedded data.
	return template.replace("__DIFF_DIAGRAM_DATA__", () => json);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	let args: Args;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (err) {
		console.error(err instanceof Error ? err.message : String(err));
		printHelp();
		process.exit(1);
	}

	if (!args.scopeDir) {
		printHelp();
		process.exit(1);
	}

	const repoRoot = args.repoRoot
		? path.resolve(args.repoRoot)
		: detectRepoRoot(process.cwd());
	const scopeDir = path.resolve(repoRoot, args.scopeDir);
	const outDir = path.resolve(args.outDir);

	if (!existsSync(scopeDir)) {
		console.error(`Error: feature directory not found: ${scopeDir}`);
		process.exit(1);
	}

	console.log(`Analyzing ${path.relative(repoRoot, scopeDir)} ...`);
	const current = addContext(await analyze(scopeDir, { repoRoot }));
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
			await analyze(baseScopeDir, { repoRoot: baseRepoRoot }),
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

	await mkdir(outDir, { recursive: true });

	// diagram-all.svg — all-nodes view, real layout. Always written, since it's
	// the same content regardless of whether a diff is available.
	const allSvg = toSvg(
		allLayout,
		allView.nodes,
		allView.edges,
		path.basename(scopeDir),
		args.sourceRoot,
	);
	const allSvgPath = path.join(outDir, "diagram-all.svg");
	await writeFile(allSvgPath, allSvg);
	console.log(`Wrote ${allSvgPath}`);

	// diagram-diff.svg — diff-focused view. Only meaningful with a base to diff
	// against; in single-branch mode every diff state is null, so this file is
	// skipped rather than writing a misleadingly-named duplicate of diagram-all.svg.
	if (args.baseRepoRoot) {
		const diffSvg = toSvg(
			diffLayout,
			diffView.nodes,
			diffView.edges,
			path.basename(scopeDir),
			args.sourceRoot,
		);
		const diffSvgPath = path.join(outDir, "diagram-diff.svg");
		await writeFile(diffSvgPath, diffSvg);
		console.log(`Wrote ${diffSvgPath}`);
	}

	// diagram.html — interactive, all modes embedded
	const { repoRoot: _root, ...metaWithoutRoot } = diffed.meta;
	const diagramData: DiagramData = {
		meta: metaWithoutRoot,
		sourceRoot: args.sourceRoot,
		// Single-branch mode: open the interactive diagram in the all-nodes view
		// (there is no diff to focus on). Omitted in diff mode so the template's
		// own default applies.
		...(args.baseRepoRoot ? {} : { initialMode: "all" as const }),
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

	// graph.json — strip meta.repoRoot (absolute local path) and each node's
	// internal _content field (raw file text, used only for diffing), same
	// spirit as the repoRoot strip above.
	const { _oosEdges, ...graphOut } = { ...diffed, meta: metaWithoutRoot };
	const strippedNodes = graphOut.nodes.map(({ _content, ...rest }) => rest);
	const jsonPath = path.join(outDir, "graph.json");
	await writeFile(
		jsonPath,
		JSON.stringify({ ...graphOut, nodes: strippedNodes }, null, 2),
	);
	console.log(`Wrote ${jsonPath}`);
}

// Only run when invoked directly (`node dist/cli.js ...`), not when imported
// as a module (e.g. by unit tests importing `buildHtml`/`parseArgs`/`detectRepoRoot`).
if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
