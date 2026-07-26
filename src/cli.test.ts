import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHtml } from "./cli.js";
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

// ─── GAP-05: single-branch mode renders the all-nodes view ────────────────────

describe("cli single-branch mode output views", () => {
	let tmp: string;
	let repoRoot: string;

	beforeAll(async () => {
		tmp = mkdtempSync(path.join(tmpdir(), "dd-cli-single-branch-"));
		repoRoot = path.join(tmp, "repo");
		// Files live in a subdirectory of the feature dir so that diff-focused
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

	it("diagram.svg shows individual nodes, not collapsed stubs", async () => {
		const outDir = path.join(tmp, "out-single");
		const result = await runCli([
			"--repo-root",
			repoRoot,
			"--out-dir",
			outDir,
			"src/app/features/f",
		]);
		expect(result.code).toBe(0);

		const svg = await readFile(path.join(outDir, "diagram.svg"), "utf8");
		expect(svg).toContain(">AlphaComponent<");
		expect(svg).toContain(">BetaComponent<");
	}, 30_000);

	it("diagram.html embeds initialMode 'all' in single-branch mode", async () => {
		const html = await readFile(
			path.join(tmp, "out-single/diagram.html"),
			"utf8",
		);
		expect(html).toContain('"initialMode":"all"');
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
				all: {
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
				diffFocused: { nodes: [], edges: [], width: 100, height: 100 },
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
