import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	analyze,
	classifyByFilename,
	dedupeId,
	findTsConfig,
	labelFromFile,
	toNodeId,
} from "./analyzer.js";

// ─── toNodeId ────────────────────────────────────────────────────────────────

describe("toNodeId", () => {
	it("produces a repo-relative id with .ts stripped", () => {
		expect(toNodeId("/repo/src/app/foo.component.ts", "/repo")).toBe(
			"src_app_foo_component",
		);
	});

	it("replaces non-alphanumeric characters with underscores", () => {
		expect(
			toNodeId("/repo/src/app/user-list/user-list.component.ts", "/repo"),
		).toBe("src_app_user_list_user_list_component");
	});

	it("collapses consecutive underscores", () => {
		expect(toNodeId("/repo/src/app/foo--bar.ts", "/repo")).toBe(
			"src_app_foo_bar",
		);
	});

	it("trims leading and trailing underscores", () => {
		const result = toNodeId("/repo/src/app/foo.ts", "/repo");
		expect(result).not.toMatch(/^_|_$/);
	});

	it("handles nested directories", () => {
		expect(
			toNodeId(
				"/repo/src/app/features/users/data-access/users.service.ts",
				"/repo",
			),
		).toBe("src_app_features_users_data_access_users_service");
	});
});

// ─── labelFromFile ───────────────────────────────────────────────────────────

describe("labelFromFile", () => {
	it("converts kebab-case to PascalCase and strips .ts", () => {
		expect(labelFromFile("/any/path/user-list.component.ts")).toBe(
			"UserListComponent",
		);
	});

	it("handles a single-segment filename", () => {
		expect(labelFromFile("/any/path/users.service.ts")).toBe("UsersService");
	});

	it("handles a filename with no hyphens", () => {
		expect(labelFromFile("/any/path/auth.guard.ts")).toBe("AuthGuard");
	});

	it("handles deeply nested paths", () => {
		expect(labelFromFile("/deep/a/b/c/user-status.pipe.ts")).toBe(
			"UserStatusPipe",
		);
	});

	it("uses parent directory name for barrel index files", () => {
		expect(labelFromFile("/src/app/shared/lookup-entity/index.ts")).toBe(
			"LookupEntity",
		);
	});
});

// ─── classifyByFilename ──────────────────────────────────────────────────────

describe("classifyByFilename", () => {
	it("returns routing for .routes.ts", () => {
		expect(classifyByFilename("users.routes.ts")).toBe("routing");
	});

	it("returns guard for .guard.ts", () => {
		expect(classifyByFilename("auth.guard.ts")).toBe("guard");
	});

	it("returns resolver for .resolver.ts", () => {
		expect(classifyByFilename("user.resolver.ts")).toBe("resolver");
	});

	it("returns interceptor for .interceptor.ts", () => {
		expect(classifyByFilename("http.interceptor.ts")).toBe("interceptor");
	});

	it("returns model for .model.ts", () => {
		expect(classifyByFilename("user.model.ts")).toBe("model");
	});

	it("returns model for .interface.ts", () => {
		expect(classifyByFilename("user.interface.ts")).toBe("model");
	});

	it("returns null for .service.ts (needs decorator inspection)", () => {
		expect(classifyByFilename("users.service.ts")).toBeNull();
	});

	it("returns null for .component.ts (needs decorator inspection)", () => {
		expect(classifyByFilename("user-list.component.ts")).toBeNull();
	});

	it("returns null for .pipe.ts (needs decorator inspection)", () => {
		expect(classifyByFilename("user-status.pipe.ts")).toBeNull();
	});

	it("returns null for plain .ts files", () => {
		expect(classifyByFilename("validation.utils.ts")).toBeNull();
	});

	it("works with full paths", () => {
		expect(
			classifyByFilename("/repo/src/app/features/users/users.routes.ts"),
		).toBe("routing");
	});
});

// ─── analyze() — integration tests ──────────────────────────────────────────
// These tests run ts-morph against a real (temporary) fixture directory.

