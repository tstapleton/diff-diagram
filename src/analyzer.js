import path from 'path';
import { Project } from 'ts-morph';

// ─── File type classification ─────────────────────────────────────────────────

function classifyFile(sourceFile) {
  const base = path.basename(sourceFile.getFilePath());

  // Filename-pattern rules take priority
  if (base.endsWith('.routes.ts'))      return 'routing';
  if (base.endsWith('.guard.ts'))       return 'guard';
  if (base.endsWith('.resolver.ts'))    return 'resolver';
  if (base.endsWith('.interceptor.ts')) return 'interceptor';
  if (base.endsWith('.model.ts') || base.endsWith('.interface.ts')) return 'model';

  for (const cls of sourceFile.getClasses()) {
    for (const dec of cls.getDecorators()) {
      const name = dec.getName();
      if (name === 'Component') return 'component';
      if (name === 'Pipe')      return 'pipe';
      if (name === 'NgModule')  return 'module';
      if (name === 'Injectable') return 'service';
    }
  }

  // No Angular decorator — check if only interfaces/types exported
  const exported = [...sourceFile.getExportedDeclarations().values()].flat();
  if (exported.length > 0 && exported.every(
    d => d.getKindName().includes('Interface') || d.getKindName().includes('TypeAlias')
  )) return 'model';

  return 'constants';
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function toNodeId(filePath, repoRoot) {
  return path.relative(repoRoot, filePath)
    .replace(/\.ts$/, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

export function labelFromFile(filePath) {
  return path.basename(filePath, '.ts')
    .split('-')
    .map(p => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
}

// ─── Decorator imports extraction ────────────────────────────────────────────

function extractDecoratorImports(cls) {
  const paths = [];
  for (const dec of cls.getDecorators()) {
    if (dec.getName() !== 'Component') continue;
    const args = dec.getArguments();
    if (!args.length) continue;
    const objLit = args[0];
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

async function findTsConfig(startDir) {
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

export async function analyze(scopeDir, { repoRoot, tsConfigPath } = {}) {
  scopeDir = path.resolve(scopeDir);
  repoRoot = repoRoot ? path.resolve(repoRoot) : path.dirname(scopeDir);

  if (!tsConfigPath) tsConfigPath = await findTsConfig(scopeDir);

  const project = new Project(
    tsConfigPath
      ? { tsConfigFilePath: tsConfigPath, skipFilesWithErrors: true }
      : { skipAddingFilesFromTsConfig: true, skipFilesWithErrors: true }
  );

  project.addSourceFilesAtPaths([
    path.join(scopeDir, '**/*.ts'),
    `!${path.join(scopeDir, '**/*.spec.ts')}`,
  ]);

  const nodes = [];
  const edges = [];
  // Out-of-scope edges: { from: nodeId, toFile: absolutePath }
  const oosEdges = [];
  const nodeIdByFile = new Map(); // absolutePath → nodeId (in-scope only)

  // First pass: register all in-scope nodes
  for (const sf of project.getSourceFiles()) {
    if (!sf.getFilePath().startsWith(scopeDir)) continue;
    const fp = sf.getFilePath();
    const id = toNodeId(fp, repoRoot);
    nodeIdByFile.set(fp, id);
    nodes.push({
      id,
      label: labelFromFile(fp),
      file: path.relative(repoRoot, fp),
      type: classifyFile(sf),
      scope: 'in-scope',
      diff: null,
    });
  }

  // Second pass: extract edges
  for (const sf of project.getSourceFiles()) {
    if (!sf.getFilePath().startsWith(scopeDir)) continue;
    const fromId = nodeIdByFile.get(sf.getFilePath());

    const addEdge = (targetPath, kind) => {
      const toId = nodeIdByFile.get(targetPath);
      if (toId) {
        if (toId !== fromId) edges.push({ from: fromId, to: toId, kind });
      } else if (!targetPath.startsWith(scopeDir)) {
        oosEdges.push({ from: fromId, toFile: targetPath });
      }
    };

    for (const imp of sf.getImportDeclarations()) {
      const target = imp.getModuleSpecifierSourceFile();
      if (target) addEdge(target.getFilePath(), 'import');
    }

    for (const cls of sf.getClasses()) {
      for (const targetPath of extractDecoratorImports(cls)) {
        addEdge(targetPath, 'import');
      }
    }
  }

  // Deduplicate edges
  const edgeSet = new Set();
  const dedupedEdges = edges.filter(e => {
    const k = `${e.from}→${e.to}:${e.kind}`;
    return edgeSet.has(k) ? false : (edgeSet.add(k), true);
  });

  return {
    meta: {
      scopeDir: path.relative(repoRoot, scopeDir),
      repoRoot,
      generatedAt: new Date().toISOString(),
      nodeCount: nodes.length,
      edgeCount: dedupedEdges.length,
      diffSha: null,
    },
    nodes,
    edges: dedupedEdges,
    _oosEdges: oosEdges, // consumed by filter.js
  };
}
