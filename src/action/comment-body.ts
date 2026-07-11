import type { DiffState, Graph, GraphNode } from "../types.js";

export const COMMENT_MARKER = "<!-- diff-diagram -->";

export interface CommentContext {
	artifactUrl: string;
	runUrl: string;
	headSha: string;
}

function byDiff(nodes: GraphNode[], diff: DiffState): GraphNode[] {
	return nodes.filter((n) => n.diff === diff);
}

export function buildCommentBody(graph: Graph, ctx: CommentContext): string {
	const external = graph.nodes.filter((n) => n.scope === "out-of-scope");
	const inScope = graph.nodes.filter((n) => n.scope !== "out-of-scope");
	const importsAdded = graph.edges.filter((e) => e.diff === "added").length;
	const importsRemoved = graph.edges.filter((e) => e.diff === "removed").length;

	const lines = [
		COMMENT_MARKER,
		`### 📊 Dependency diff — \`${graph.meta.scopeDir}\``,
		"",
		`**Files:** ${byDiff(inScope, "added").length} added · ${byDiff(inScope, "modified").length} modified · ${byDiff(inScope, "removed").length} removed`,
		`**External dependencies:** ${byDiff(external, "added").length} added · ${byDiff(external, "modified").length} modified · ${byDiff(external, "removed").length} removed`,
		`**Imports:** ${importsAdded} added · ${importsRemoved} removed`,
	];

	const changed: string[] = [];
	const section = (title: string, nodes: GraphNode[]): void => {
		if (nodes.length === 0) return;
		changed.push("", `**${title}**`, ...nodes.map((n) => `- \`${n.file}\``));
	};
	section("Added", byDiff(inScope, "added"));
	section("Modified", byDiff(inScope, "modified"));
	section("Removed", byDiff(inScope, "removed"));
	section("External dependencies added", byDiff(external, "added"));
	section("External dependencies removed", byDiff(external, "removed"));

	if (changed.length > 0) {
		lines.push(
			"",
			"<details>",
			"<summary>Changed files</summary>",
			...changed,
			"",
			"</details>",
		);
	}

	lines.push(
		"",
		`**[Open interactive diagram ↗](${ctx.artifactUrl})** — link expires with artifact retention`,
		"",
		`<sub>Updated for ${ctx.headSha.slice(0, 7)} · [workflow run](${ctx.runUrl})</sub>`,
	);
	return lines.join("\n");
}

export function findExistingCommentId(
	comments: Array<{ id: number; body?: string }>,
): number | null {
	return comments.find((c) => c.body?.includes(COMMENT_MARKER))?.id ?? null;
}
