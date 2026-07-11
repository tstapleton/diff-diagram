import path from "node:path";
import { classifyByFilename, labelFromFile, toNodeId } from "./analyzer.js";
import type { Graph, GraphEdge, GraphNode } from "./types.js";

function classifyOutOfScope(filePath: string): GraphNode["type"] {
	const byFilename = classifyByFilename(filePath);
	if (byFilename) return byFilename;
	const base = path.basename(filePath);
	if (base.endsWith(".service.ts")) return "service";
	if (base.endsWith(".component.ts")) return "component";
	if (base.endsWith(".pipe.ts")) return "pipe";
	return "constants";
}

export function addContext(graph: Graph): Graph {
	const repoRoot = graph.meta.repoRoot ?? "";
	const oosEdges = graph._oosEdges ?? [];

	const contextById = new Map<string, GraphNode>();
	const newEdges: GraphEdge[] = [];

	for (const oe of oosEdges) {
		const { from, toFile } = oe;
		if (!toFile || !path.isAbsolute(toFile) || toFile.endsWith(".d.ts"))
			continue;

		const id = toNodeId(toFile, repoRoot);
		if (!contextById.has(id)) {
			contextById.set(id, {
				id,
				label: labelFromFile(toFile),
				file: path.relative(repoRoot, toFile),
				type: classifyOutOfScope(toFile),
				scope: "out-of-scope",
				diff: null,
			});
		}

		newEdges.push({
			from,
			to: id,
			kind: "import",
			...(oe.typeOnly ? { typeOnly: true } : {}),
		});
	}

	const edgeSet = new Set<string>(
		graph.edges.map((e) => `${e.from}→${e.to}:${e.kind}`),
	);
	const dedupedNew = newEdges.filter((e) => {
		const k = `${e.from}→${e.to}:${e.kind}`;
		if (edgeSet.has(k)) return false;
		edgeSet.add(k);
		return true;
	});

	// Compute typeOnly for OOS context nodes: every incoming edge must be type-only
	const incomingByTo = new Map<string, GraphEdge[]>();
	for (const e of [...graph.edges, ...dedupedNew]) {
		const list = incomingByTo.get(e.to);
		if (list) list.push(e);
		else incomingByTo.set(e.to, [e]);
	}
	for (const [id, node] of contextById) {
		const incoming = incomingByTo.get(id) ?? [];
		if (incoming.length > 0 && incoming.every((e) => e.typeOnly === true)) {
			node.typeOnly = true;
		}
	}

	const allNodes = [...graph.nodes, ...contextById.values()];
	const allEdges = [...graph.edges, ...dedupedNew];

	return {
		...graph,
		meta: {
			...graph.meta,
			nodeCount: allNodes.length,
			edgeCount: allEdges.length,
		},
		nodes: allNodes,
		edges: allEdges,
		_oosEdges: undefined,
	};
}
