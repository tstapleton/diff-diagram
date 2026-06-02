import path from 'path';
import { Project, SourceFile } from 'ts-morph';
import type { Graph, GraphNode, GraphEdge, NodeType } from './types.js';

// ─── File type classification ─────────────────────────────────────────────────

export function classifyByFilename(filePath: string): NodeType | null {
  const base = path.basename(filePath);
  if (base.endsWith('.routes.ts'))      return 'routing';
  if (base.endsWith('.guard.ts'))       return 'guard';
  if (base.endsWith('.resolver.ts'))    return 'resolver';
  if (base.endsWith('.interceptor.ts')) return 'interceptor';
  if (base.endsWith('.model.ts') || base.endsWith('.interface.ts')) return 'model';
  return null;
}

function classifyFile(sourceFile: SourceFile): NodeType {
  const byFilename = classifyByFilename(sourceFile.getFilePath());
  if (byFilename) return byFilename;

  for (const cls of sourceFile.getClasses()) {
    for (const dec of cls.getDecorators()) {
      const name = dec.getName();
      if (name === 'Component') return 'component';
      if (name === 'Pipe')      return 'pipe';
      if (name === 'NgModule')  return 'module';
      if (name === 'Injectable') return 'service';
    }
  }

  const exported = [...sourceFile.getExportedDeclarations().values()].flat();
  if (exported.length > 0 && exported.every(
    d => d.getKindName().includes('Interface') || d.getKindName().includes('TypeAlias')
  )) return 'model';

  return 'constants';
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function toNodeId(filePath: string, repoRoot: string): string {
  return path.relative(repoRoot, filePath)
    .replace(/\.ts$/, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function labelFromFile(filePath: string): string {
  const base = path.basename(filePath, '.ts');
  const name = base === 'index' ? path.basename(path.dirname(filePath)) : base;
  return name
    .split(/[-.]/)
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

// ─── Decorator imports extraction ────────────────────────────────────────────

function extractDecoratorImports(cls: ReturnType<SourceFile['getClasses']>[number]): string[] {
  const paths: string[] = [];
  for (const dec of cls.getDecorators()) {
    if (dec.getName() !== 'Component') continue;
    const args = dec.getArguments();
    if (!args.length) continue;
    const objLit = args[0] as any;
    if (!objLit.getProperties) continue;
    for (const prop of objLit.getProperties()) {
      if (!prop.getName?.() || prop.getName() !== 'imports') continue;
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

async function findTsConfig(startDir: string): Promise<string | null> {
  const { access } = await import('fs/promises');
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    const candidate = path.join(dir, 'tsconfig.json');
    try { await access(candidate); return candidate; } catch { /* keep walking */ }
    dir = path.dirname(dir);
  }
  return null;
}

// ─── Main analyzer ────────────────────────────────────────────────────────────

export async function analyze(
  scopeDir: string,
  { repoRoot, tsConfigPath }: { repoRoot?: string; tsConfigPath?: string | null } = {},
): Promise<Graph> {
  scopeDir = path.resolve(scopeDir);
  const resolvedRoot = repoRoot ? path.resolve(repoRoot) : path.dirname(scopeDir);

  if (!tsConfigPath) tsConfigPath = await findTsConfig(scopeDir);

  const project = new Project({
    ...(tsConfigPath ? { tsConfigFilePath: tsConfigPath } : {}),
    skipAddingFilesFromTsConfig: true,
  });

  project.addSourceFilesAtPaths([
    path.join(scopeDir, '**/*.ts'),
    `!${path.join(scopeDir, '**/*.spec.ts')}`,
    `!${path.join(scopeDir, '**/*.d.ts')}`,
    `!${path.join(scopeDir, '**/node_modules/**')}`,
  ]);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const oosEdges: Array<{ from: string; toFile: string }> = [];
  const nodeIdByFile = new Map<string, string>();

  for (const sf of project.getSourceFiles()) {
    if (!sf.getFilePath().startsWith(scopeDir)) continue;
    const fp = sf.getFilePath();
    const id = toNodeId(fp, resolvedRoot);
    nodeIdByFile.set(fp, id);
    nodes.push({
      id,
      label: labelFromFile(fp),
      file: path.relative(resolvedRoot, fp),
      type: classifyFile(sf),
      scope: 'in-scope',
      diff: null,
    });
  }

  for (const sf of project.getSourceFiles()) {
    if (!sf.getFilePath().startsWith(scopeDir)) continue;
    const fromId = nodeIdByFile.get(sf.getFilePath())!;

    const addEdge = (targetPath: string) => {
      const toId = nodeIdByFile.get(targetPath);
      if (toId) {
        if (toId !== fromId) edges.push({ from: fromId, to: toId, kind: 'import' });
      } else if (!targetPath.startsWith(scopeDir)) {
        oosEdges.push({ from: fromId, toFile: targetPath });
      }
    };

    for (const imp of sf.getImportDeclarations()) {
      const target = imp.getModuleSpecifierSourceFile();
      if (!target) continue;
      const targetPath = target.getFilePath();

      // Barrel resolution: when the import resolves to an index.ts, follow each
      // named import to its actual declaration file instead of pointing at the barrel.
      if (path.basename(targetPath) === 'index.ts') {
        const namedImports = imp.getNamedImports();
        if (namedImports.length > 0) {
          const barrelExports = target.getExportedDeclarations();
          for (const named of namedImports) {
            const exportName = named.getNameNode().getText();
            const decls = barrelExports.get(exportName);
            const resolved = decls?.find(d => d.getSourceFile().getFilePath() !== targetPath);
            addEdge(resolved ? resolved.getSourceFile().getFilePath() : targetPath);
          }
          continue;
        }
      }

      addEdge(targetPath);
    }

    for (const cls of sf.getClasses()) {
      for (const targetPath of extractDecoratorImports(cls)) {
        addEdge(targetPath);
      }
    }
  }

  const edgeSet = new Set<string>();
  const dedupedEdges = edges.filter(e => {
    const k = `${e.from}→${e.to}:${e.kind}`;
    return edgeSet.has(k) ? false : (edgeSet.add(k), true);
  });

  return {
    meta: {
      scopeDir: path.relative(resolvedRoot, scopeDir),
      repoRoot: resolvedRoot,
      generatedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: dedupedEdges.length,
      diffSha: null,
    },
    nodes,
    edges: dedupedEdges,
    _oosEdges: oosEdges,
  };
}