describe("analyze (integration)", { timeout: 15000 }, () => {
	let tmpRoot: string;
	let scopeDir: string;

	beforeAll(() => {
		tmpRoot = mkdtempSync(path.join(tmpdir(), "diff-diagram-test-"));
		scopeDir = path.join(tmpRoot, "src", "app", "features", "users");
		mkdirSync(scopeDir, { recursive: true });

		// In-scope: a .ts file that should appear in output
		writeFileSync(
			path.join(scopeDir, "users.routes.ts"),
			"export const routes = [];",
		);

		// Should be excluded: spec file
		writeFileSync(
			path.join(scopeDir, "users.routes.spec.ts"),
			'describe("test", () => {});',
		);

		// Should be excluded: declaration file
		writeFileSync(
			path.join(scopeDir, "generated.d.ts"),
			"export declare const x: string;",
		);

		// Should be excluded: stories file
		writeFileSync(
			path.join(scopeDir, "users.routes.stories.ts"),
			"import { Component } from '@angular/core';\nexport default {};",
		);

		// Should be excluded: node_modules inside scope (BUG: currently included)
		const nmDir = path.join(scopeDir, "node_modules", "some-lib");
		mkdirSync(nmDir, { recursive: true });
		writeFileSync(path.join(nmDir, "index.ts"), "export const lib = {};");
	});

	afterAll(() => {
		rmSync(tmpRoot, { recursive: true, force: true });
	});

	it("includes the in-scope .ts file", async () => {
		const graph = await analyze(scopeDir, { repoRoot: tmpRoot });
		const files = graph.nodes.map((n) => n.file);
		expect(files.some((f) => f.includes("users.routes"))).toBe(true);
	});

	it("excludes .spec.ts files", async () => {
		const graph = await analyze(scopeDir, { repoRoot: tmpRoot });
		const files = graph.nodes.map((n) => n.file);
		expect(files.every((f) => !f.includes(".spec."))).toBe(true);
	});

	it("excludes .d.ts declaration files", async () => {
		const graph = await analyze(scopeDir, { repoRoot: tmpRoot });
		const files = graph.nodes.map((n) => n.file);
		expect(files.every((f) => !f.endsWith(".d"))).toBe(true);
	});

	it("excludes files inside node_modules", async () => {
		const graph = await analyze(scopeDir, { repoRoot: tmpRoot });
		const files = graph.nodes.map((n) => n.file);
		expect(files.every((f) => !f.includes("node_modules"))).toBe(true);
	});

	it("classifies .routes.ts as routing type", async () => {
		const graph = await analyze(scopeDir, { repoRoot: tmpRoot });
		const routesNode = graph.nodes.find((n) => n.file.includes("users.routes"));
		expect(routesNode?.type).toBe("routing");
	});

	it("excludes .stories.ts files", async () => {
		const graph = await analyze(scopeDir, { repoRoot: tmpRoot });
		const files = graph.nodes.map((n) => n.file);
		expect(files.every((f) => !f.endsWith(".stories.ts"))).toBe(true);
	});
});

// ─── analyze() — type-only imports ──────────────────────────────────────────

