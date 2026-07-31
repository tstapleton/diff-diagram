export type DiffState = "added" | "modified" | "removed" | "unchanged";
export type NodeScope = "in-scope" | "out-of-scope" | "removed-ghost";
export type NodeType =
	| "component"
	| "service"
	| "pipe"
	| "guard"
	| "resolver"
	| "interceptor"
	| "routing"
	| "module"
	| "model"
	| "constants";
export type EdgeKind = "import";

export interface GraphNode {
	id: string;
	label: string;
	file: string;
	type: NodeType | "stub";
	scope: NodeScope;
	diff: DiffState | null;
	typeOnly?: boolean;
	hasTests?: boolean;
	hasStories?: boolean;
	/**
	 * Lines changed vs. the base branch: the file's own line count for
	 * added/removed nodes, a real line-level diff count for modified nodes,
	 * 0 for unchanged. Set by diffGraphs; absent in single-branch mode (no
	 * base to diff against).
	 */
	linesChanged?: number;
	/**
	 * linesChanged scaled to [0, 1], relative to the most-changed node among
	 * those that render a magnitude fill (in-scope and removed-ghost nodes).
	 * Set by applyChangeMagnitude; absent on out-of-scope and unchanged nodes.
	 */
	magnitude?: number;
	/**
	 * Internal only: the file's raw text, used by diffGraphs to detect content
	 * changes. Never serialized — stripped from graph.json before it's written.
	 */
	_content?: string;
}

export interface GraphEdge {
	from: string;
	to: string;
	kind: EdgeKind;
	diff?: DiffState;
	importedNames?: string[];
	typeOnly?: boolean;
}

export interface GraphMeta {
	scopeDir: string;
	repoRoot?: string;
	generatedAt: string;
	nodeCount: number;
	edgeCount: number;
}

export interface Graph {
	meta: GraphMeta;
	nodes: GraphNode[];
	edges: GraphEdge[];
	_oosEdges?: Array<{ from: string; toFile: string; typeOnly?: boolean }>;
}
