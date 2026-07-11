import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
