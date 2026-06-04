export type DiffState = 'added' | 'modified' | 'removed' | 'unchanged';
export type NodeScope = 'in-scope' | 'out-of-scope' | 'removed-ghost';
export type NodeType =
  | 'component'
  | 'service'
  | 'pipe'
  | 'guard'
  | 'resolver'
  | 'interceptor'
  | 'routing'
  | 'module'
  | 'model'
  | 'constants'
  | 'stub';
export type EdgeKind = 'import';

export interface GraphNode {
  id: string;
  label: string;
  file: string;
  type: NodeType;
  scope: NodeScope;
  diff: DiffState | null;
  typeOnly?: boolean;
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
