import { describe, expect, it } from "vitest";
import type { Graph } from "../types.js";
import {
	buildCommentBody,
	COMMENT_MARKER,
	findExistingCommentId,
} from "./comment-body.js";

const ctx = {
	artifactUrl: "https://github.com/o/r/actions/runs/1/artifacts/9",
	runUrl: "https://github.com/o/r/actions/runs/1",
	headSha: "abc1234def5678",
};

function graph(overrides: Partial<Graph> = {}): Graph {
	return {
		meta: {
			scopeDir: "src/app/features/users",
			generatedAt: "2026-07-10T00:00:00.000Z",
			nodeCount: 0,
			edgeCount: 0,
		},
		nodes: [],
		edges: [],
		...overrides,
	};
}

describe("buildCommentBody", () => {
	it("starts with the marker and names the feature dir", () => {
		const body = buildCommentBody(graph(), ctx);
		expect(body.startsWith(COMMENT_MARKER)).toBe(true);
		expect(body).toContain("`src/app/features/users`");
	});

	it("counts in-scope files by diff state, treating removed-ghost as in-scope", () => {
		const body = buildCommentBody(
			graph({
				nodes: [
					{
						id: "a",
						label: "A",
						file: "f/a.ts",
						type: "component",
						scope: "in-scope",
						diff: "added",
					},
					{
						id: "b",
						label: "B",
						file: "f/b.ts",
						type: "service",
						scope: "in-scope",
						diff: "modified",
					},
					{
						id: "c",
						label: "C",
						file: "f/c.ts",
						type: "service",
						scope: "removed-ghost",
						diff: "removed",
					},
					{
						id: "d",
						label: "D",
						file: "f/d.ts",
						type: "service",
						scope: "in-scope",
						diff: "unchanged",
					},
				],
			}),
			ctx,
		);
		expect(body).toContain("**Files:** 1 added · 1 modified · 1 removed");
	});

	it("counts external (out-of-scope) dependency changes separately", () => {
		const body = buildCommentBody(
			graph({
				nodes: [
					{
						id: "x",
						label: "X",
						file: "shared/x.ts",
						type: "service",
						scope: "out-of-scope",
						diff: "added",
					},
					{
						id: "y",
						label: "Y",
						file: "shared/y.ts",
						type: "service",
						scope: "out-of-scope",
						diff: "unchanged",
					},
				],
			}),
			ctx,
		);
		expect(body).toContain(
			"**External dependencies:** 1 added · 0 modified · 0 removed",
		);
	});

	it("counts added and removed imports (edges)", () => {
		const body = buildCommentBody(
			graph({
				edges: [
					{ from: "a", to: "b", kind: "import", diff: "added" },
					{ from: "a", to: "c", kind: "import", diff: "added" },
					{ from: "a", to: "d", kind: "import", diff: "removed" },
					{ from: "a", to: "e", kind: "import", diff: "unchanged" },
				],
			}),
			ctx,
		);
		expect(body).toContain("**Imports:** 2 added · 1 removed");
	});

	it("lists changed files by name inside a details block", () => {
		const body = buildCommentBody(
			graph({
				nodes: [
					{
						id: "a",
						label: "A",
						file: "f/new.ts",
						type: "component",
						scope: "in-scope",
						diff: "added",
					},
					{
						id: "x",
						label: "X",
						file: "shared/dep.ts",
						type: "service",
						scope: "out-of-scope",
						diff: "added",
					},
				],
			}),
			ctx,
		);
		expect(body).toContain("<details>");
		expect(body).toContain("- `f/new.ts`");
		expect(body).toContain("**External dependencies added**");
		expect(body).toContain("- `shared/dep.ts`");
	});

	it("omits the details block when nothing changed", () => {
		const body = buildCommentBody(graph(), ctx);
		expect(body).not.toContain("<details>");
	});

	it("links the artifact, the run, and the short head sha", () => {
		const body = buildCommentBody(graph(), ctx);
		expect(body).toContain(ctx.artifactUrl);
		expect(body).toContain(ctx.runUrl);
		expect(body).toContain("abc1234");
		expect(body).not.toContain("abc1234def5678");
	});
});

describe("findExistingCommentId", () => {
	it("returns the id of the comment containing the marker", () => {
		expect(
			findExistingCommentId([
				{ id: 1, body: "unrelated" },
				{ id: 2, body: `${COMMENT_MARKER}\nold summary` },
			]),
		).toBe(2);
	});

	it("returns null when no comment has the marker, including undefined bodies", () => {
		expect(findExistingCommentId([{ id: 1 }, { id: 2, body: "hi" }])).toBe(
			null,
		);
	});
});
