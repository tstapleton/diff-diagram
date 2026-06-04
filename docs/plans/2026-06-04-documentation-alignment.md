# Documentation Alignment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align all documentation with the current codebase, establish consistent terminology, reorganize files into a clean structure, and write a glossary.

**Architecture:** Documentation-only work except Task 5 (CLI help text + `verify` npm script) and Task 6 (move files). Each task produces one commit. Tasks are ordered so correctness fixes come before reorganization, and reorganization comes before the README rewrite.

**Tech Stack:** Markdown, TypeScript (`src/cli.ts` for help text), JSON (`package.json` for `verify` script)

---

## Audit: What Drifted

The following specific divergences were found. Each is addressed by a task below.

### A. Wrong CLI flags in docs

`--base-dir` was removed when the CLI was simplified (commit `fbfd029`). It no longer exists. Three files still reference it:

| File | Problem |
|---|---|
| `README.md:34,44` | Usage block and flag table include `--base-dir` |
| `ARCHITECTURE.md:153` | Key flags list includes `--base-dir` |
| `ARCHITECTURE.md:155` | Base-root derivation description references `--base-dir` |
| `PLAN.md` | Multiple references — **archived as-is, not updated** |

Correct flags: `--repo-root`, `--base-repo-root`, `--out-dir`, `--tsconfig`, `--source-root`, positional `<feature-dir>`.

`--source-root` is also missing from README's flag table.

### B. Stale types schema in docs

`src/types.ts` has fields not documented in `ARCHITECTURE.md`:

| Type | Fields missing from docs |
|---|---|
| `GraphNode` | `typeOnly?: boolean`, `hasTests?: boolean`, `hasStories?: boolean` |
| `GraphEdge` | `importedNames?: string[]`, `typeOnly?: boolean` |
| `GraphMeta` | `repoRoot?: string`, `diffSha?: string \| null` |
| `_oosEdges` items | `typeOnly?: boolean` |

`ARCHITECTURE.md` is the single source of truth for types. `CLAUDE.md` will not duplicate the schema — it will point to `docs/architecture.md` instead.

### C. Dead code with stale doc comment

`applyDiff` and `parseDiffOutput` in `src/diff-parser.ts` are exported and tested but not called from any production code. `ARCHITECTURE.md` describes `applyDiff` as "legacy function kept for backward compatibility. Will be removed after all callers migrate." — there are no callers; the migration is complete. This plan fixes the documentation only; removing the functions is a separate decision.

### D. Inconsistent "feature directory" terminology

The concept — the directory passed as the positional arg, containing all in-scope nodes — is called different things in different places:

| Used | Location |
|---|---|
| "feature directory" | README intro, CLAUDE.md intro |
| "scope directory" | PLAN.md, ARCHITECTURE.md |
| `<scope-dir>` | CLI help text (user-visible) |
| `scopeDir` | Internal code variable, JSON output field `GraphMeta.scopeDir` |

Decision:
- All human-facing text (docs, CLI help) uses **"feature directory"** and `<feature-dir>`
- Internal code variable `scopeDir` stays as-is (internal detail, large churn)
- `GraphMeta.scopeDir` JSON field stays as-is (changing is a breaking API change)
- Docs note that `graph.json` uses `scopeDir` as the JSON field name for the feature directory

### E. File organization

Root-level markdown files that aren't the README or agent context:

