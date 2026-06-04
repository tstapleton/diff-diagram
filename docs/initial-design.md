> **Historical document.** This is the original design plan written before implementation began, preserved as a reference. For the current architecture, see [docs/architecture.md](./docs/architecture.md).

---

# Plan: Angular Architecture Diff Diagram Tool

## Goal

A CLI tool that takes an Angular feature directory, parses TypeScript imports from both a base branch and the current branch, computes an edge-level diff, overlays that diff on a dependency graph, and renders a component diagram. The intended use is as a PR review aid — showing what changed and how it fits in the architecture.

## User priorities

- **No Mermaid** — use elkjs for layout and SVG for output
- Two outputs: `diagram.svg` (static, for PR comment image) and `diagram.html` (interactive, for GitHub Pages)
- Modern Angular with standalone components
- All `.ts` files as nodes (including utils/constants/models) — not just Angular-decorated files
- Edge-level diff accuracy: run the analyzer on both base and current, diff both node and edge sets
- TypeScript throughout, well tested, well documented
- Clean CLI interface — this code will be moved into a packages directory in another repo

## Delivery model

A GitHub Actions workflow (in a separate repo) will:
1. Check out the base branch to a temp directory
2. Run this CLI with `--base-dir <base-checkout> <scope-dir>`
3. Post `diagram.svg` as a PR comment image
4. Publish `diagram.html` to GitHub Pages under `/pr/{number}/`

This repo is not responsible for CI integration or GitHub Pages deployment.

---

## Architecture overview

```
                    ┌─────────────────────────────────────┐
                    │              CLI (cli.ts)            │
                    │  --base-dir <dir>  <scope-dir>       │
                    └──────────┬──────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                                 ▼
    analyze(baseDir)                  analyze(scopeDir)
    filter.addContext()               filter.addContext()
              │                                 │
              └────────────────┬────────────────┘
                               ▼
                    diffGraphs(base, current)
                    → nodes with diff state
                    → edges with diff state (added/removed/unchanged)
                               │
                               ▼
                    layout.compute(graph, mode)   ← elkjs in Node
                    for each mode: All, Diff-focused
                               │
                               ▼
              ┌────────────────┼────────────────┐
              ▼                                 ▼
    draw.toSvg(diffFocusedLayout)    embed layouts in diagram.html
    → diagram.svg                    → diagram.html (thin browser renderer)
```

### Key architectural decisions

**Pre-computed layouts:** elkjs runs in Node (not the browser). The CLI computes layouts for all view modes and embeds them as JSON in `diagram.html`. The browser renderer reads pre-computed coordinates and draws; it does not run elkjs. This keeps one layout engine, one source of truth.

**Edge-level diff:** The analyzer runs twice — once on `--base-dir`, once on `<scope-dir>`. The resulting graphs are diffed: nodes present in current but not base are `added`; nodes in base but not current are `removed-ghost`; edges are diffed the same way within modified nodes.

**`--base-dir` replaces `--patch`:** There is no patch file input. The CI workflow is responsible for checking out the base branch to a directory and passing it via `--base-dir`. This keeps the CLI stateless with respect to git.

**`renderer.html` retired:** The standalone browser prototype is replaced by the CLI-generated `diagram.html`. Development iteration happens by running the CLI against the fake app fixtures.

---

## Node schema

All `.ts` files are nodes (except `.spec.ts` and `.d.ts`). Node granularity is file-level.

**File type classification** (determines border style — NOT color; color is reserved for diff state):

| Type | Detection |
|---|---|
| `component` | `@Component(...)` decorator |
| `service` | `@Injectable(...)` + not guard/resolver/interceptor |
| `pipe` | `@Pipe(...)` decorator |
| `guard` | `@Injectable` + `*.guard.ts` filename |
| `resolver` | `@Injectable` + `*.resolver.ts` filename |
| `interceptor` | `@Injectable` + `*.interceptor.ts` filename |
| `routing` | `*.routes.ts` filename |
| `module` | `@NgModule(...)` decorator (legacy) |
| `model` | No decorator, `*.model.ts` / `*.interface.ts` |
| `constants` | No decorator, only constant/function exports |

