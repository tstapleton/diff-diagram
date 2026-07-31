import { diffLines } from "diff";
import type { Graph, GraphEdge, GraphNode } from "./types.js";

// Note: for a "modified" node this sums both removed and added lines from
// diffLines, so a same-length single-line edit scores 2 — while "added"/
// "removed" nodes score their own line count once (via diffLines("", content)
// or diffLines(content, "")). This is intentional, not a unit mismatch: a
// full rewrite touches roughly twice as much text as an equivalent fresh
// addition, in terms of what a reviewer has to read.
function countChangedLines(
	base: string | undefined,
	current: string | undefined,
): number {
	return diffLines(base ?? "", current ?? "")
		.filter((change) => change.added || change.removed)
		.reduce((sum, change) => sum + change.count, 0);
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

	// ── Diff nodes ────────────────────────────────────────────────────────────
	// Node diff state reflects the file's own content, not its edges — symmetric
	// with added/removed, which are also file-level facts. Edge diff state
	// (below) remains import-based and is computed independently.
	const diffedNodes: GraphNode[] = [];

	for (const node of current.nodes) {
		if (!baseByFile.has(node.file)) {
			diffedNodes.push({
				...node,
				diff: "added",
				linesChanged: countChangedLines(undefined, node._content),
			});
		} else {
			// biome-ignore lint/style/noNonNullAssertion: guarded by baseByFile.has() in the if-branch above
			const baseNode = baseByFile.get(node.file)!;
			const changed = baseNode._content !== node._content;
			diffedNodes.push({
				...node,
				diff: changed ? "modified" : "unchanged",
				linesChanged: changed
					? countChangedLines(baseNode._content, node._content)
					: 0,
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
				linesChanged: countChangedLines(undefined, node._content),
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
				...(e.typeOnly ? { typeOnly: true } : {}),
				...(e.importedNames ? { importedNames: e.importedNames } : {}),
			});
		}
	}

	const nodesWithMagnitude = applyChangeMagnitude(diffedNodes);

	return {
		...current,
		meta: {
			...current.meta,
			nodeCount: nodesWithMagnitude.length,
			edgeCount: diffedEdges.length,
		},
		nodes: nodesWithMagnitude,
		edges: diffedEdges,
	};
}

// ─── applyChangeMagnitude ───────────────────────────────────────────────────
// Scales each changed node's linesChanged into a magnitude in [0, 1], among
// those that will actually render a magnitude fill (in-scope and
// removed-ghost — see docs/superpowers/specs/2026-07-30-change-magnitude-design.md).
// Out-of-scope nodes keep linesChanged but never get a magnitude, so a large
// unrelated OOS diff can't flatten every in-scope magnitude.
//
// Scaled relative to the 80th percentile of eligible linesChanged, not the
// max, with anything above that percentile clamped to 1. Real PR data showed
// plain max-relative scaling is dominated by a single outlier file: one
// large rewrite among many small changes left the majority of changed files
// scored below magnitude 0.2, effectively invisible (see the design spec's
// "Revision: percentile-clamped scaling" section for the analysis). This
// trades away rank distinction among the very largest files — they all
// render at full intensity — for much better visibility across the
// small-to-medium majority, which is what a reviewer's eye actually needs.
// With 5 or fewer eligible nodes this reduces to plain max-relative scaling,
// since the 80th percentile of a small set is always its largest value.

function isMagnitudeEligible(node: GraphNode): boolean {
	return (
		(node.scope === "in-scope" || node.scope === "removed-ghost") &&
		node.diff !== null &&
		node.diff !== "unchanged"
	);
}

// Nearest-rank percentile over an ascending-sorted array.
function percentile(sortedAscending: number[], p: number): number {
	const idx = Math.min(
		sortedAscending.length - 1,
		Math.floor(sortedAscending.length * (p / 100)),
	);
	return sortedAscending[idx];
}

export function applyChangeMagnitude(nodes: GraphNode[]): GraphNode[] {
	const eligibleLinesChanged = nodes
		.filter(isMagnitudeEligible)
		.map((n) => n.linesChanged ?? 0)
		.sort((a, b) => a - b);

	const scale =
		eligibleLinesChanged.length > 0 ? percentile(eligibleLinesChanged, 80) : 0;

	return nodes.map((node) => {
		if (!isMagnitudeEligible(node)) return node;
		return {
			...node,
			magnitude: scale > 0 ? Math.min(1, (node.linesChanged ?? 0) / scale) : 1,
		};
	});
}