describe("analyze (type-only imports)", { timeout: 15000 }, () => {
	let tmpRoot2: string;
	let scopeDir2: string;

	beforeAll(() => {
		tmpRoot2 = mkdtempSync(path.join(tmpdir(), "diff-diagram-typeonly-"));
		scopeDir2 = path.join(tmpRoot2, "src", "app", "features", "users");
		mkdirSync(scopeDir2, { recursive: true });

		writeFileSync(
			path.join(scopeDir2, "user.model.ts"),
			"export interface UserModel { id: string; }",
		);
		writeFileSync(
			path.join(scopeDir2, "uses-type-only.ts"),
			"import type { UserModel } from './user.model';\nexport const x = 1;",
		);
		writeFileSync(
			path.join(scopeDir2, "uses-value.ts"),
			"import { x } from './uses-type-only';\nexport const y = x;",
		);
	});

	afterAll(() => {
		rmSync(tmpRoot2, { recursive: true, force: true });
	});

	it("edge from type-only import has typeOnly: true", async () => {
		const graph = await analyze(scopeDir2, { repoRoot: tmpRoot2 });
		const usesTypeOnlyId = graph.nodes.find((n) =>
			n.file.includes("uses-type-only"),
		)?.id;
		const userModelId = graph.nodes.find((n) =>
			n.file.includes("user.model"),
		)?.id;
		const e = graph.edges.find(
			(e) => e.from === usesTypeOnlyId && e.to === userModelId,
		);
		expect(e?.typeOnly).toBe(true);
	});

	it("node reached only by type-only imports has typeOnly: true", async () => {
		const graph = await analyze(scopeDir2, { repoRoot: tmpRoot2 });
		const node = graph.nodes.find((n) => n.file.includes("user.model"));
		expect(node?.typeOnly).toBe(true);
	});

	it("edge from value import does not have typeOnly", async () => {
		const graph = await analyze(scopeDir2, { repoRoot: tmpRoot2 });
		const usesValueId = graph.nodes.find((n) =>
			n.file.includes("uses-value"),
		)?.id;
		const usesTypeOnlyId = graph.nodes.find((n) =>
			n.file.includes("uses-type-only"),
		)?.id;
		const e = graph.edges.find(
			(e) => e.from === usesValueId && e.to === usesTypeOnlyId,
		);
		expect(e?.typeOnly).toBeUndefined();
	});

	it("node with a value import incoming is not type-only", async () => {
		const graph = await analyze(scopeDir2, { repoRoot: tmpRoot2 });
		const node = graph.nodes.find((n) => n.file.includes("uses-type-only"));
		expect(node?.typeOnly).toBeUndefined();
	});
});

// ─── analyze() — test/story markers ─────────────────────────────────────────

describe("analyze (test and story markers)", { timeout: 15000 }, () => {
	let tmpRoot3: string;
	let scopeDir3: string;

	beforeAll(() => {
		tmpRoot3 = mkdtempSync(path.join(tmpdir(), "diff-diagram-markers-"));
		scopeDir3 = path.join(tmpRoot3, "src", "app", "features", "demo");
		mkdirSync(scopeDir3, { recursive: true });

		writeFileSync(
			path.join(scopeDir3, "with-both.component.ts"),
			"import { Component } from '@angular/core';\n@Component({}) export class WithBothComponent {}",
		);
		writeFileSync(
			path.join(scopeDir3, "with-both.component.spec.ts"),
			"describe('x', () => {});",
		);
		writeFileSync(
			path.join(scopeDir3, "with-both.component.stories.ts"),
			"export default {};",
		);

		writeFileSync(
			path.join(scopeDir3, "test-only.component.ts"),
			"import { Component } from '@angular/core';\n@Component({}) export class TestOnlyComponent {}",
		);
		writeFileSync(
			path.join(scopeDir3, "test-only.component.spec.ts"),
			"describe('x', () => {});",
		);

		writeFileSync(
			path.join(scopeDir3, "neither.component.ts"),
			"import { Component } from '@angular/core';\n@Component({}) export class NeitherComponent {}",
		);
	});

	afterAll(() => {
		rmSync(tmpRoot3, { recursive: true, force: true });
	});

	it("node with both spec and stories files has hasTests and hasStories", async () => {
		const graph = await analyze(scopeDir3, { repoRoot: tmpRoot3 });
		const node = graph.nodes.find((n) => n.file.includes("with-both"));
		expect(node?.hasTests).toBe(true);
		expect(node?.hasStories).toBe(true);
	});

	it("node with only spec file has hasTests but not hasStories", async () => {
		const graph = await analyze(scopeDir3, { repoRoot: tmpRoot3 });
		const node = graph.nodes.find((n) => n.file.includes("test-only"));
		expect(node?.hasTests).toBe(true);
		expect(node?.hasStories).toBeUndefined();
	});

	it("node with neither spec nor stories has neither marker", async () => {
		const graph = await analyze(scopeDir3, { repoRoot: tmpRoot3 });
		const node = graph.nodes.find((n) => n.file.includes("neither"));
		expect(node?.hasTests).toBeUndefined();
		expect(node?.hasStories).toBeUndefined();
	});
});