| File | Action |
|---|---|
| `ARCHITECTURE.md` | Move to `docs/architecture.md` |
| `PLAN.md` | Archive as-is → `docs/initial-design.md` (no content changes) |
| `TASKS.md` | **Delete** (all tasks complete; keeping it implies ongoing work) |
| `FUTURE_WORK.md` | Move to `docs/backlog.md` (it's a maintained backlog, not a one-time list) |
| `plans/` | Move to `docs/plans/` |

`README.md` and `CLAUDE.md` stay at root.

### F. README issues

Beyond wrong flags:
- Architecture section links to `PLAN.md` ("See PLAN.md for the full design") — PLAN.md is outdated
- First sentence doesn't mention the feature-directory focus
- No mention of visual regression tests in Development section

### G. CLAUDE.md duplication

CLAUDE.md duplicates the architecture module table and the graph schema from ARCHITECTURE.md. It should be a thin document that points to `docs/architecture.md` for those details. The sections to keep: project goal, setup, usage example, fixtures, development workflow rule, and validation gates.

### H. Missing glossary

No single place defines the vocabulary: feature directory, scope, out-of-scope, diff state, stub node, ghost node, etc.

### I. Missing `verify` npm script

No script combines compile + tests into a single "does everything pass?" check. The user wants `npm run verify` to mean: type-check and run all tests.

---

## File Map

**Modified:**
- `README.md` — major rewrite (Task 7)
- `ARCHITECTURE.md` → `docs/architecture.md` — fix flags, fix types, terminology (Tasks 2, 3, 5, 6)
- `PLAN.md` → `docs/initial-design.md` — archive as-is, add deprecation header (Task 6)
- `FUTURE_WORK.md` → `docs/backlog.md` — add new items, then move (Tasks 8, 6)
- `CLAUDE.md` — trim to pointer doc; remove duplicated sections (Task 4)
- `src/cli.ts` — help text: standard `--help` format with `<feature-dir>` (Task 5)
- `package.json` — add `verify` script (Task 5)

**Deleted:**
- `TASKS.md` (Task 6)

**Created:**
- `docs/glossary.md` (Task 7)
- `docs/plans/` (Task 6, moves existing `plans/`)

---

## Task 1: Fix stale `--base-dir` flag references in README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite the Usage section**

Replace the current usage block (lines 32–48) with:

```markdown
## Usage

```bash
node dist/cli.js \
  --repo-root <repo-root> \
  --base-repo-root <base-repo-root> \
  <feature-dir>
```

| Arg / Flag | Description | Default |
|---|---|---|
| `<feature-dir>` | Feature directory to diagram, relative to `--repo-root` (required) | — |
| `--repo-root` | Repo root for the current branch | auto-detected via `.git` |
| `--base-repo-root` | Repo root for a pre-checked-out base branch | no diff mode |
| `--out-dir` | Output directory | `dist` |
| `--tsconfig` | Path to tsconfig.json | auto-detected |
| `--source-root` | Source root prefix for label derivation | `src/app` |
```

- [ ] **Step 2: Fix the fake Angular app example**

Replace the current "Example: fake Angular app" block (lines 51–59) with:

```markdown
### Example: fake Angular app (development)

```bash
node dist/cli.js \
  --repo-root fake-angular-app \
  --base-repo-root fake-angular-app-base \
  src/app/features/users
```
```

- [ ] **Step 3: Fix the real repo CI example**

Replace the current CI example block (lines 61–75) with:

```markdown
### Example: real Angular repo in CI

```bash
# Check out the base branch to a worktree, then run:
node dist/cli.js \
  --repo-root . \
  --base-repo-root /tmp/base \
  src/app/features/my-feature
```
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: fix stale --base-dir flag in README usage examples"
```

---

## Task 2: Fix stale flag references and `applyDiff` description in ARCHITECTURE.md

**Files:**
- Modify: `ARCHITECTURE.md`

- [ ] **Step 1: Fix the `src/cli.ts` key flags list (line 153)**

Replace:
```
Key flags: `--base-dir`, `--base-repo-root`, `--repo-root`, `--out-dir`, `--tsconfig`, positional `<scope-dir>`.
```
With:
```
Key flags: `--base-repo-root`, `--repo-root`, `--out-dir`, `--tsconfig`, `--source-root`, positional `<feature-dir>`.
```

- [ ] **Step 2: Fix the base root derivation description (line 155)**

Replace:
```
Base repo root derivation (when `--base-repo-root` is omitted): counts depth of `scopeDir` relative to `repoRoot`, then walks up the same number of levels from `--base-dir`.
```
With:
```
When `--base-repo-root` is omitted, diff mode is skipped — the CLI runs current-branch-only analysis.
```

- [ ] **Step 3: Fix the `applyDiff` description**

Find the sentence:
```
**`applyDiff`** — legacy function kept for backward compatibility. Will be removed after all callers migrate to `diffGraphs`.
```
Replace with:
```
**`applyDiff`** — legacy function, no production callers. Exported for backward compatibility; safe to remove.
```

- [ ] **Step 4: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: fix stale --base-dir flag and applyDiff language in ARCHITECTURE.md"
```

---

## Task 3: Update types schema in ARCHITECTURE.md

**Files:**
- Modify: `ARCHITECTURE.md`

`ARCHITECTURE.md` is the single source of truth for the graph schema. `CLAUDE.md` will not duplicate it (see Task 4).

- [ ] **Step 1: Update the GraphNode type**

Find the `src/types.ts` section in ARCHITECTURE.md. Replace the `GraphNode` bullet:
```
- `GraphNode` — `{ id, label, file, type: NodeType, scope: NodeScope, diff: DiffState | null }`
```
With:
```
- `GraphNode` — `{ id, label, file, type: NodeType, scope: NodeScope, diff: DiffState | null, typeOnly?: boolean, hasTests?: boolean, hasStories?: boolean }`
```

- [ ] **Step 2: Update the GraphEdge type**

Replace the `GraphEdge` bullet:
```
- `GraphEdge` — `{ from, to, kind: EdgeKind, diff?: DiffState }`
```
With:
```
- `GraphEdge` — `{ from, to, kind: EdgeKind, diff?: DiffState, importedNames?: string[], typeOnly?: boolean }`
```

- [ ] **Step 3: Add GraphMeta explicitly**

After the `Graph` bullet, add a new `GraphMeta` bullet:
```
- `GraphMeta` — `{ scopeDir, repoRoot?: string, generatedAt, nodeCount, edgeCount, diffSha?: string | null }`
```
Note: `scopeDir` is the JSON field name for the feature directory path.

- [ ] **Step 4: Confirm NodeType includes `'stub'`**

Find the `NodeType` bullet — verify `'stub'` is already listed. If not, add it after `'constants'`.

- [ ] **Step 5: Commit**

```bash
git add ARCHITECTURE.md
git commit -m "docs: update types schema in architecture.md to match current types.ts"
```

---

## Task 4: Trim CLAUDE.md to a pointer document

**Files:**
- Modify: `CLAUDE.md`

CLAUDE.md currently duplicates the module table and graph schema from ARCHITECTURE.md. Those sections should be removed and replaced with a pointer to `docs/architecture.md`. The sections worth keeping in CLAUDE.md are things an agent needs at a glance: project goal, setup, usage, fixtures, workflow rule, validation gates.

- [ ] **Step 1: Remove the Architecture section**

Find the `## Architecture` section in CLAUDE.md (the section with the pipeline ASCII diagram and the module responsibilities table). Remove it and replace with:

```markdown
## Architecture

See [docs/architecture.md](./docs/architecture.md) for the full pipeline, module responsibilities, and how to add new view modes or node types.
```

- [ ] **Step 2: Remove the Graph schema section**

Find the `## Graph schema` section in CLAUDE.md (the section with the `GraphNode` / `GraphEdge` definitions). Remove it entirely.

- [ ] **Step 3: Fix the `computeLayout` calls in the remaining architecture snippet**

If any `computeLayout(graph, 'all')` or `computeLayout(graph, 'diff-focused')` references remain after the Architecture section removal, confirm they are gone. (The full docs for that API are in ARCHITECTURE.md.)

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: trim CLAUDE.md to pointer doc; remove sections duplicated in architecture.md"
```

---

## Task 5: Add standard `--help` output and `verify` npm script

**Files:**
- Modify: `src/cli.ts`
- Modify: `package.json`

Two related improvements: (1) upgrade the error/usage message to standard `--help` format, (2) add a `verify` script that combines type-check and tests.

- [ ] **Step 1: Add `printHelp()` and `-h`/`--help` handling in `src/cli.ts`**

Add a `printHelp` function and handle the help flag in `parseArgs`. Replace the current two-line `console.error` block with:

```typescript
function printHelp(): void {
  console.log('Usage: diff-diagram [options] <feature-dir>');
  console.log('');
  console.log('Generate a dependency diagram for an Angular feature directory.');
  console.log('');
  console.log('Arguments:');
  console.log('  feature-dir              Feature directory to diagram (relative to --repo-root)');
  console.log('');
  console.log('Options:');
  console.log('  --repo-root <path>       Repo root for the current branch (auto-detected via .git)');
  console.log('  --base-repo-root <path>  Repo root for a pre-checked-out base branch (enables diff)');
  console.log('  --out-dir <dir>          Output directory (default: dist)');
  console.log('  --tsconfig <file>        Path to tsconfig.json (auto-detected)');
  console.log('  --source-root <dir>      Source root prefix for label derivation (default: src/app)');
  console.log('  -h, --help               Show this help message');
}
```

In `parseArgs`, add handling for `-h` and `--help`:
```typescript
if (argv[i] === '-h' || argv[i] === '--help') { printHelp(); process.exit(0); }
```

Replace the existing usage error block:
```typescript
// before:
console.error('Usage: node dist/cli.js --repo-root <path> ...');
console.error('  <scope-dir>  path relative to --repo-root, ...');
process.exit(1);

// after:
printHelp();
process.exit(1);
```

- [ ] **Step 2: Add `verify` script to `package.json`**

Add to the `"scripts"` object:
```json
"verify": "tsc && vitest run"
```

The full scripts block becomes:
```json
"scripts": {
  "build": "tsc",
  "start": "node dist/cli.js",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:visual": "vitest run --config vitest.visual.config.ts",
  "test:visual:approve": "UPDATE_SNAPSHOTS=1 vitest run --config vitest.visual.config.ts",
  "verify": "tsc && vitest run"
}
```

- [ ] **Step 3: Build and verify**

```bash
npm run build
node dist/cli.js --help
```
Expected: the standard help output prints and exits 0.

```bash
npm run verify
```
Expected: TypeScript compiles with no errors, all unit/integration tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts package.json
git commit -m "feat: add standard --help output and verify npm script"
```

---

## Task 6: Standardize "feature directory" terminology

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `CLAUDE.md`

**Rule:** In all human-facing text (docs, CLI), use "feature directory" as the concept name and `<feature-dir>` as the CLI arg label. Internal code variable `scopeDir` and JSON field `GraphMeta.scopeDir` do NOT change.

- [ ] **Step 1: Update ARCHITECTURE.md — `src/analyzer.ts` section**

The line `scopeDir — absolute path to the feature directory` is already correct. Scan for any remaining "scope directory" (two words) uses in ARCHITECTURE.md and replace with "feature directory".

In the `computeViewNodes` description, find:
```
1. Group in-scope nodes by immediate subdirectory (1 level below `graph.meta.scopeDir`)
```
Replace with:
```
1. Group in-scope nodes by immediate subdirectory (1 level below the feature directory; `graph.meta.scopeDir` is the JSON field name)
```

- [ ] **Step 2: Update ARCHITECTURE.md `src/cli.ts` section**

The positional arg label was updated to `<feature-dir>` in Task 2. Confirm it reads correctly.

- [ ] **Step 3: Scan CLAUDE.md for "scope directory"**

After Task 4 trimmed CLAUDE.md, verify no "scope directory" or `<scope-dir>` remain. Replace any found with "feature directory" / `<feature-dir>`.

- [ ] **Step 4: Commit**

```bash
git add ARCHITECTURE.md CLAUDE.md
git commit -m "docs: standardize 'feature directory' terminology in ARCHITECTURE.md and CLAUDE.md"
```

---

## Task 7: Reorganize docs into docs/ directory

**Files:**
- Move: `ARCHITECTURE.md` → `docs/architecture.md`
- Move: `PLAN.md` → `docs/initial-design.md` (add deprecation header first, no other content changes)
- Delete: `TASKS.md`
- Move: `FUTURE_WORK.md` → `docs/backlog.md`
- Move: `plans/` → `docs/plans/`
- Modify: `README.md` (update internal links)
- Modify: `CLAUDE.md` (update internal links)

- [ ] **Step 1: Add deprecation header to PLAN.md**

Add these lines at the very top of `PLAN.md`:
```markdown
> **Historical document.** This is the original design plan written before implementation began, preserved as a reference. For the current architecture, see [docs/architecture.md](./docs/architecture.md).

---

```

- [ ] **Step 2: Create docs/ and move/delete files**

```bash
mkdir -p /Users/tstapleton/code/tstapleton/diff-diagram/docs/plans
git mv ARCHITECTURE.md docs/architecture.md
git mv PLAN.md docs/initial-design.md
git rm TASKS.md
git mv FUTURE_WORK.md docs/backlog.md
git mv plans/task-02-type-only-imports.md docs/plans/task-02-type-only-imports.md
git mv plans/task-03-visual-regression.md docs/plans/task-03-visual-regression.md
git mv plans/task-04-change-magnitude.md docs/plans/task-04-change-magnitude.md
git mv plans/task-05-subdir-grouping.md docs/plans/task-05-subdir-grouping.md
git mv plans/task-06-filter-stories.md docs/plans/task-06-filter-stories.md
git mv plans/task-09-edge-modified-state.md docs/plans/task-09-edge-modified-state.md
git mv plans/2026-06-04-documentation-alignment.md docs/plans/2026-06-04-documentation-alignment.md
rmdir plans
```

- [ ] **Step 3: Update links in README.md**

Find `See [PLAN.md](./PLAN.md) for the full design` and replace with:
```
See [docs/architecture.md](./docs/architecture.md) for the architecture reference.
```

- [ ] **Step 4: Update links in CLAUDE.md**

Replace any link to `ARCHITECTURE.md` with `docs/architecture.md`.
Replace any link to `PLAN.md` with `docs/initial-design.md`.

- [ ] **Step 5: Verify no broken links remain**

```bash
grep -rn "\](ARCHITECTURE.md\)\|\](PLAN.md\)\|\](TASKS.md\)\|\](FUTURE_WORK.md\)" \
  README.md CLAUDE.md docs/
```
Expected: no matches.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: reorganize root-level markdown files into docs/ directory"
```

---

## Task 8: Rewrite README.md

**Files:**
- Modify: `README.md`

The new README should be clean, accurate, and human-consumable. Below is the full replacement content.

- [ ] **Step 1: Write the new README**

Replace `README.md` entirely with:

```markdown
# diff-diagram

CLI tool for Angular PR review that generates a dependency diagram for a feature directory, showing what changed between branches. Parses TypeScript imports, includes one layer of dependencies outside the feature directory, diffs base vs. current, and renders a component graph.

## What it produces

| File | Purpose |
|---|---|
| `dist/diagram.svg` | Diff-focused graph (paste as image in PR comment) |
| `dist/diagram.html` | Interactive diagram with mode switching and hover highlights |
| `dist/graph.json` | Full diffed graph JSON for downstream tooling |

## Setup

```bash
npm install
```

## Usage

```bash
node dist/cli.js \
  --repo-root <repo-root> \
  --base-repo-root <base-repo-root> \
  <feature-dir>
```

| Arg / Flag | Description | Default |
|---|---|---|
| `<feature-dir>` | Feature directory to diagram, relative to `--repo-root` | required |
| `--repo-root` | Repo root for the current branch | auto-detected via `.git` |
| `--base-repo-root` | Repo root for a pre-checked-out base branch | single-branch mode |
| `--out-dir` | Output directory | `dist` |
| `--tsconfig` | Path to tsconfig.json | auto-detected |
| `--source-root` | Source root prefix (used for label derivation) | `src/app` |

Run `node dist/cli.js --help` for the full usage message.

### Against the fake app fixtures

```bash
node dist/cli.js \
  --repo-root fake-angular-app \
  --base-repo-root fake-angular-app-base \
  src/app/features/users
```

### Against a real repo

Check out the base branch files to a worktree, then run:

```bash
git worktree add /tmp/base $BASE_SHA

node dist/cli.js \
  --repo-root . \
  --base-repo-root /tmp/base \
  src/app/features/my-feature
```

## Development

```bash
npm test                      # unit + integration tests
npm run test:visual           # visual regression tests (pixel-level SVG comparison)
npm run test:visual:approve   # update visual regression snapshots after intentional changes
npm run build                 # compile TypeScript → dist/ (required before running the CLI)
npm run verify                # full check: compile + unit tests
```

Tests are colocated with source files in `src/`.

## Fixture apps

`fake-angular-app/` — "after PR" state  
`fake-angular-app-base/` — "before PR" state

Fixture diff: two files added in `user-settings/`, one removed in `user-list/`, two files with changed imports.

## Architecture

See [docs/architecture.md](./docs/architecture.md) for the full module reference. See [docs/glossary.md](./docs/glossary.md) for term definitions.

```
analyze(base) ──┐
                ├─▶ diffGraphs ──▶ computeViewNodes ──▶ computeLayout ──▶ toSvg / HTML
analyze(current)┘
```

| Module | Responsibility |
|---|---|
| `src/analyzer.ts` | ts-morph: enumerate `.ts` files, extract imports, build Graph |
| `src/filter.ts` | Add one layer of out-of-scope context nodes |
| `src/diff-parser.ts` | `diffGraphs(base, current)`: compare graphs, assign diff states |
| `src/renderer/graph-helpers.ts` | `computeViewNodes(graph, mode)`: collapse unchanged dirs to stubs |
| `src/renderer/layout.ts` | `computeLayout(nodes, edges)`: elkjs wrapper, returns positions |
| `src/renderer/draw.ts` | `toSvg(...)`: pure SVG string from pre-computed layout |
| `src/cli.ts` | Orchestration: args, two-pass analysis, diff, layout, file writes |
| `src/renderer.html` | Browser shell: reads embedded JSON, renders SVG, hover, mode switch |
```

- [ ] **Step 2: Verify the CLI example works**

```bash
npm run build && node dist/cli.js \
  --repo-root fake-angular-app \
  --base-repo-root fake-angular-app-base \
  src/app/features/users
```
Expected: `dist/diagram.svg`, `dist/diagram.html`, `dist/graph.json` written with no errors.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for clarity and accuracy"
```

---

## Task 9: Write docs/glossary.md

**Files:**
- Create: `docs/glossary.md`

- [ ] **Step 1: Write the glossary**

Create `docs/glossary.md` with:

```markdown
# Glossary

Common terms used in diff-diagram docs and code.

---

**feature directory**  
The Angular directory passed to the CLI as `<feature-dir>`. It defines the scope of the diagram — all `.ts` files in this directory and its subdirectories become in-scope nodes. Example: `src/app/features/users`. The internal code variable and `graph.json` field are named `scopeDir` for historical reasons.

**in-scope node**  
A graph node representing a `.ts` file that lives inside the feature directory. `scope: 'in-scope'` in the graph schema.

**out-of-scope (OOS) node**  
A graph node for a file outside the feature directory that is imported by an in-scope file. Added by the one-layer context expansion in `filter.ts`. `scope: 'out-of-scope'`.

**removed ghost**  
A node that existed in the base branch but was deleted in the current branch. Appears in the diagram with a red border and `diff: 'removed'` so reviewers can see what was deleted. `scope: 'removed-ghost'`.

**stub node**  
A synthetic node representing a collapsed directory in Diff-focused view. When all files in a subdirectory are unchanged, they are replaced by a single stub node labeled with the directory name. Stubs have `type: 'stub'` and are not real files. Edges to/from collapsed files are redirected to the stub.

**diff state**  
One of four values indicating how a node or edge changed between base and current branches:
- `added` — present in current, not in base
- `removed` — present in base, not in current
- `modified` — present in both but with changed imports
- `unchanged` — identical in both branches

**base branch / base repo root**  
The state of the repository before the PR changes. The CLI requires a pre-materialized checkout of the base branch (e.g. via `git worktree add`) passed via `--base-repo-root`. The CLI does not manage git state.

**one-layer context**  
The out-of-scope nodes added by `filter.ts`. The analyzer finds all imports that point outside the feature directory (`_oosEdges`). Filter follows each of those edges one level and creates an OOS node for the target file. No further hops are followed.

**diff-focused view**  
A collapsed view mode that reduces the diagram to what matters for a PR review. Subdirectories with no changed files are replaced by stub nodes. Subdirectories with any change (added/modified/removed file) are fully expanded. This is the default view and the layout used for `diagram.svg`.

**all-nodes view**  
A view mode that shows every node individually with no collapsing. Useful for understanding the full architecture but can be dense for large feature directories.

**layout**  
The output of `computeLayout(nodes, edges)` — x/y positions and dimensions for each node, plus bend-point coordinates for each edge. Computed server-side by elkjs and embedded in `diagram.html` as JSON. The browser renderer draws from these pre-computed positions without running elkjs.

**node type**  
Classification of what a `.ts` file is: `component`, `service`, `pipe`, `guard`, `resolver`, `interceptor`, `routing`, `module`, `model`, `constants`, or `stub`. Determined by Angular decorators and filename patterns. Affects border style in the diagram (not color — color is reserved for diff state).

**type-only import**  
An import used only for TypeScript type information (interfaces, type aliases). Detected via `import type { X }` syntax. Rendered with a dashed edge. Not all type imports use this syntax — see `docs/plans/task-02-type-only-imports.md` for context.
```

- [ ] **Step 2: Commit**

```bash
git add docs/glossary.md
git commit -m "docs: add glossary of common terms"
```

---

## Task 10: Add new backlog items to docs/backlog.md

**Files:**
- Modify: `docs/backlog.md` (was `FUTURE_WORK.md`, moved in Task 7)

Three new items to add. Append them at the end of the file.

- [ ] **Step 1: Add the "run without build step" item**

Append to `docs/backlog.md`:

```markdown
---

## Run CLI Without a Build Step

### Request
The current workflow requires `npm run build` (tsc → dist/) before running the CLI. It would be preferable to run TypeScript source directly so developers don't need to remember to rebuild.

### Why deferred
The CLI uses ESM and ts-morph, both of which work fine after a tsc compile. Running TypeScript directly requires either:

**Option A: Node.js type stripping (`--experimental-strip-types`, Node 22+)**  
Node 22 can strip TypeScript type annotations without a type checker. Run with: `node --experimental-strip-types src/cli.ts`. Does not perform type checking — errors only surface at runtime or via a separate `tsc --noEmit`. The `import './foo.js'` extension convention required by our ESM setup may conflict.

**Option B: tsx**  
`tsx` (or `ts-node/esm`) transpiles TypeScript on the fly. Well-tested with ESM. Adds a devDependency and changes the entry point.

### Recommended starting point
Try Option A first (zero new dependencies). If import extension issues arise, evaluate Option B. Keep `npm run build` for CI and the `verify` script for type checking.

---

## Developer Tooling Setup

### Request
Add standard developer tooling to improve code quality and consistency: ESLint, strict TypeScript configuration extending shared defaults, and Prettier.

### Why deferred
The initial focus was on implementing the core pipeline. Tooling setup is mechanical but valuable for maintenance.

### Implementation sketch
1. **Strict TypeScript**: update `tsconfig.json` with `"strict": true` and any shared-config base (e.g. `@tsconfig/strictest`)
2. **ESLint**: add `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`; configure to extend recommended rules; add `lint` npm script
3. **Prettier**: add `prettier`; add `.prettierrc`; add `format` npm script; optionally add a `format:check` script for CI
4. Add `lint` and `format:check` to the `verify` script

---

## Fixture Coverage Review

### Request
Review the code and tests to identify scenarios that should be represented in the fixture apps but currently aren't. Ensure the fixtures provide complete coverage of interesting cases.

### Why deferred
Fixtures were built to cover the primary diff scenarios (added, removed, modified nodes and edges). Edge cases in the fixture data may be missing.

### What to look for
Examples of cases that could be added:
- A file that removes an external (out-of-scope) dependency between base and current
- A file that gains a new out-of-scope dependency
- A file that has a `.spec.ts` sidecar file (tests marker)
- A file that has a `.stories.ts` sidecar file (stories marker)
- A routing module that changed
- A model/interface file that changed
- An in-scope file that both gained and lost imports in the same PR

After identifying gaps, add the corresponding files to `fake-angular-app/` and `fake-angular-app-base/` and update integration tests to assert the new cases.
```

- [ ] **Step 2: Commit**

```bash
git add docs/backlog.md
git commit -m "docs: add backlog items for run-without-build, developer tooling, and fixture coverage"
```

---

## Task 11: Final pass on docs/architecture.md

**Files:**
- Modify: `docs/architecture.md`

After the file has been moved and updated, make a final consistency pass.

- [ ] **Step 1: Add a link to the glossary**

Add after the first paragraph:
```markdown
For term definitions, see [glossary.md](./glossary.md).
```

- [ ] **Step 2: Verify fixture file counts**

```bash
find fake-angular-app/src/app/features/users -name "*.ts" ! -name "*.spec.ts" ! -name "*.stories.ts" | wc -l
find fake-angular-app-base/src/app/features/users -name "*.ts" ! -name "*.spec.ts" ! -name "*.stories.ts" | wc -l
```
Update the fixture counts in the `## Test fixtures` section if they've changed.

- [ ] **Step 3: Confirm all tests pass**

```bash
npm run verify
```
Expected: compile succeeds, all unit/integration tests pass.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: add glossary link and verify fixture counts in architecture.md"
```

---

## Self-Review

**Spec coverage:**
- [x] Drift A: CLI flags fixed in README (Task 1) and ARCHITECTURE (Task 2)
- [x] Drift B: Types schema updated in ARCHITECTURE.md only (Task 3); CLAUDE.md points to it (Task 4)
- [x] Drift C: applyDiff description corrected (Task 2)
- [x] Drift D: "feature directory" standardized in docs + CLI help text (Tasks 5, 6)
- [x] Drift E: docs/ created, files moved, TASKS.md deleted, FUTURE_WORK renamed to backlog (Task 7)
- [x] Drift F: README rewritten with correct description + visual tests section (Task 8)
- [x] Drift G: CLAUDE.md trimmed to pointer doc (Task 4)
- [x] Drift H: Glossary written (Task 9)
- [x] Drift I: `verify` script added (Task 5)
- [x] New backlog items: run without build, developer tooling, fixture coverage (Task 10)

**Gaps:**
- `parseDiffOutput` is also a dead export alongside `applyDiff`. Both are tested but not used in production. Task 2 fixes the `applyDiff` doc comment; `parseDiffOutput` is not separately documented in ARCHITECTURE.md so no doc fix needed there. Both are candidates for removal in a future cleanup.
- `index.html` at the repo root is an orphaned prototype. Not addressed here — separate cleanup decision.

**Placeholder scan:** No TBD/TODO/similar in tasks above.

**Order matters:**
- Tasks 1–6 fix content at current file locations
- Task 7 moves the files (content is correct before move)
- Tasks 8–11 create/update with paths in their final locations
