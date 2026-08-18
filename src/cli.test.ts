import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHtml, detectRepoRoot, parseArgs } from "./cli.js";
import type { Graph } from "./types.js";

const execFileAsync = promisify(execFile);
const CLI = path.resolve("dist/cli.js");

interface CliResult {
	code: number;
	stdout: string;
	stderr: string;
}

async function runCli(args: string[]): Promise<CliResult> {
	try {
		const { stdout, stderr } = await execFileAsync(process.execPath, [
			CLI,
			...args,
		]);
		return { code: 0, stdout, stderr };
	} catch (err) {
		const e = err as { code?: number; stdout?: string; stderr?: string };
		return {
			code: e.code ?? 1,
			stdout: e.stdout ?? "",
			stderr: e.stderr ?? "",
		};
	}
}

function writeFixtureFile(filePath: string, content: string): Promise<void> {
	mkdirSync(path.dirname(filePath), { recursive: true });
	return writeFile(filePath, content);
}

beforeAll(() => {
	if (!existsSync(CLI)) {
		throw new Error(
			"dist/cli.js not found — run `npm run build` before running CLI tests",
		);
	}
});

// ─── tsconfig auto-detection: each pass resolves within its own repo root ─────

describe("cli tsconfig auto-detection", () => {
	let tmp: string;
	let currentRoot: string;
	let baseRoot: string;
	let outDir: string;

	const TSCONFIG = JSON.stringify({
		compilerOptions: { baseUrl: ".", paths: { "@lib/*": ["lib/*"] } },
	});
	const A_TS = 'import { b } from "@lib/b";\nexport const a = b;\n';
	const B_TS = "export const b = 1;\n";

	beforeAll(async () => {
		tmp = mkdtempSync(path.join(tmpdir(), "dd-cli-tsconfig-"));
		currentRoot = path.join(tmp, "current");
		baseRoot = path.join(tmp, "base");
		outDir = path.join(tmp, "out");

		for (const root of [currentRoot, baseRoot]) {
			await writeFixtureFile(path.join(root, "tsconfig.json"), TSCONFIG);
			await writeFixtureFile(path.join(root, "lib/b.ts"), B_TS);
			await writeFixtureFile(path.join(root, "src/app/features/f/a.ts"), A_TS);
		}
	}, 30_000);

	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("identical alias imports in base and current diff as unchanged", async () => {
		const result = await runCli([
			"--repo-root",
			currentRoot,
			"--base-repo-root",
			baseRoot,
			"--out-dir",
			outDir,
			"src/app/features/f",
		]);
		expect(result.code).toBe(0);

		const graph: Graph = JSON.parse(
			await readFile(path.join(outDir, "graph.json"), "utf8"),
		);

		// Each pass must pick up its own repo's tsconfig, so the alias target
		// resolves inside each root — never into the other checkout (which would
		// produce ../… paths and fake diffs).
		const escaped = graph.nodes.filter((n) => n.file.startsWith(".."));
		expect(escaped).toEqual([]);

		const libNode = graph.nodes.find((n) => n.file === "lib/b.ts");
		expect(libNode).toBeDefined();
		expect(libNode?.diff).toBe("unchanged");

		const aNode = graph.nodes.find((n) => n.file === "src/app/features/f/a.ts");
		expect(aNode?.diff).toBe("unchanged");
	}, 30_000);
});

// ─── GAP-01: missing feature directory handling ───────────────────────────────

describe("cli feature directory existence checks", () => {
	let tmp: string;
	let repoRoot: string;
	let baseRoot: string;

	beforeAll(async () => {
		tmp = mkdtempSync(path.join(tmpdir(), "dd-cli-missing-dir-"));
		repoRoot = path.join(tmp, "repo");
		baseRoot = path.join(tmp, "base");

		await writeFixtureFile(
			path.join(repoRoot, "src/app/features/f/a.ts"),
			"export const a = 1;\n",
		);
		// Base repo exists but has no feature dir (feature added by this PR)
		mkdirSync(path.join(baseRoot, "src/app"), { recursive: true });
		// Feature dir that exists but contains no TypeScript files
		mkdirSync(path.join(repoRoot, "src/app/features/empty"), {
			recursive: true,
		});
	}, 30_000);

	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("exits non-zero and names the resolved path when the feature dir does not exist", async () => {
		const result = await runCli([
			"--repo-root",
			repoRoot,
			"--out-dir",
			path.join(tmp, "out-missing"),
			"src/app/features/nope",
		]);
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain(
			path.join(repoRoot, "src/app/features/nope"),
		);
	}, 30_000);

	it("succeeds with all nodes added when the base repo lacks the feature dir", async () => {
		const outDir = path.join(tmp, "out-base-missing");
		const result = await runCli([
			"--repo-root",
			repoRoot,
			"--base-repo-root",
			baseRoot,
			"--out-dir",
			outDir,
			"src/app/features/f",
		]);
		expect(result.code).toBe(0);
		expect(result.stdout + result.stderr).toContain("absent in base");

		const graph: Graph = JSON.parse(
			await readFile(path.join(outDir, "graph.json"), "utf8"),
		);
		expect(graph.nodes.length).toBeGreaterThan(0);
		for (const node of graph.nodes) {
			expect(node.diff).toBe("added");
		}
	}, 30_000);

	it("warns to stderr but exits 0 when the current graph has 0 nodes", async () => {
		const result = await runCli([
			"--repo-root",
			repoRoot,
			"--out-dir",
			path.join(tmp, "out-empty"),
			"src/app/features/empty",
		]);
		expect(result.code).toBe(0);
		expect(result.stderr.toLowerCase()).toContain("0 nodes");
	}, 30_000);
});

