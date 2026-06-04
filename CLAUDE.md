# diff-diagram

CLI tool that takes an Angular feature directory, runs TypeScript import analysis on both a base branch and the current branch, computes an edge-level diff, and renders a dependency diagram for PR review.

## Setup

```bash
npm install
npm run build   # compiles TypeScript → dist/
npm test        # runs vitest
```

## Usage

```bash
# Run against fake app fixtures (base vs current)
node dist/cli.js \
  --repo-root fake-angular-app \
  --base-repo-root fake-angular-app-base \
  src/app/features/users

# Run against a real Angular repo
node dist/cli.js \
  --repo-root /path/to/repo \
  --base-repo-root /tmp/base-checkout \
  src/app/features/my-feature
```

`--repo-root` is the working-tree repo root; `<scope-dir>` is a path relative to it.
`--base-repo-root` points to a materialized base-branch checkout (e.g., via `git worktree add`).
The CLI does not manage git state.

Optional flags: `--out-dir <dir>` (default `dist`), `--tsconfig <file>`, `--source-root <dir>` (default `src/app`).

## Count nodes in any Angular feature directory

```bash
find <scope-dir> -name "*.ts" ! -name "*.spec.ts" | wc -l
```

## Fake app fixtures

Two fixture directories represent a before/after PR state:

- `fake-angular-app-base/` — base branch state (before the PR)
- `fake-angular-app/` — current branch state (after the PR)

Both are domain-organized (not type-organized): `user-list/`, `user-detail/`, `user-edit/`, etc. No barrel files. No `.spec.ts` files.

Integration tests run the full CLI pipeline with `--base-dir fake-angular-app-base` and verify node and edge diff output.

## Architecture

```
CLI (cli.ts)
  ├── analyze(baseDir)    → base Graph       (analyzer.ts + filter.ts)
  ├── analyze(scopeDir)   → current Graph    (analyzer.ts + filter.ts)
  ├── diffGraphs(base, current) → diff Graph (diff-parser.ts)
  ├── computeLayout(graph, 'all')         → allLayout       (renderer/layout.ts)
  ├── computeLayout(graph, 'diff-focused') → focusedLayout  (renderer/layout.ts)
  ├── draw.toSvg(focusedLayout)  → diagram.svg              (renderer/draw.ts)
  └── embed(allLayout, focusedLayout, graph) → diagram.html
```

### Module responsibilities

| File | Responsibility |
|---|---|
| `src/types.ts` | Shared TypeScript interfaces: Graph, GraphNode, GraphEdge, DiffState, etc. |
| `src/analyzer.ts` | ts-morph parser: reads `.ts` files from a directory, extracts imports + decorator imports, returns Graph with in-scope nodes and `_oosEdges` |
| `src/filter.ts` | 1-hop expansion: follows `_oosEdges` to add out-of-scope context nodes |
| `src/diff-parser.ts` | Graph diffing: `diffGraphs(base, current)` — diffs node sets and edge sets, sets `diff` field on all nodes and edges |
| `src/renderer/graph-helpers.ts` | View mode computation: `computeViewNodes(graph, mode)` applies collapse rules to produce nodes/edges for a given mode |
| `src/renderer/layout.ts` | elkjs wrapper: `computeLayout(nodes, edges)` returns x/y/width/height per node and bend points per edge. Runs in Node only. |
| `src/renderer/draw.ts` | SVG generation: `toSvg(layout, nodes, edges)` returns an SVG string. Pure function, no DOM. |
| `src/cli.ts` | Entry point: orchestrates the full pipeline, writes dist/ outputs |

### diagram.html

The HTML output contains pre-computed layout data (JSON) for all view modes, embedded by the CLI. The browser renderer is a thin shell — it reads those coordinates and draws SVG. It does NOT run elkjs. This means one layout engine (Node-side), full hover interactions in the browser (node highlight on hover, edge highlight), and no CDN dependencies.

### Diff-focused collapse rules

The Diff-focused view reduces a large graph to what matters for a PR:

**In-scope:**
- Subdirectory with any changed file → expand all files in that subdirectory as individual nodes
- Subdirectory with no changed files → collapse to a single stub node
- Edges from expanded nodes to stubs are preserved

**Out-of-scope:**
- Group by immediate parent directory
- Group with any changed file → expand all files in that group
- Group with no changed files → collapse to a stub
- Edges from in-scope nodes to stubs are preserved

## Graph schema

Defined in `src/types.ts`. Key types:

```
GraphNode: { id, label, file, type, scope, diff }
  type:  component | service | pipe | guard | resolver | interceptor | routing | module | model | constants
  scope: in-scope | out-of-scope | removed-ghost
  diff:  added | modified | removed | unchanged | null

GraphEdge: { from, to, kind, diff? }
  kind:  import
  diff:  added | removed | unchanged (absent = unchanged)
```

Node `id` is the repo-relative file path with `.ts` stripped, all non-alphanumeric characters replaced with `_`, consecutive underscores collapsed, leading/trailing underscores trimmed.

Node `label` is the filename (no extension, no path) converted from kebab-case to PascalCase, splitting on both `-` and `.` (e.g. `user-list.component.ts` → `UserListComponent`).

## Development workflow

- Each commit must complete exactly one task from `TASKS.md` and mark it done (`- [x]`) in the same commit.
- Before asking the user to review output, read through the relevant code and check for obvious bugs.
- Do not add features, refactoring, or cleanup beyond what the current task requires.

## Validation gates

**If a gate fails, change approach — do not skip.**

- Gate 1: `npm test` — all tests pass
- Gate 2: `node dist/cli.js --repo-root fake-angular-app --base-repo-root fake-angular-app-base src/app/features/users` — node count correct, edge diff states correct, no node_modules nodes, labels correct (PascalCase)
- Gate 3: open `dist/diagram.html` in browser — both view modes render, hover highlights edges, diff colors correct
- Gate 4: inspect `dist/diagram.svg` — real graph layout with edges, not a list of boxes
