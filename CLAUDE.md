# diff-diagram

CLI tool that takes an Angular feature directory, runs TypeScript import analysis on both a base branch and the current branch, computes an edge-level diff, and renders a dependency diagram for PR review.

## Key documents

- `docs/spec.md` — product spec (what the tool does and why)
- `docs/architecture.md` — module reference, pipeline, types, graph schema
- `docs/glossary.md` — term definitions
- `docs/backlog.md` — deferred features with design decisions

## Setup

```bash
npm install
npm run build   # compiles TypeScript → dist/
```

## Commands

| Command | Purpose |
|---|---|
| `npm run build` | Compile TypeScript → `dist/` |
| `npm test` | Unit + integration tests |
| `npm run test:visual` | Visual regression tests (pixel-level SVG comparison) |
| `npm run test:visual:approve` | Update visual snapshots after intentional rendering changes |
| `npm run verify` | Full check: build + lint + unit tests + visual tests (runs on pre-commit) |
| `npm run lint` | Lint with Biome |
| `npm run format` | Format with Biome |

## Running the CLI

```bash
# Against fake app fixtures
node dist/cli.js \
  --repo-root fake-angular-app \
  --base-repo-root fake-angular-app-base \
  src/app/features/users

# Against a real repo
node dist/cli.js \
  --repo-root /path/to/repo \
  --base-repo-root /tmp/base-checkout \
  src/app/features/my-feature
```

Optional flags: `--out-dir <dir>` (default `dist`), `--tsconfig <file>`, `--source-root <dir>` (default `src/app`).

## Fake app fixtures

Two fixture directories represent a before/after PR state:

- `fake-angular-app-base/` — base branch state (before the PR)
- `fake-angular-app/` — current branch state (after the PR)

Both are domain-organized (not type-organized): `user-list/`, `user-detail/`, `user-edit/`, etc. No barrel files. Fixture diff: two files added in `user-settings/`, one removed in `user-list/`, two files with changed imports.

Integration tests run the full CLI pipeline with `--base-repo-root fake-angular-app-base` and verify node and edge diff output.

## Development workflow

- Never commit directly to `main`. All work happens on a feature branch and lands via pull request, with one independent commit per task.
- Each commit must complete exactly one task.
- Do not add features, refactoring, or cleanup beyond what the current task requires.
- Read through relevant code and check for obvious bugs before asking the user to review output.

## Always / Ask first / Never

**Always:**
- Run `npm run verify` before asking the user to review output.
- Build (`npm run build`) before running the CLI.

**Ask first:**
- Adding or changing items in `docs/backlog.md`.

**Never:**
- Commit or push directly to `main` — all changes land through pull requests (enforced by a branch ruleset).
- Run `npm run test:visual:approve` without explicit user instruction — snapshot approval is a user decision.
- Use `--no-verify` to bypass the pre-commit hook.
- Add features, refactoring, or abstractions beyond what the current task requires.

## Validation gates

**If a gate fails, change approach — do not skip.**

- Gate 1: `npm run verify` — build, lint, unit tests, and visual tests all pass
- Gate 2: `node dist/cli.js --repo-root fake-angular-app --base-repo-root fake-angular-app-base src/app/features/users` — runs without error, produces `dist/diagram.svg` and `dist/diagram.html`
- Gate 3 (visual, user): open `dist/diagram.html` — both view modes render, hover highlights edges, diff colors correct
- Gate 4 (visual, user): open `dist/diagram.svg` — real graph layout with edges, not a list of boxes
