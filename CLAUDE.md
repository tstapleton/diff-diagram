# diff-diagram

CLI tool that takes an Angular feature directory, runs TypeScript import analysis on both a base branch and the current branch, computes an edge-level diff, and renders a dependency diagram for PR review.

## Key documents

- `docs/spec.md` — product spec (what the tool does and why)
- `docs/architecture.md` — module reference, pipeline, types, graph schema
- `docs/glossary.md` — term definitions

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
| `npm run verify` | Full check: build + lint + unit tests + visual tests + sample drift check (runs on pre-commit) |
| `npm run docs:sample:check-drift` | Regenerate `docs/sample-diff.svg` and `docs/sample-all.svg` to a scratch dir and fail if either differs from the committed files |
| `npm run lint` | Lint with Biome |
| `npm run format` | Format with Biome |

## Running the CLI

```bash
# Against integration app fixtures
node dist/cli.js \
  --repo-root fixtures/integration-app \
  --base-repo-root fixtures/integration-app-base \
  src/app/features/users

# Against a real repo
node dist/cli.js \
  --repo-root /path/to/repo \
  --base-repo-root /tmp/base-checkout \
  src/app/features/my-feature
```

Optional flags: `--out-dir <dir>` (default `dist`), `--source-root <dir>` (default `src/app`).

## Integration app fixtures

Two fixture directories under `fixtures/` represent a before/after PR state:

- `fixtures/integration-app-base/` — base branch state (before the PR)
- `fixtures/integration-app/` — current branch state (after the PR)

Both are domain-organized (not type-organized): `user-list/`, `user-detail/`, `user-edit/`, etc. No barrel files inside the feature directory (the current branch adds one out-of-scope barrel at `shared/services/index.ts`). Fixture diff: three files added in `user-settings/` (two components at ~33–40 lines, plus a 5-line model — sized apart to demonstrate the change-magnitude gradient on added nodes), one removed in `user-list/`, four files modified (three small edits plus one substantially larger rewrite in `user-list/users-list.component.ts`, wiring up previously-unused sort/selection utilities — demonstrating the gradient on modified nodes), one of the small modifications has changed content only (imports unchanged, proves node diff is content-based), plus a Storybook story added in `user-list/`.

Integration tests run the full CLI pipeline with `--base-repo-root fixtures/integration-app-base` and verify node and edge diff output.

## Development workflow

- Never commit directly to `main`. All work happens on a feature branch and lands via pull request.
- One PR per task, one commit per PR, one logical change per commit. Never batch multiple tasks into a single PR — split them into separate branches, each with its own PR. (Enforced by `.claude/hooks/block-multi-commit-pr.sh`, wired up as a PreToolUse hook in `.claude/settings.json`, which blocks `gh pr create` on branches more than one commit ahead of the base.)
- Do not add features, refactoring, or cleanup beyond what the current task requires.
- Read through relevant code and check for obvious bugs before asking the user to review output.
- Worktrees are managed by the user via `worktrunk`, not by Claude — a session should already be started inside the correct worktree. Don't create a worktree for normal work.
- **Before writing any code, confirm you're in an isolated worktree, not the canonical repo checkout.** This repo routinely has many worktrees checked out at once alongside direct work in the canonical checkout — if two sessions (or a subagent that loses track of its working directory) edit the canonical checkout's working tree or its currently-checked-out branch, their writes and commits interleave with no error, silently corrupting or misattributing both sessions' work. Verify with `git rev-parse --show-toplevel` (should be a worktree path, not the repo root) or `[ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ]`. If not isolated, stop and flag it to the user rather than creating a worktree yourself as a fix — worktree placement is their responsibility now. It's still fine to spin up a short-lived, throwaway worktree for your own internal use (e.g. giving a subagent an isolated scratch copy); just don't treat that as the general remediation for "not isolated."

## Always / Never

**Always:**
- Run `npm run verify` before asking the user to review output.
- Build (`npm run build`) before running the CLI.
- When a change intentionally alters rendering: visually review the output, run `npm run test:visual:approve`, re-run `npm run verify`, and call out the regenerated snapshots prominently in the PR body — the new reference images get reviewed as part of the PR.

**Never:**
- Commit or push directly to `main` — all changes land through pull requests (enforced by a branch ruleset).
- Run `npm run test:visual:approve` to silence a visual test failure you can't explain — approval is only for intentional rendering changes; an unexpected failure is a bug to investigate.
- Use `--no-verify` to bypass the pre-commit hook.
- Open a PR containing more than one commit.
- Add features, refactoring, or abstractions beyond what the current task requires.

## Validation gates

**If a gate fails, change approach — do not skip.**

- Gate 1: `npm run verify` — build, lint, unit tests, visual tests, and the sample drift check all pass
- Gate 2: `node dist/cli.js --repo-root fixtures/integration-app --base-repo-root fixtures/integration-app-base src/app/features/users` — runs without error, produces `dist/diagram-diff.svg`, `dist/diagram-all.svg`, and `dist/diagram.html`
- Gate 3 (visual, user): open `dist/diagram.html` — both view modes render, hover highlights edges, diff colors correct
- Gate 4 (visual, user): open `dist/diagram-diff.svg` — real graph layout with edges, not a list of boxes
