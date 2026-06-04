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

`--repo-root` is the working-tree repo root; `<feature-dir>` is a path relative to it.
`--base-repo-root` points to a materialized base-branch checkout (e.g., via `git worktree add`).
The CLI does not manage git state.

Optional flags: `--out-dir <dir>` (default `dist`), `--tsconfig <file>`, `--source-root <dir>` (default `src/app`).

## Count nodes in any Angular feature directory

```bash
find <feature-dir> -name "*.ts" ! -name "*.spec.ts" | wc -l
```

## Fake app fixtures

Two fixture directories represent a before/after PR state:

- `fake-angular-app-base/` — base branch state (before the PR)
- `fake-angular-app/` — current branch state (after the PR)

Both are domain-organized (not type-organized): `user-list/`, `user-detail/`, `user-edit/`, etc. No barrel files. No `.spec.ts` files.

Integration tests run the full CLI pipeline with `--base-repo-root fake-angular-app-base` and verify node and edge diff output.

## Architecture

See [docs/architecture.md](./docs/architecture.md) for the full pipeline, module responsibilities, graph schema, and how to add new view modes or node types.

## Development workflow

- Each commit must complete exactly one task and mark it done in the same commit.
- Before asking the user to review output, read through the relevant code and check for obvious bugs.
- Do not add features, refactoring, or cleanup beyond what the current task requires.

## Validation gates

**If a gate fails, change approach — do not skip.**

- Gate 1: `npm test` — all tests pass
- Gate 2: `node dist/cli.js --repo-root fake-angular-app --base-repo-root fake-angular-app-base src/app/features/users` — node count correct, edge diff states correct, no node_modules nodes, labels correct (PascalCase)
- Gate 3: open `dist/diagram.html` in browser — both view modes render, hover highlights edges, diff colors correct
- Gate 4: inspect `dist/diagram.svg` — real graph layout with edges, not a list of boxes