// ─── analyze() — scope boundary (BUG-03) ────────────────────────────────────
// A sibling directory sharing a name prefix (e.g. "users" vs "users-admin")
// must not be misclassified as in-scope by a raw startsWith(scopeDir) check.

describe("analyze (scope boundary — sibling directory guard)", {
	timeout: 15000,
}, () => {
	let tmpRoot5: string;
	let scopeDir5: string;

	beforeAll(() => {
		tmpRoot5 = mkdtempSync(path.join(tmpdir(), "diff-diagram-siblingscope-"));
		scopeDir5 = path.join(tmpRoot5, "src", "app", "features", "users");
		const siblingDir = path.join(
			tmpRoot5,
			"src",
			"app",
			"features",
			"users-admin",
		);
		mkdirSync(scopeDir5, { recursive: true });
		mkdirSync(siblingDir, { recursive: true });

		writeFileSync(
			path.join(siblingDir, "roles.service.ts"),
			"export class RolesService {}",
		);
		writeFileSync(
			path.join(scopeDir5, "consumer.ts"),
			"import { RolesService } from '../users-admin/roles.service';\nexport const x = RolesService;",
		);
	});

	afterAll(() => {
		rmSync(tmpRoot5, { recursive: true, force: true });
	});

	it("surfaces an import from a name-prefixed sibling directory as an OOS edge, not a dropped edge", async () => {
		const graph = await analyze(scopeDir5, { repoRoot: tmpRoot5 });
		expect(
			graph._oosEdges?.some((e) => e.toFile.endsWith("roles.service.ts")),
		).toBe(true);
	});

	it("does not classify the sibling directory's file as in-scope", async () => {
		const graph = await analyze(scopeDir5, { repoRoot: tmpRoot5 });
		expect(graph.nodes.some((n) => n.file.includes("users-admin"))).toBe(false);
	});
});

// ─── dedupeId (BUG-11) ───────────────────────────────────────────────────────

describe("dedupeId", () => {
	it("returns the same id for repeated calls with the same source key", () => {
		const seen = new Map<string, string>();
		const id1 = dedupeId(
			"user_list_component",
			"/repo/user-list.component.ts",
			seen,
		);
		const id2 = dedupeId(
			"user_list_component",
			"/repo/user-list.component.ts",
			seen,
		);
		expect(id1).toBe("user_list_component");
		expect(id2).toBe("user_list_component");
	});

	it("disambiguates a colliding id from a different source key with a hash suffix", () => {
		const seen = new Map<string, string>();
		const id1 = dedupeId(
			"user_list_component",
			"/repo/user-list.component.ts",
			seen,
		);
		const id2 = dedupeId(
			"user_list_component",
			"/repo/user.list.component.ts",
			seen,
		);
		expect(id1).toBe("user_list_component");
		expect(id2).not.toBe(id1);
		expect(id2).toMatch(/^user_list_component_[0-9a-f]{6}$/);
	});

	it("is deterministic: the same source key always produces the same disambiguated id", () => {
		const seenA = new Map<string, string>();
		dedupeId("x", "/repo/a.ts", seenA);
		const idA = dedupeId("x", "/repo/b.ts", seenA);

		const seenB = new Map<string, string>();
		dedupeId("x", "/repo/a.ts", seenB);
		const idB = dedupeId("x", "/repo/b.ts", seenB);

		expect(idA).toBe(idB);
	});
});

// ─── analyze() — node id collisions (BUG-11) ────────────────────────────────

