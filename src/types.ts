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
	/** Total line count of the file (set by the analyzer for in-scope nodes). */
	lineCount?: number;
	/** Absolute lines-changed delta vs base (set by diffGraphs on changed nodes). */
	linesChanged?: number;
	/** Relative change magnitude 0–1, linesChanged / max(linesChanged) (set by diffGraphs on changed nodes). */
	magnitude?: number;
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
	diffSha?: string | null;
}

export interface Graph {
	meta: GraphMeta;
	nodes: GraphNode[];
	edges: GraphEdge[];
	_oosEdges?: Array<{ from: string; toFile: string; typeOnly?: boolean }>;
}