// ─── GAP-05: single-branch mode renders the expanded view ────────────────────

describe("cli single-branch mode output views", () => {
	let tmp: string;
	let repoRoot: string;

	beforeAll(async () => {
		tmp = mkdtempSync(path.join(tmpdir(), "dd-cli-single-branch-"));
		repoRoot = path.join(tmp, "repo");
		// Files live in a subdirectory of the feature dir so that focused
		// mode would collapse them into a stub (all diff states are null).
		await writeFixtureFile(
			path.join(repoRoot, "src/app/features/f/sub/alpha.component.ts"),
			'import { beta } from "./beta.component";\nexport const alpha = beta;\n',
		);
		await writeFixtureFile(
			path.join(repoRoot, "src/app/features/f/sub/beta.component.ts"),
			"export const beta = 1;\n",
		);
	}, 30_000);

	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("diagram-expanded.svg shows individual nodes, not collapsed stubs", async () => {
		const outDir = path.join(tmp, "out-single");
		const result = await runCli([
			"--repo-root",
			repoRoot,
			"--out-dir",
			outDir,
			"src/app/features/f",
		]);
		expect(result.code).toBe(0);

		const svg = await readFile(
			path.join(outDir, "diagram-expanded.svg"),
			"utf8",
		);
		expect(svg).toContain(">AlphaComponent<");
		expect(svg).toContain(">BetaComponent<");
	}, 30_000);

	it("does not write diagram-focused.svg in single-branch mode", () => {
		expect(existsSync(path.join(tmp, "out-single/diagram-focused.svg"))).toBe(
			false,
		);
	});

	it("diagram.html embeds initialMode 'expanded' in single-branch mode", async () => {
		const html = await readFile(
			path.join(tmp, "out-single/diagram.html"),
			"utf8",
		);
		expect(html).toContain('"initialMode":"expanded"');
	}, 30_000);

	it("diagram.html embeds no initialMode when a base repo is given", async () => {
		const outDir = path.join(tmp, "out-diff");
		const result = await runCli([
			"--repo-root",
			repoRoot,
			"--base-repo-root",
			repoRoot,
			"--out-dir",
			outDir,
			"src/app/features/f",
		]);
		expect(result.code).toBe(0);

		const html = await readFile(path.join(outDir, "diagram.html"), "utf8");
		expect(html).not.toContain('"initialMode"');
	}, 30_000);

	it("writes both diagram-focused.svg and diagram-expanded.svg when a base repo is given", () => {
		const outDir = path.join(tmp, "out-diff");
		expect(existsSync(path.join(outDir, "diagram-focused.svg"))).toBe(true);
		expect(existsSync(path.join(outDir, "diagram-expanded.svg"))).toBe(true);
	});
});

// ─── GAP-08: graph.json must not leak the local filesystem path ───────────────

describe("cli graph.json output", () => {
	let tmp: string;
	let repoRoot: string;

	beforeAll(async () => {
		tmp = mkdtempSync(path.join(tmpdir(), "dd-cli-graph-json-"));
		repoRoot = path.join(tmp, "repo");
		await writeFixtureFile(
			path.join(repoRoot, "src/app/features/f/a.ts"),
			"export const a = 1;\n",
		);
	}, 30_000);

	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("meta does not contain the absolute repoRoot path", async () => {
		const outDir = path.join(tmp, "out");
		const result = await runCli([
			"--repo-root",
			repoRoot,
			"--out-dir",
			outDir,
			"src/app/features/f",
		]);
		expect(result.code).toBe(0);

		const graph = JSON.parse(
			await readFile(path.join(outDir, "graph.json"), "utf8"),
		);
		expect(graph.meta).not.toHaveProperty("repoRoot");
		expect(JSON.stringify(graph)).not.toContain(repoRoot);
	}, 30_000);

	it("does not contain the internal _content field on any node", async () => {
		const outDir = path.join(tmp, "out-content");
		const result = await runCli([
			"--repo-root",
			repoRoot,
			"--out-dir",
			outDir,
			"src/app/features/f",
		]);
		expect(result.code).toBe(0);

		const raw = await readFile(path.join(outDir, "graph.json"), "utf8");
		expect(raw).not.toContain("_content");
	}, 30_000);
});

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

