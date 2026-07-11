# diff-diagram: Product Spec

## Purpose

diff-diagram generates a visual dependency diagram for an Angular feature directory, showing how files relate to each other and what changed in a pull request.

Code reviews are easier when reviewers can see structure, not just lines. A diff shows *what* changed; a dependency diagram shows *where that change sits in the architecture*. When a PR adds a new service import, the diagram makes it immediately visible whether that import introduces a new dependency, widens an existing one, or couples two previously independent areas. This helps reviewers catch unintended coupling, notice architectural drift, and understand the blast radius of a change without reading every file.

The tool runs once per PR, against a specific feature directory, producing outputs that can be shared directly in the review.

## Outputs

| File | Purpose |
|---|---|
| `<out-dir>/diagram.svg` | Static diff-focused diagram — paste as an image into a PR comment |
| `<out-dir>/diagram.html` | Interactive diagram — mode switching, hover highlighting |
| `<out-dir>/graph.json` | Full diffed graph in JSON — for debugging or downstream tooling |

`diagram.svg` uses the diff-focused view (changed areas expanded, unchanged areas collapsed). It is intended to be the primary review artifact.

`diagram.html` embeds pre-computed layouts for all view modes. No server required — open the file directly in a browser.

## Inputs

| Flag / Arg | Required | Default | Description |
|---|---|---|---|
| `<feature-dir>` | yes | — | Feature directory to diagram, relative to `--repo-root` |
| `--repo-root` | no | current working directory | Repo root for the current branch |
| `--base-repo-root` | no | — | Repo root for a pre-checked-out base branch; omit for single-branch mode |
| `--out-dir` | no | `dist` | Where to write output files |
| `--tsconfig` | no | auto-detected | Path to `tsconfig.json` for import resolution |
| `--source-root` | no | `src/app` | Prefix stripped from file paths when deriving node labels |

The tool does not manage git state. The caller is responsible for materializing the base branch (e.g., via `git worktree add`) and passing the path via `--base-repo-root`.

When `--base-repo-root` is omitted, diff mode is skipped and the diagram shows only the current branch state with no diff coloring.

## Core Behaviors

### Node coverage

Every `.ts` file in the feature directory becomes a node, except:
- `.spec.ts` files (test sidecars)
- `.stories.ts` files (Storybook sidecars)
- `.d.ts` files (type declarations)
- Files under `node_modules/`

Spec and stories sidecars are excluded from the graph but their *presence* is noted on their associated node — a green dot for a test sidecar, a purple dot for a stories sidecar.

Node labels are derived from filenames: `user-list.component.ts` → `UserListComponent`. See [architecture.md](./architecture.md) for the full derivation rules.

### Diff semantics

The tool runs the analyzer twice — once on the base branch, once on the current branch — then diffs the resulting graphs.

**Node diff states:**
- `added` — file exists in current branch, not in base
- `removed` — file exists in base, not in current; shown as a ghost node
- `modified` — file exists in both branches but its outgoing import set changed
- `unchanged` — file exists in both branches with the same import set

**Edge diff states:**
- `added` — import exists in current, not in base
- `removed` — import exists in base, not in current; rendered as a dashed line
- `modified` — import exists in both, but its set of imported names changed
- `unchanged` — import exists in both with the same imported names

Modification is detected at the import level, not at the file content level: a node is `modified` when any outgoing import was added or removed, or when the set of names imported over a persisting edge changed. A file that changed internally but whose imports did not change is `unchanged` in the diagram. See [architecture.md](./architecture.md) for the full diff algorithm.

### Out-of-scope context

Files outside the feature directory that are imported by in-scope files appear as out-of-scope context nodes. These give reviewers visibility into what the feature depends on externally.

Rules:
- Only one hop: if an out-of-scope file imports other files, those do not appear
- npm and framework packages (`@angular/`, `rxjs`, etc.) are excluded — only files on disk appear
- Out-of-scope nodes carry the same diff states as in-scope nodes (added, removed, modified, unchanged)
- Out-of-scope nodes removed from the current branch are dropped silently (no ghost)

### View modes

Two view modes are available in `diagram.html`. `diagram.svg` always uses the diff-focused mode.

**All nodes** — every node is shown individually. Useful for seeing the full architecture of a feature without any collapsing.

**Diff-focused** — the default and primary view. Changed areas are expanded; unchanged areas are collapsed to stub nodes (directory-level placeholders).

Collapse rules for diff-focused:
- In-scope: group nodes by their first-level subdirectory under the feature directory. If all nodes in a group are `unchanged`, collapse the group to a single stub. If any node is `added`, `modified`, or `removed`, expand all nodes in that group individually.
- Out-of-scope: group nodes by their immediate parent directory. Same collapse rule.
- Nodes at the feature directory root (not inside any subdirectory) are always shown individually.
- Edges targeting collapsed nodes are redirected to the stub. Duplicate edges and self-loops after collapsing are dropped.

### Visual encoding

**Node fill and stroke color** encodes diff state:
- `added` — green
- `modified` — amber
- `removed` — red
- `unchanged` — dark slate

Out-of-scope nodes use a distinct dark background and blue stroke regardless of diff state.

Stub nodes (collapsed directories) use a dashed border and a neutral fill.

**Edge stroke** uses the same color palette as nodes, keyed to the edge's own diff state (`modified` edges are amber). Removed edges are dashed and partially transparent.

**Sidecar markers** appear as small dots in the node corner:
- Green dot — a `.spec.ts` sidecar exists for this file
- Purple dot — a `.stories.ts` sidecar exists for this file

## Non-goals

- **Git management** — the tool never checks out branches, creates worktrees, or reads git history. Callers handle git state.
- **Rename tracking** — a renamed file is treated as removed + added. No git-based rename detection.
- **CI integration** — posting comments, uploading images, and publishing to GitHub Pages are out of scope for this repo.
- **Full repo diagrams** — the tool scopes to a single feature directory. Whole-repo analysis is not a goal.
- **File content diff** — modification is detected by import-set change, not line-level content diff. Internal-only changes (refactors that don't add or remove imports) appear as `unchanged`.
- **Runtime dependency analysis** — the diagram shows static TypeScript imports only. Dynamic imports, lazy-loaded modules, and Angular DI injection chains are not traced.

## Planned

The following features are designed but not yet implemented. Full design decisions and implementation steps are in [docs/backlog.md](./backlog.md).

- **GitHub Action** — runs on PR events, posts `diagram.svg` as an inline PR comment image, no external storage required
- **Sample diagram** — a purpose-built fixture demonstrating every visual element (all diff states, all node types, sidecar markers), committed to the repo and referenced in the README
- **Clustered view mode** — a third view that collapses every directory to a single box regardless of diff state, for high-level orientation in large features
- **Sidecar diff state** — encode whether a test or story file was added, removed, or unchanged as part of this PR, reflected on the sidecar dot
- **Out-of-scope grouping** — collapse OOS nodes by parent directory into a single group node, reducing clutter when a feature imports many things from the same shared area
- **Change magnitude styling** — visually encode how much a file changed, so a reviewer's eye is drawn to the most heavily modified files first
- **Type-only import detection** — style edges differently when an import is type-only (no runtime dependency), pending adoption of `verbatimModuleSyntax` in the target codebase
- **Subdirectory grouping** — visually group in-scope nodes by their first-level subdirectory using background rects, requiring compound/hierarchical ELK layout
