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
| `--repo-root` | Repo root for the current branch | current working directory |
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
npm run verify                # full check: build + lint + unit tests + visual tests (runs on pre-commit)
```

Tests are colocated with source files in `src/`.

## Fixture apps

`fake-angular-app/` — "after PR" state  
`fake-angular-app-base/` — "before PR" state

Fixture diff: two files added in `user-settings/`, one removed in `user-list/`, three files with changed imports, plus a Storybook story and an out-of-scope `shared/services` barrel added in the current branch.

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
