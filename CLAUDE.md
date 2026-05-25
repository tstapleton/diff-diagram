# diff-diagram

CLI tool that takes an Angular feature directory, parses TypeScript imports, adds one hop of out-of-scope context, overlays a git diff, and renders a component diagram for PR review.

## Setup

```bash
npm install
```

## Usage

```bash
# Open renderer prototype in browser (hand-crafted data)
open src/renderer.html

# Full CLI (fake app with patch overlay)
node src/cli.js \
  --patch fake-angular-app/fake-complex.patch \
  --repo-root fake-angular-app \
  --out-dir dist \
  fake-angular-app/src/app/features/users

# Full CLI (real Angular repo — auto-detects .git root)
node src/cli.js \
  --patch path/to/changes.patch \
  --out-dir dist \
  path/to/src/app/features/my-feature
```

## Count nodes in any Angular feature directory

```bash
find <scope-dir> -name "*.ts" ! -name "*.spec.ts" | wc -l
```

## Fake app

`fake-angular-app/` is a hand-crafted Angular app used for development and testing.
Files are organized by domain (not type): `user-list/`, `user-detail/`, `user-edit/`, etc.
No barrel files. No `.spec.ts` files.

```
fake-angular-app/src/app/features/users/   ← scope directory (59 .ts files)
fake-angular-app/src/app/shared/           ← 1-hop context targets (18 .ts files)
fake-angular-app/fake-simple.patch         ← 3-change diff for basic testing
fake-angular-app/fake-complex.patch        ← 10-change diff covering all scenarios
```

Note: `--repo-root fake-angular-app` is needed for the fake app because the fake app has no `.git` of its own — patch paths are relative to `fake-angular-app/`, not to the outer `diff-diagram/` repo root. Real Angular projects auto-detect via `.git`.

## Architecture

| Phase | File | Status |
|---|---|---|
| 0 | package.json, .npmrc | done |
| 1 | fake-angular-app/ | done |
| 2 | src/renderer.html | done |
| 3 | src/analyzer.js + src/filter.js | done |
| 4 | src/diff-parser.js | done |
| 5 | src/cli.js | done |

## Graph schema

All modules share a JSON contract (documented in `src/graph.schema.js` when built):

```
nodes[]: { id, label, file, type, scope, diff }
  type:  component | service | pipe | guard | resolver | routing | model | constants
  scope: in-scope | out-of-scope | removed-ghost
  diff:  added | modified | removed | unchanged | null

edges[]: { from, to, kind, diff? }
  kind:  import
  diff:  added | removed | unchanged (optional; derived from node diff if absent)
```

## Validation gates

Each phase has a gate. **If a gate fails, change approach — do not skip.**

- Gate 1: open `src/renderer.html` in browser — layout readable at full node count
- Gate 2: `node src/analyzer.js fake-angular-app/src/app/features/users` — node count matches `find`, edges correct
- Gate 3: merge `fake-complex.patch` into graph — all 8 diff scenarios render correctly
- Gate 4: run CLI end-to-end — `dist/diagram.html` opens, `dist/diagram.svg` embeds in Markdown
