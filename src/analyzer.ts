import { existsSync } from "node:fs";
import path from "node:path";
import { Project, type SourceFile } from "ts-morph";
import type { Graph, GraphEdge, GraphNode, NodeType } from "./types.js";

// ─── File type classification ─────────────────────────────────────────────────

export function classifyByFilename(filePath: string): NodeType | null {
	const base = path.basename(filePath);
	if (base.endsWith(".routes.ts")) return "routing";
	if (base.endsWith(".guard.ts")) return "guard";
	if (base.endsWith(".resolver.ts")) return "resolver";
	if (base.endsWith(".interceptor.ts")) return "interceptor";
	if (base.endsWith(".model.ts") || base.endsWith(".interface.ts"))
		return "model";
	return null;
}

function classifyFile(sourceFile: SourceFile): NodeType {
	const byFilename = classifyByFilename(sourceFile.getFilePath());
	if (byFilename) return byFilename;

	for (const cls of sourceFile.getClasses()) {
		for (const dec of cls.getDecorators()) {
			const name = dec.getName();
			if (name === "Component") return "component";
			if (name === "Pipe") return "pipe";
			if (name === "NgModule") return "module";
			if (name === "Injectable") return "service";
		}
	}

	const exported = [...sourceFile.getExportedDeclarations().values()].flat();
	if (
		exported.length > 0 &&
		exported.every(
			(d) =>
				d.getKindName().includes("Interface") ||
				d.getKindName().includes("TypeAlias"),
		)
	)
		return "model";

	return "constants";
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function toNodeId(filePath: string, repoRoot: string): string {
	return path
		.relative(repoRoot, filePath)
		.replace(/\.ts$/, "")
		.replace(/[^a-zA-Z0-9]/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_|_$/g, "");
}

export function oosDisplayPath(file: string, sourceRoot: string): string {
	const dir = path.dirname(file);
	const prefix = sourceRoot.endsWith("/") ? sourceRoot : `${sourceRoot}/`;
	return dir.startsWith(prefix) ? dir.slice(prefix.length) : dir;
}

export function labelFromFile(filePath: string): string {
	const base = path.basename(filePath, ".ts");
	const name = base === "index" ? path.basename(path.dirname(filePath)) : base;
	return name
		.split(/[-.]/)
		.map((p) => p.charAt(0).toUpperCase() + p.slice(1))
		.join("");
}

// ─── Decorator imports extraction ────────────────────────────────────────────

function extractDecoratorImports(
	cls: ReturnType<SourceFile["getClasses"]>[number],
): string[] {
	const paths: string[] = [];
	for (const dec of cls.getDecorators()) {
		if (dec.getName() !== "Component") continue;
		const args = dec.getArguments();
		if (!args.length) continue;
		// biome-ignore lint/suspicious/noExplicitAny: ts-morph decorator argument nodes have no typed introspection API
		const objLit = args[0] as any;
		if (!objLit.getProperties) continue;
		for (const prop of objLit.getProperties()) {
			if (!prop.getName?.() || prop.getName() !== "imports") continue;
			const init = prop.getInitializer?.();
			if (!init?.getElements) continue;
			for (const elem of init.getElements()) {
				const sf = elem.getSymbol()?.getDeclarations()?.[0]?.getSourceFile();
				if (sf) paths.push(sf.getFilePath());
			}
		}
	}
	return paths;
}

// ─── Auto-detect tsconfig ────────────────────────────────────────────────────

// Walks up from startDir looking for a tsconfig.json, stopping at repoRoot
// (inclusive). Never escapes the repo — a tsconfig in a parent directory
// (monorepo root, $HOME, …) must not change module resolution.
export async function findTsConfig(
	startDir: string,
	repoRoot: string,
): Promise<string | null> {
	const { access } = await import("node:fs/promises");
	const root = path.resolve(repoRoot);
	let dir = path.resolve(startDir);

	const rel = path.relative(root, dir);
	if (rel.startsWith("..") || path.isAbsolute(rel)) return null;

	while (true) {
		const candidate = path.join(dir, "tsconfig.json");
		try {
			await access(candidate);
			return candidate;
		} catch {
			/* keep walking */
		}
		if (dir === root || dir === path.dirname(dir)) break;
		dir = path.dirname(dir);
	}
	return null;
}

// ─── Main analyzer ────────────────────────────────────────────────────────────

export async function analyze(
	scopeDir: string,
	{ repoRoot }: { repoRoot?: string } = {},
): Promise<Graph> {
	scopeDir = path.resolve(scopeDir);
	const resolvedRoot = repoRoot
		? path.resolve(repoRoot)
		: path.dirname(scopeDir);

	const tsConfigPath = await findTsConfig(scopeDir, resolvedRoot);

	const project = new Project({
		...(tsConfigPath ? { tsConfigFilePath: tsConfigPath } : {}),
		skipAddingFilesFromTsConfig: true,
	});

	project.addSourceFilesAtPaths([
		path.join(scopeDir, "**/*.ts"),
		`!${path.join(scopeDir, "**/*.spec.ts")}`,
		`!${path.join(scopeDir, "**/*.stories.ts")}`,
		`!${path.join(scopeDir, "**/*.d.ts")}`,
		`!${path.join(scopeDir, "**/node_modules/**")}`,
	]);

	const nodes: GraphNode[] = [];
	const edges: GraphEdge[] = [];
	const oosEdges: Array<{ from: string; toFile: string; typeOnly?: boolean }> =
		[];
	const nodeIdByFile = new Map<string, string>();

	for (const sf of project.getSourceFiles()) {
		if (!sf.getFilePath().startsWith(scopeDir)) continue;
		const fp = sf.getFilePath();
		const id = toNodeId(fp, resolvedRoot);
		nodeIdByFile.set(fp, id);
		const base = fp.replace(/\.ts$/, "");
		const baseShort = base.replace(
			/\.(component|service|pipe|guard|resolver|interceptor|module|directive)$/,
			"",
		);
		const hasTests =
			existsSync(`${base}.spec.ts`) || existsSync(`${baseShort}.spec.ts`);
		const hasStories =
			existsSync(`${base}.stories.ts`) || existsSync(`${baseShort}.stories.ts`);
		nodes.push({
			id,
			label: labelFromFile(fp),
			file: path.relative(resolvedRoot, fp),
			type: classifyFile(sf),
			scope: "in-scope",
			diff: null,
			...(hasTests ? { hasTests: true } : {}),
			...(hasStories ? { hasStories: true } : {}),
		});
	}

	for (const sf of project.getSourceFiles()) {
		if (!sf.getFilePath().startsWith(scopeDir)) continue;
		// biome-ignore lint/style/noNonNullAssertion: set in the previous loop for every file in scopeDir
		const fromId = nodeIdByFile.get(sf.getFilePath())!;

		const addEdge = (
			targetPath: string,
			names: string[] = [],
			typeOnly = false,
		) => {
			const toId = nodeIdByFile.get(targetPath);
			if (toId) {
				if (toId !== fromId)
					edges.push({
						from: fromId,
						to: toId,
						kind: "import",
						...(names.length ? { importedNames: names } : {}),
						...(typeOnly ? { typeOnly: true } : {}),
					});
			} else if (!targetPath.startsWith(scopeDir)) {
				oosEdges.push({
					from: fromId,
					toFile: targetPath,
					...(typeOnly ? { typeOnly: true } : {}),
				});
			}
		};

		for (const imp of sf.getImportDeclarations()) {
			const target = imp.getModuleSpecifierSourceFile();
			if (!target) continue;
			const targetPath = target.getFilePath();

			const isTypeOnly = imp.isTypeOnly();

			// Barrel resolution: when the import resolves to an index.ts, follow each
			// named import to its actual declaration file instead of pointing at the barrel.
			if (path.basename(targetPath) === "index.ts") {
				const namedImports = imp.getNamedImports();
				if (namedImports.length > 0) {
					const barrelExports = target.getExportedDeclarations();
					for (const named of namedImports) {
						const exportName = named.getNameNode().getText();
						const decls = barrelExports.get(exportName);
						const resolved = decls?.find(
							(d) => d.getSourceFile().getFilePath() !== targetPath,
						);
						addEdge(
							resolved ? resolved.getSourceFile().getFilePath() : targetPath,
							[exportName],
							isTypeOnly,
						);
					}
					continue;
				}
			}

			const namedImports = imp.getNamedImports();
			const names =
				namedImports.length > 0 ? namedImports.map((n) => n.getName()) : ["*"];
			addEdge(targetPath, names, isTypeOnly);
		}

		for (const cls of sf.getClasses()) {
			for (const targetPath of extractDecoratorImports(cls)) {
				addEdge(targetPath, ["*"], false);
			}
		}
	}

	// Dedup edges by from→to, merging importedNames by union and typeOnly by AND
	const edgeMap = new Map<string, GraphEdge>();
	for (const e of edges) {
		const k = `${e.from}→${e.to}`;
		const existing = edgeMap.get(k);
		if (existing) {
			if (e.importedNames) {
				const merged = new Set([
					...(existing.importedNames ?? []),
					...e.importedNames,
				]);
				existing.importedNames = [...merged];
			}
			if (!e.typeOnly) delete existing.typeOnly;
		} else {
			edgeMap.set(k, { ...e });
		}
	}
	const dedupedEdges = [...edgeMap.values()];

	// Compute typeOnly for in-scope nodes: every incoming edge must be type-only
	const incomingByTo = new Map<string, GraphEdge[]>();
	for (const e of dedupedEdges) {
		const list = incomingByTo.get(e.to);
		if (list) list.push(e);
		else incomingByTo.set(e.to, [e]);
	}
	for (const node of nodes) {
		const incoming = incomingByTo.get(node.id) ?? [];
		if (incoming.length > 0 && incoming.every((e) => e.typeOnly === true)) {
			node.typeOnly = true;
		}
	}

	return {
		meta: {
			scopeDir: path.relative(resolvedRoot, scopeDir),
			repoRoot: resolvedRoot,
			generatedAt: new Date().toISOString(),
			nodeCount: nodes.length,
			edgeCount: dedupedEdges.length,
		},
		nodes,
		edges: dedupedEdges,
		_oosEdges: oosEdges,
	};
}
