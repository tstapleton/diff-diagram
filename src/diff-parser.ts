import type { Graph, GraphEdge, GraphNode } from "./types.js";

// ─── applyChangeMagnitude ─────────────────────────────────────────────────────
// Assigns each changed node (added/modified/removed) a relative change
// magnitude in [0, 1]: its linesChanged divided by the largest linesChanged in
// the graph. The heaviest-changed node always gets 1.0 (full diff-state color);
// if every changed node has linesChanged 0 they all get full intensity.
// Unchanged nodes are returned untouched.

function isChanged(node: GraphNode): boolean {
	return (
		node.diff === "added" || node.diff === "modified" || node.diff === "removed"
	);
}

export function applyChangeMagnitude(nodes: GraphNode[]): GraphNode[] {
	let maxChanged = 0;
	for (const node of nodes) {
		if (isChanged(node)) {
			maxChanged = Math.max(maxChanged, node.linesChanged ?? 0);
		}
	}
	return nodes.map((node) => {
		if (!isChanged(node)) return node;
		const magnitude =
			maxChanged > 0 ? (node.linesChanged ?? 0) / maxChanged : 1;
		return { ...node, magnitude };
	});
}

// ─── diffGraphs ───────────────────────────────────────────────────────────────
// Compares two fully-expanded graphs (base vs current) and produces a single
// diffed graph where every node and edge carries a diff state.

export function diffGraphs(base: Graph, current: Graph): Graph {
	// Canonical key for a node: its file path (repo-relative, same structure in both)
	const baseByFile = new Map(base.nodes.map((n) => [n.file, n]));
	const currentByFile = new Map(current.nodes.map((n) => [n.file, n]));

	// Map node id → file path for edge lookups
	const baseIdToFile = new Map(base.nodes.map((n) => [n.id, n.file]));
	const currentIdToFile = new Map(current.nodes.map((n) => [n.id, n.file]));

	// Edge maps keyed by "fromFile→toFile" → set of imported names
	const baseEdgeNames = new Map<string, Set<string>>();
	for (const e of base.edges) {
		const f = baseIdToFile.get(e.from),
			t = baseIdToFile.get(e.to);
		if (f && t)
			baseEdgeNames.set(`${f}→${t}`, new Set(e.importedNames ?? ["*"]));
	}
	const currentEdgeNames = new Map<string, Set<string>>();
	for (const e of current.edges) {
		const f = currentIdToFile.get(e.from),
			t = currentIdToFile.get(e.to);
		if (f && t)
			currentEdgeNames.set(`${f}→${t}`, new Set(e.importedNames ?? ["*"]));
	}

	// Helper: compare two name sets — returns true if they are identical
	function nameSetsEqual(a: Set<string>, b: Set<string>): boolean {
		if (a.size !== b.size) return false;
		for (const v of a) if (!b.has(v)) return false;
		return true;
	}

	// Outgoing edges grouped by from-node id, built once for the node loop below
	const baseEdgesByFrom = new Map<string, GraphEdge[]>();
	for (const e of base.edges) {
		const list = baseEdgesByFrom.get(e.from);
		if (list) list.push(e);
		else baseEdgesByFrom.set(e.from, [e]);
	}
	const currentEdgesByFrom = new Map<string, GraphEdge[]>();
	for (const e of current.edges) {
		const list = currentEdgesByFrom.get(e.from);
		if (list) list.push(e);
		else currentEdgesByFrom.set(e.from, [e]);
	}

	// ── Diff nodes ────────────────────────────────────────────────────────────
	const diffedNodes: GraphNode[] = [];

	for (const node of current.nodes) {
		if (!baseByFile.has(node.file)) {
			diffedNodes.push({
				...node,
				diff: "added",
				linesChanged: node.lineCount ?? 0,
			});
		} else {
			// biome-ignore lint/style/noNonNullAssertion: guarded by baseByFile.has() in the if-branch above
			const baseNode = baseByFile.get(node.file)!;

			const outgoingChanged = (currentEdgesByFrom.get(node.id) ?? []).some(
				(e) => {
					const toFile = currentIdToFile.get(e.to);
					if (!toFile) return false;
					const key = `${node.file}→${toFile}`;
					const baseNames = baseEdgeNames.get(key);
					if (!baseNames) return true; // added edge
					// biome-ignore lint/style/noNonNullAssertion: edge e is from current.edges so key was set in currentEdgeNames
					const currentNames = currentEdgeNames.get(key)!;
					return !nameSetsEqual(baseNames, currentNames); // modified edge
				},
			);

			const outgoingRemoved = (baseEdgesByFrom.get(baseNode.id) ?? []).some(
				(e) => {
					const toFile = baseIdToFile.get(e.to);
					return toFile && !currentEdgeNames.has(`${node.file}→${toFile}`);
				},
			);

			const isModified = outgoingChanged || outgoingRemoved;
			diffedNodes.push({
				...node,
				diff: isModified ? "modified" : "unchanged",
				...(isModified
					? {
							linesChanged: Math.abs(
								(node.lineCount ?? 0) - (baseNode.lineCount ?? 0),
							),
						}
					: {}),
			});
		}
	}

	// Ghost nodes for removed in-scope files (not out-of-scope — those just disappear)
	for (const node of base.nodes) {
		if (node.scope === "out-of-scope") continue;
		if (!currentByFile.has(node.file)) {
			diffedNodes.push({
				...node,
				scope: "removed-ghost",
				diff: "removed",
				linesChanged: node.lineCount ?? 0,
			});
		}
	}

	// ── Diff edges ────────────────────────────────────────────────────────────
	const diffedEdges: GraphEdge[] = [];

	for (const e of current.edges) {
		const fromFile = currentIdToFile.get(e.from);
		const toFile = currentIdToFile.get(e.to);
		const key = fromFile && toFile ? `${fromFile}→${toFile}` : null;
		if (!key) {
			diffedEdges.push({ ...e, diff: "added" });
			continue;
		}
		const baseNames = baseEdgeNames.get(key);
		if (!baseNames) {
			diffedEdges.push({ ...e, diff: "added" });
		} else {
			// biome-ignore lint/style/noNonNullAssertion: edge e is from current.edges so key was set in currentEdgeNames
			const currentNames = currentEdgeNames.get(key)!;
			const edgeDiff = nameSetsEqual(baseNames, currentNames)
				? "unchanged"
				: "modified";
			diffedEdges.push({ ...e, diff: edgeDiff });
		}
	}

	// Removed edges: in base but not in current — rendered using current/ghost node ids
	const currentFileToId = new Map(current.nodes.map((n) => [n.file, n.id]));
	const ghostFileToId = new Map(
		diffedNodes
			.filter((n) => n.scope === "removed-ghost")
			.map((n) => [n.file, n.id]),
	);

	for (const e of base.edges) {
		const fromFile = baseIdToFile.get(e.from);
		const toFile = baseIdToFile.get(e.to);
		if (!fromFile || !toFile) continue;
		if (currentEdgeNames.has(`${fromFile}→${toFile}`)) continue;

		const fromId = currentFileToId.get(fromFile) ?? ghostFileToId.get(fromFile);
		const toId = currentFileToId.get(toFile) ?? ghostFileToId.get(toFile);
		if (fromId && toId) {
			diffedEdges.push({
				from: fromId,
				to: toId,
				kind: e.kind,
				diff: "removed",
			});
		}
	}

	return {
		...current,
		meta: {
			...current.meta,
			nodeCount: diffedNodes.length,
			edgeCount: diffedEdges.length,
		},
		nodes: applyChangeMagnitude(diffedNodes),
		edges: diffedEdges,
	};
}