// ─── BUG-04: buildHtml must not corrupt JSON via String.replace patterns ──────

describe("buildHtml embedded JSON", () => {
	let tmp: string;
	let templatePath: string;

	beforeAll(async () => {
		tmp = mkdtempSync(path.join(tmpdir(), "dd-cli-buildhtml-"));
		templatePath = path.join(tmp, "template.html");
		await writeFixtureFile(
			templatePath,
			"<script>\nconst DIFF_DIAGRAM = __DIFF_DIAGRAM_DATA__;\n</script>\n",
		);
	});

	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("round-trips a label containing $-substitution sequences and </script>", async () => {
		const data = {
			meta: {
				scopeDir: "src/app/features/f",
				generatedAt: "2026-01-01T00:00:00.000Z",
				nodeCount: 1,
				edgeCount: 0,
			},
			sourceRoot: "src/app",
			modes: {
				expanded: {
					nodes: [
						{
							id: "n1",
							x: 0,
							y: 0,
							width: 10,
							height: 10,
							// "$&", "$'", "$$" are String.replace substitution
							// sequences; "</script>" would terminate the inline
							// <script> block early if not escaped.
							label: "$& $' $$ </script>",
							type: "component",
							diff: null,
							scope: "in-scope",
							file: "a</script>b.ts",
						},
					],
					edges: [],
					width: 100,
					height: 100,
				},
				focused: { nodes: [], edges: [], width: 100, height: 100 },
			},
		};

		const html = await buildHtml(data, templatePath);

		// Only the template's own closing tag should survive as a real
		// "</script>" — any occurrence coming from embedded data must be escaped.
		const scriptCloses = html.match(/<\/script>/g) ?? [];
		expect(scriptCloses).toHaveLength(1);

		const match = html.match(/const DIFF_DIAGRAM = (.*);/);
		expect(match).not.toBeNull();
		const roundTripped = JSON.parse(match?.[1] ?? "");
		expect(roundTripped).toEqual(data);
	});
});

// ─── BUG-02: --repo-root auto-detection via .git ──────────────────────────────

describe("detectRepoRoot", () => {
	let tmp: string;

	beforeAll(() => {
		tmp = mkdtempSync(path.join(tmpdir(), "dd-detect-repo-root-"));
	});

	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("walks up to the nearest ancestor containing .git", () => {
		const repoRoot = path.join(tmp, "repo");
		const nested = path.join(repoRoot, "src", "app", "features", "f");
		mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
		mkdirSync(nested, { recursive: true });

		expect(detectRepoRoot(nested)).toBe(repoRoot);
	});

	it("falls back to the start dir when no .git is found", () => {
		const noGit = path.join(tmp, "no-git", "sub", "dir");
		mkdirSync(noGit, { recursive: true });

		expect(detectRepoRoot(noGit)).toBe(noGit);
	});

	it("returns the start dir itself when it directly contains .git", () => {
		const repoRoot = path.join(tmp, "direct-repo");
		mkdirSync(path.join(repoRoot, ".git"), { recursive: true });

		expect(detectRepoRoot(repoRoot)).toBe(repoRoot);
	});
});

// ─── GAP-02: parseArgs validation ──────────────────────────────────────────────

describe("parseArgs", () => {
	it("parses the happy path as before", () => {
		const args = parseArgs([
			"--repo-root",
			"/repo",
			"--base-repo-root",
			"/base",
			"--out-dir",
			"out",
			"--source-root",
			"app",
			"src/app/features/f",
		]);
		expect(args).toEqual({
			baseRepoRoot: "/base",
			outDir: "out",
			repoRoot: "/repo",
			scopeDir: "src/app/features/f",
			sourceRoot: "app",
		});
	});

	it("defaults outDir and sourceRoot, and leaves repoRoot/baseRepoRoot null", () => {
		const args = parseArgs(["src/app/features/f"]);
		expect(args).toEqual({
			baseRepoRoot: null,
			outDir: "dist",
			repoRoot: null,
			scopeDir: "src/app/features/f",
			sourceRoot: "src/app",
		});
	});

	it("throws when a flag is the last token (missing value)", () => {
		expect(() => parseArgs(["--out-dir"])).toThrow();
	});

	it("throws when a flag's value looks like another flag (missing value)", () => {
		expect(() => parseArgs(["--out-dir", "--source-root", "app"])).toThrow();
	});

	it("throws on an unrecognized flag instead of silently rebinding the positional", () => {
		expect(() =>
			parseArgs(["--base-repo", "/base", "src/app/features/f"]),
		).toThrow();
	});

	it("throws when a second positional argument appears", () => {
		expect(() =>
			parseArgs(["src/app/features/f", "src/app/features/g"]),
		).toThrow();
	});
});