**Visual encoding:**
- **Color** = diff state: green (added), amber (modified), red (removed), dim gray (unchanged)
- **Border thickness** = thin for model/constants; normal for everything else
- **Out-of-scope nodes** = blue border, darker background

---

## Graph TypeScript types (`src/types.ts`)

```typescript
export type DiffState = 'added' | 'modified' | 'removed' | 'unchanged';
export type NodeScope = 'in-scope' | 'out-of-scope' | 'removed-ghost';
export type NodeType = 'component' | 'service' | 'pipe' | 'guard' | 'resolver'
                     | 'interceptor' | 'routing' | 'module' | 'model' | 'constants';
export type EdgeKind = 'import';

export interface GraphNode {
  id: string;        // repo-relative path, sanitized: alphanumeric + underscore
  label: string;     // PascalCase, derived from filename
  file: string;      // repo-relative path
  type: NodeType;
  scope: NodeScope;
  diff: DiffState | null;
}

export interface GraphEdge {
  from: string;      // node id
  to: string;        // node id
  kind: EdgeKind;
  diff?: DiffState;  // absent = unchanged
}

export interface GraphMeta {
  scopeDir: string;
  generatedAt: string;
  nodeCount: number;
  edgeCount: number;
}

export interface Graph {
  meta: GraphMeta;
  nodes: GraphNode[];
  edges: GraphEdge[];
  _oosEdges?: Array<{ from: string; toFile: string }>; // internal, consumed by filter
}
```

---

## Diff-focused view — collapse rules

The Diff-focused view is the primary output (used for both `diagram.svg` and the default HTML mode).

**In-scope directories:**
- If any file in a subdirectory changed → expand all files in that subdirectory as individual nodes
- If no file in a subdirectory changed → collapse the entire subdirectory to a single stub node (labeled with the directory name)
- Edges from expanded nodes to stub nodes are preserved

**Out-of-scope directories:**
- Group by immediate parent directory of each file
- If all files in a group are unchanged → collapse to a stub labeled with the immediate parent directory name
- If any file in a group changed → expand all files in that group as individual nodes
- Edges from in-scope nodes to out-of-scope stubs are preserved

**Stub nodes** represent collapsed directories. They have no `type` or `diff` — they are layout-only containers.

---

## View modes

Two view modes are implemented. Each has its own pre-computed elkjs layout embedded in `diagram.html`.

| Mode | Description | When used |
|---|---|---|
| All nodes | Every node expanded individually | Full architecture context |
| Diff-focused | Changed dirs expanded, unchanged collapsed to stubs | Default; used for `diagram.svg` |

**Future consideration — Clustered mode:** See the dedicated section below.

---

## 1-hop out-of-scope context

In-scope files import files outside the scope directory. Those external targets appear as context nodes. Their imports do NOT appear (no recursion).

Framework/npm packages (`@angular/`, `rxjs`, etc.) are excluded — they are not files on disk.

---

## Import resolution

The analyzer uses ts-morph initialized with the project's `tsconfig.json` (when present) so the TypeScript compiler resolves all import styles: relative paths, `baseUrl`-relative paths, and `paths` aliases. Fallback: relative-only resolution when no tsconfig is found.

Both TypeScript `import` declarations and Angular `@Component({ imports: [...] })` decorator arrays are captured. Both are represented as `kind: "import"` edges.

---

## File structure

```
diff-diagram/
  package.json                        ← TypeScript, build + test scripts
  tsconfig.json
  .npmrc                              ← save-exact=true, audit-level=high
  PLAN.md                             ← this file
  TASKS.md                            ← commit-level task list
  CLAUDE.md                           ← agent context
  README.md                           ← user-facing docs
  fake-angular-app/                   ← current (after) state fixture
    src/app/features/users/           ← scope directory (~65 .ts files)
    src/app/shared/                   ← out-of-scope context (~18 .ts files)
  fake-angular-app-base/              ← base (before) state fixture
    src/app/features/users/           ← same structure, before the PR changes
    src/app/shared/
  src/
    types.ts                          ← shared TypeScript interfaces
    analyzer.ts                       ← ts-morph parser → Graph
    filter.ts                         ← 1-hop out-of-scope expansion
    diff-parser.ts                    ← graph diffing (base vs current)
    cli.ts                            ← entry point
    renderer/
      layout.ts                       ← elkjs wrapper, pure, Node-side only
      draw.ts                         ← SVG generation from pre-computed layout
      graph-helpers.ts                ← node/edge filtering per view mode, stub computation
  dist/
    diagram.html                      ← interactive HTML, pre-computed layouts embedded
    diagram.svg                       ← diff-focused static diagram, for PR comment
    graph.json                        ← raw graph for debugging
```