describe("analyze (node id collisions)", { timeout: 15000 }, () => {
	let tmpRoot6: string;
	let scopeDir6: string;

	beforeAll(() => {
		tmpRoot6 = mkdtempSync(path.join(tmpdir(), "diff-diagram-idcollision-"));
		scopeDir6 = path.join(tmpRoot6, "src", "app", "features", "users");
		mkdirSync(scopeDir6, { recursive: true });

		// These two file names sanitize to the same string
		// ("user_list_component") under the naive toNodeId scheme.
		writeFileSync(
			path.join(scopeDir6, "user-list.component.ts"),
			"export class UserListComponentA {}",
		);
		writeFileSync(
			path.join(scopeDir6, "user.list.component.ts"),
			"export class UserListComponentB {}",
		);
		writeFileSync(
			path.join(scopeDir6, "consumer.ts"),
			[
				"import { UserListComponentA } from './user-list.component';",
				"import { UserListComponentB } from './user.list.component';",
				"export const both = [UserListComponentA, UserListComponentB];",
			].join("\n"),
		);
	});

	afterAll(() => {
		rmSync(tmpRoot6, { recursive: true, force: true });
	});

	it("assigns distinct ids to files whose sanitized names collide, with edges correctly attributed", async () => {
		const graph = await analyze(scopeDir6, { repoRoot: tmpRoot6 });

		const nodeA = graph.nodes.find(
			(n) => path.basename(n.file) === "user-list.component.ts",
		);
		const nodeB = graph.nodes.find(
			(n) => path.basename(n.file) === "user.list.component.ts",
		);
		const consumer = graph.nodes.find(
			(n) => path.basename(n.file) === "consumer.ts",
		);

		expect(nodeA).toBeDefined();
		expect(nodeB).toBeDefined();
		expect(nodeA?.id).not.toBe(nodeB?.id);

		// Neither file was silently merged/dropped.
		expect(graph.nodes).toHaveLength(3);

		const edgeToA = graph.edges.find(
			(e) => e.from === consumer?.id && e.to === nodeA?.id,
		);
		const edgeToB = graph.edges.find(
			(e) => e.from === consumer?.id && e.to === nodeB?.id,
		);
		expect(edgeToA).toBeDefined();
		expect(edgeToB).toBeDefined();
	});
});

// ─── findTsConfig ────────────────────────────────────────────────────────────

describe("findTsConfig", () => {
	let tmpRoot4: string;

	beforeAll(() => {
		// root/tsconfig.json          ← outside the repo, must never be picked up
		// root/repo/                  ← repoRoot (no tsconfig)
		// root/repo/src/feature/      ← scope dir
		tmpRoot4 = mkdtempSync(path.join(tmpdir(), "diff-diagram-tsconfig-"));
		mkdirSync(path.join(tmpRoot4, "repo/src/feature"), { recursive: true });
		writeFileSync(path.join(tmpRoot4, "tsconfig.json"), "{}");
	});

	afterAll(() => {
		rmSync(tmpRoot4, { recursive: true, force: true });
	});

	it("returns null instead of a tsconfig above the repo root", async () => {
		const result = await findTsConfig(
			path.join(tmpRoot4, "repo/src/feature"),
			path.join(tmpRoot4, "repo"),
		);
		expect(result).toBeNull();
	});

	it("finds a tsconfig at the repo root (boundary is inclusive)", async () => {
		writeFileSync(path.join(tmpRoot4, "repo/tsconfig.json"), "{}");
		const result = await findTsConfig(
			path.join(tmpRoot4, "repo/src/feature"),
			path.join(tmpRoot4, "repo"),
		);
		expect(result).toBe(path.join(tmpRoot4, "repo/tsconfig.json"));
		rmSync(path.join(tmpRoot4, "repo/tsconfig.json"));
	});

	it("finds a tsconfig between the scope dir and the repo root", async () => {
		writeFileSync(path.join(tmpRoot4, "repo/src/tsconfig.json"), "{}");
		const result = await findTsConfig(
			path.join(tmpRoot4, "repo/src/feature"),
			path.join(tmpRoot4, "repo"),
		);
		expect(result).toBe(path.join(tmpRoot4, "repo/src/tsconfig.json"));
		rmSync(path.join(tmpRoot4, "repo/src/tsconfig.json"));
	});
});
