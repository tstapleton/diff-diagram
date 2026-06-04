# diff-diagram

CLI tool for Angular PR review that generates a dependency diagram showing what changed. Parses TypeScript imports, adds one hop of out-of-scope context, diffs base vs. current branch, and renders a component diagram.

## What it does

Given a feature directory (e.g. `src/app/features/users`) on two branches, it:

1. Analyzes both branches with [ts-morph](https://ts-morph.com/) — extracts all imports and Angular decorator imports
2. Adds one hop of out-of-scope context (shared services, components, guards)
3. Diffs the two graphs: new files → **added**, deleted files → **removed-ghost**, changed import sets → **modified**
4. Collapses unchanged subdirectories into stubs (diff-focused mode) so the diagram stays readable
5. Writes `diagram.svg` (diff-focused, for PR comments), `diagram.html` (interactive, all modes), and `graph.json`

### Outputs

| File | Purpose |
|---|---|
| `dist/diagram.svg` | Diff-focused graph with real elkjs layout. Paste as image in PR comment. |
| `dist/diagram.html` | Interactive diagram with mode switching (All nodes / Diff-focused) and hover edge highlighting. Publish to GitHub Pages. |
| `dist/graph.json` | Full diffed graph JSON for downstream tooling. |

## Installation

```bash
npm install
npm run build
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
| `<feature-dir>` | Feature directory to diagram, relative to `--repo-root` (required) | — |
| `--repo-root` | Repo root for the current branch | auto-detected via `.git` |
| `--base-repo-root` | Repo root for a pre-checked-out base branch | no diff mode |
| `--out-dir` | Output directory | `dist` |
| `--tsconfig` | Path to tsconfig.json | auto-detected |
| `--source-root` | Source root prefix for label derivation | `src/app` |

### Example: fake Angular app (development)

```bash
node dist/cli.js \
  --repo-root fake-angular-app \
  --base-repo-root fake-angular-app-base \
  src/app/features/users
```

### Example: real Angular repo in CI

Check out the base branch to a worktree, then run:

```bash
node dist/cli.js \
  --repo-root . \
  --base-repo-root /tmp/base \
  src/app/features/my-feature
```

## Development

```bash
npm test          # run all tests (vitest)
npm run build     # tsc → dist/
```

Tests are colocated with source:

```
src/analyzer.test.ts         # 25 tests
src/filter.test.ts           # 16 tests
src/diff-parser.test.ts      # 40 tests
src/integration.test.ts      # 15 tests (full pipeline against fake apps)
src/renderer/graph-helpers.test.ts  # 15 tests
src/renderer/layout.test.ts         # 9 tests
src/renderer/draw.test.ts           # 22 tests
```

## Fake app fixtures

`fake-angular-app/` is the "after PR" state (58 in-scope .ts files).
`fake-angular-app-base/` is the "before PR" state (57 files).

Differences (what the PR changed):
- **Added**: `user-settings/user-security.component.ts`, `user-settings/user-notification-prefs.component.ts`
- **Removed**: `user-list/user-search-results.component.ts`
- **Modified imports**: `user-settings.component.ts` gains imports to the two new components; `users-list.component.ts` gains a new out-of-scope dep (`AnalyticsService`)

## Architecture

See [PLAN.md](./PLAN.md) for the full design and [CLAUDE.md](./CLAUDE.md) for agent context.

```
analyze(base) ──┐
                ├─▶ diffGraphs ──▶ computeViewNodes ──▶ computeLayout ──▶ toSvg / HTML
analyze(current)┘
```

Pipeline modules:

| Module | Responsibility |
|---|---|
| `src/analyzer.ts` | ts-morph: enumerate .ts files, extract imports + decorator imports, build Graph |
| `src/filter.ts` | Add one hop of out-of-scope context nodes |
| `src/diff-parser.ts` | `diffGraphs(base, current)`: compare node/edge sets, assign diff states |
| `src/renderer/graph-helpers.ts` | `computeViewNodes(graph, mode)`: collapse unchanged dirs to stubs |
| `src/renderer/layout.ts` | `computeLayout(nodes, edges)`: elkjs wrapper, returns positions |
| `src/renderer/draw.ts` | `toSvg(layout, nodes, edges)`: pure SVG string generator |
| `src/cli.ts` | Orchestration: args, two-pass analysis, diff, layout, file writes |
| `src/renderer.html` | Thin browser shell: reads embedded JSON, renders SVG, hover, mode switch |