---

## CLI interface

```bash
node src/cli.js \
  --base-dir <path-to-base-checkout> \
  --out-dir dist \
  <scope-dir>

# Optional flags:
#   --tsconfig <path>   explicit tsconfig.json (auto-detected otherwise)
#   --repo-root <path>  explicit repo root (auto-detected via .git otherwise)
```

**`--base-dir`** points to a directory containing the base branch files. The CI workflow is responsible for materializing this (e.g., via `git worktree add`). The CLI does not manage git state.

---

## Fake app fixtures

Two fixture directories represent a before/after PR state:

- `fake-angular-app-base/` — the base branch state (before the PR)
- `fake-angular-app/` — the current branch state (after the PR)

Integration tests run the full CLI pipeline with `--base-dir fake-angular-app-base` and verify the edge-level diff output.

The fake app is domain-organized (not type-organized): `user-list/`, `user-detail/`, `user-edit/`, etc. No barrel files. No `.spec.ts` files.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| elkjs `layered` too dense at high node count | Diff-focused mode reduces visible nodes; tune spacing |
| Decorator `imports` array symbol resolution fails | Keep edge with `kind: "import"`, skip unresolved |
| tsconfig path aliases not detected | Default to relative-only; add `--tsconfig` flag |
| Base dir has different tsconfig than current | Use each dir's own tsconfig independently |
| Pre-computed layout stale if graph changes | Layout is always recomputed by CLI; no caching |
| SVG label overflow | Truncate at ~25 chars with `…`; full name in `<title>` tooltip |

---

## Future consideration: Clustered mode

Clustered mode was implemented in the browser prototype and showed promise as a high-level glance view. It was cut from scope to keep the initial implementation focused, but is worth revisiting once All nodes and Diff-focused are solid.

### What it does

Every directory — both in-scope and out-of-scope — collapses to a single summary box regardless of whether it has changes. Each box shows:
- The directory name as a label
- A file count (e.g. `12 files`)
- A diff status badge or border color reflecting the aggregate state of its contents (any added → green, any modified → amber, any removed → red, all unchanged → dim)

Edges between directories are preserved and deduplicated: if three files in `workspace/` all import from `shared/services/`, there is one edge from the `workspace` box to the `shared/services` box.

### Why it was valuable

At 60+ nodes, the All nodes view is dense and requires the hover interactions to be useful. The Diff-focused view solves that for reviewing changes. Clustered solved a different problem: **orientation**. When a reviewer is unfamiliar with the feature's structure, Clustered gives them a 5-second map of how the major sub-areas relate before they zoom in.

In the browser prototype, switching to Clustered mode made the diagram immediately scannable — you could see at a glance that `workspace/` imports from `api/` and `shared-ui/`, and that `api/` imports from `shared/services/`. Diff colors on the boxes immediately showed which areas were touched.

### How to implement

The graph-helpers module already computes stub nodes and collapsed edges for Diff-focused mode. Clustered mode is the same logic with a simpler rule: collapse ALL directories unconditionally, not just unchanged ones. The layout and draw modules need no changes — they already handle stub nodes. The main work is:

1. Add `'clustered'` to the view mode type
2. Add a `computeViewNodes(graph, 'clustered')` branch in `graph-helpers.ts` that collapses every directory to a stub
3. Add the aggregate diff badge logic (reduce child node diff states to a single representative state)
4. Pre-compute the clustered layout in the CLI and embed it in `diagram.html`
5. Add the Clustered button to the HTML mode switcher