// ─── subdirectory grouping (issue #28) ────────────────────────────────────────

describe("cli subdirectory grouping", () => {
	let tmp: string;
	let repoRoot: string;

	beforeAll(async () => {
		tmp = mkdtempSync(path.join(tmpdir(), "dd-cli-subdir-"));
		repoRoot = path.join(tmp, "repo");
		await writeFixtureFile(
			path.join(repoRoot, "src/app/features/f/widgets/alpha.component.ts"),
			"export const alpha = 1;\n",
		);
		await writeFixtureFile(
			path.join(repoRoot, "src/app/features/f/widgets/beta.component.ts"),
			"export const beta = 1;\n",
		);
	}, 30_000);

	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("diagram-expanded.svg draws a subdirectory group box labeled with the subdirectory name", async () => {
		const outDir = path.join(tmp, "out");
		const result = await runCli([
			"--repo-root",
			repoRoot,
			"--out-dir",
			outDir,
			"src/app/features/f",
		]);
		expect(result.code).toBe(0);

		const svg = await readFile(
			path.join(outDir, "diagram-expanded.svg"),
			"utf8",
		);
		expect(svg).toContain(">○ widgets (2)<");
	}, 30_000);

	it("diagram.html embeds subdirContainers data", async () => {
		const html = await readFile(path.join(tmp, "out/diagram.html"), "utf8");
		expect(html).toContain('"subdirContainers"');
		expect(html).toContain('"label":"○ widgets (2)"');
	}, 30_000);
});

// ─── collapsed view mode ───────────────────────────────────────────────────────

describe("cli collapsed view mode", () => {
	let tmp: string;
	let repoRoot: string;

	beforeAll(async () => {
		tmp = mkdtempSync(path.join(tmpdir(), "dd-cli-clustered-"));
		repoRoot = path.join(tmp, "repo");
		await writeFixtureFile(
			path.join(repoRoot, "src/app/features/f/widgets/alpha.component.ts"),
			"export const alpha = 1;\n",
		);
		await writeFixtureFile(
			path.join(repoRoot, "src/app/features/f/data-access/store/action.ts"),
			"export const action = 1;\n",
		);
	}, 30_000);

	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("writes diagram-collapsed.svg with one box per directory, nested up to 2 levels", async () => {
		const outDir = path.join(tmp, "out");
		const result = await runCli([
			"--repo-root",
			repoRoot,
			"--out-dir",
			outDir,
			"src/app/features/f",
		]);
		expect(result.code).toBe(0);

		const svg = await readFile(
			path.join(outDir, "diagram-collapsed.svg"),
			"utf8",
		);
		expect(svg).toContain(">● widgets (1)<");
		expect(svg).toContain(">● data-access (1)<");
		expect(svg).toContain(">● store (1)<");
		// Individual file labels must not appear — this view is directory-only.
		// labelFromFile PascalCases and strips separators, so the labels that
		// would actually leak are "AlphaComponent" / "Action", not the raw
		// file-name fragments "alpha" / "action".
		expect(svg).not.toContain(">AlphaComponent<");
		expect(svg).not.toContain(">Action<");

		// Anchor: prove these labels really would appear if the code were
		// broken, by confirming diagram-expanded.svg (individual-file view, same
		// CLI run) does contain them — otherwise the negative assertions
		// above can't catch the bug they're meant to catch.
		const allSvg = await readFile(
			path.join(outDir, "diagram-expanded.svg"),
			"utf8",
		);
		expect(allSvg).toContain(">AlphaComponent<");
		expect(allSvg).toContain(">Action<");
	}, 30_000);

	it("diagram.html embeds a collapsed mode with directory-typed nodes", async () => {
		const html = await readFile(path.join(tmp, "out/diagram.html"), "utf8");
		expect(html).toContain('"collapsed"');
		expect(html).toContain('"type":"directory"');
	}, 30_000);
});
