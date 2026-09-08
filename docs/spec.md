# diff-diagram: Product Spec

## Purpose

diff-diagram generates a visual dependency diagram for an Angular feature directory, showing how files relate to each other and what changed in a pull request.

Code reviews are easier when reviewers can see structure, not just lines. A diff shows *what* changed; a dependency diagram shows *where that change sits in the architecture*. When a PR adds a new service import, the diagram makes it immediately visible whether that import introduces a new dependency, widens an existing one, or couples two previously independent areas. This helps reviewers catch unintended coupling, notice architectural drift, and understand the blast radius of a change without reading every file.

The tool runs once per PR, against a specific feature directory, producing outputs that can be shared directly in the review.

## Outputs

| File | Purpose |
|---|---|
| `<out-dir>/diagram-focused.svg` | Static focused diagram — paste as an image into a PR comment. Only written when `--base-repo-root` is given. |
| `<out-dir>/diagram-expanded.svg` | Static expanded diagram — same diff coloring, no collapsing |
| `<out-dir>/diagram-collapsed.svg` | Static collapsed diagram — one box per subdirectory, colored by dominant diff state. Always written. |
| `<out-dir>/diagram.html` | Interactive diagram — mode switching, hover highlighting |
| `<out-dir>/graph.json` | Full diffed graph in JSON — for debugging or downstream tooling |

`diagram-focused.svg` uses the focused view (changed areas expanded, unchanged areas collapsed). It is intended to be the primary review artifact. `diagram-expanded.svg` uses the expanded view with the same diff coloring. `diagram-collapsed.svg` uses the collapsed view, zoomed all the way out to one box per subdirectory — written regardless of whether a base branch was given, since dominant-diff-state coloring per directory is still meaningful (all "unchanged") in single-branch mode.

`diagram.html` embeds pre-computed layouts for all view modes. No server required — open the file directly in a browser.

## Inputs

| Flag / Arg | Required | Default | Description |
|---|---|---|---|
| `<feature-dir>` | yes | — | Feature directory to diagram, relative to `--repo-root` |
| `--repo-root` | no | current working directory | Repo root for the current branch |
| `--base-repo-root` | no | — | Repo root for a pre-checked-out base branch; omit for single-branch mode |
| `--out-dir` | no | `dist` | Where to write output files |
| `--source-root` | no | `src/app` | Prefix stripped from file paths when deriving node labels |

The tool does not manage git state. The caller is responsible for materializing the base branch (e.g., via `git worktree add`) and passing the path via `--base-repo-root`.

When `--base-repo-root` is omitted, diff mode is skipped and the diagram shows only the current branch state with no diff coloring. In this mode `diagram-focused.svg` is not written; `diagram-expanded.svg` and `diagram.html` default to the expanded view, since without a diff the focused view would collapse everything into stubs.

## Core Behaviors

### Node coverage

Every `.ts` file in the feature directory becomes a node, except:
- `.spec.ts` files (test sidecars)
- `.stories.ts` files (Storybook sidecars)
- `.d.ts` files (type declarations)
- Files under `node_modules/`

Spec and stories sidecars are excluded from the graph but their *presence* is noted on their associated node — a cyan dot for a test sidecar, a purple dot for a stories sidecar.

Node labels are derived from filenames: `user-list.component.ts` → `UserListComponent`. See [architecture.md](./architecture.md) for the full derivation rules.

### Diff semantics

The tool runs the analyzer twice — once on the base branch, once on the current branch — then diffs the resulting graphs.

**Node diff states:**
- `added` — file exists in current branch, not in base
- `removed` — file exists in base, not in current; shown as a ghost node
- `modified` — file exists in both branches but its own content differs
- `unchanged` — file exists in both branches with identical content

**Edge diff states:**
- `added` — import exists in current, not in base
- `removed` — import exists in base, not in current
- `modified` — import exists in both, but its set of imported names changed
- `unchanged` — import exists in both with the same imported names

Node modification is detected at the file-content level: a node is `modified` when its own raw text differs between base and current branches, regardless of whether its imports changed. Edge modification is still detected at the import level (see edge diff states above) — node color and edge color are independent signals. See [architecture.md](./architecture.md) for the full diff algorithm.

### Out-of-scope context

Files outside the feature directory that are imported by in-scope files appear as out-of-scope context nodes. These give reviewers visibility into what the feature depends on externally.

Rules:
- Only one hop: if an out-of-scope file imports other files, those do not appear
- npm and framework packages (`@angular/`, `rxjs`, etc.) are excluded — only files on disk appear
- Out-of-scope nodes carry the same diff states as in-scope nodes (added, removed, modified, unchanged)
- Out-of-scope nodes removed from the current branch are dropped silently (no ghost)

### View modes

Three view modes are available in `diagram.html`. `diagram-focused.svg` always uses the focused mode; `diagram-expanded.svg` always uses the expanded mode; `diagram-collapsed.svg` always uses the collapsed mode and is always written regardless of whether a base to diff against was given, since dominant-diff-state coloring per directory is still meaningful (all "unchanged") in single-branch mode.

**Expanded** — every node is shown individually. Useful for seeing the full architecture of a feature without any collapsing.

**Focused** — the default and primary view. Changed areas are expanded; unchanged areas are collapsed to stub nodes (directory-level placeholders).

**Collapsed** — a third mode for orientation on large features: every subdirectory (up to 2 levels deep) collapses to one box regardless of diff state, colored by the most significant change inside it. Independent of focused's stub-collapsing rules below — a directory renders as a box here even if focused would show it fully expanded or collapse it to a stub.

Collapse rules for focused:
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

For `added`, `modified`, and `removed` nodes, fill intensity additionally scales with **change magnitude** — how much of the file changed (a real line-level diff for `modified` nodes, the file's own length for `added`/`removed`), relative to the 80th percentile of change size among changed nodes in the diagram (not the single largest node — a lone outlier file was found to crush every other node's magnitude toward zero in real PRs). Nodes at or above that percentile render at full diff-state color; more lightly changed nodes fade toward the unchanged fill. Border color always stays at full diff-state intensity regardless of magnitude, so a node's diff state is never ambiguous even when barely changed. A collapsed directory node (Collapsed view) gets the same magnitude fill too, taken from the heaviest change among its members.

Out-of-scope nodes use a distinct dark background and blue stroke regardless of diff state, and do not participate in change-magnitude styling.

Stub nodes (collapsed directories in Focused view) use a solid border and a neutral fill, the same treatment every directory-related box (subdirectory group, stub, whole-feature boundary) shares.

**Edge stroke** uses the same color palette as nodes, keyed to the edge's own diff state (`modified` edges are amber). Every line in the diagram — node border, edge, directory box — is solid; diff state is color alone, with no dash or opacity variation anywhere.

**Sidecar markers** appear as small dots in the node corner:
- Cyan dot — a `.spec.ts` sidecar exists for this file
- Purple dot — a `.stories.ts` sidecar exists for this file

See `docs/visual-encoding-reference.md` for the exact color values and every other typography/width decision, kept current with the code.

## GitHub Action

`action.yml` packages the CLI as a composite GitHub Action (`tstapleton/diff-diagram@main`) for a consuming repo's own PR workflow. Given `feature-dir` and a pre-checked-out `base-repo-root` (the consuming workflow's responsibility, same contract as the CLI's own `--base-repo-root`), it:
1. Builds and runs the CLI to produce `diagram.html`.
2. Uploads it as a workflow artifact (unarchived, so it opens directly in the browser).
3. Posts or updates one PR comment per scope directory (matched by an HTML marker comment, so re-runs edit in place rather than piling up) summarizing added/modified/removed file and import counts, with a link to the artifact.

See `docs/action-usage.yml` for an example consuming workflow.

## Non-goals

- **Git management** — the tool never checks out branches, creates worktrees, or reads git history. Callers (and, for the composite action, its consuming workflow) handle git state.
- **Rename tracking** — a renamed file is treated as removed + added. No git-based rename detection.
- **CI platforms beyond GitHub Actions** — the bundled composite action (see above) targets GitHub Actions specifically; publishing to GitHub Pages or supporting other CI platforms is out of scope.
- **Full repo diagrams** — the tool scopes to a single feature directory. Whole-repo analysis is not a goal.
- **Runtime dependency analysis** — the diagram shows static TypeScript imports only. Dynamic imports, lazy-loaded modules, and Angular DI injection chains are not traced.

## Planned

The following features are designed but not yet implemented. Full design decisions and implementation steps are tracked as GitHub issues.

- **Sidecar diff state** — encode whether a test or story file was added, removed, or unchanged as part of this PR, reflected on the sidecar dot
- **Out-of-scope grouping for mixed directories, in Focused/Expanded view** — Focused view already collapses an out-of-scope parent directory to a stub when every member is unchanged (same rule as in-scope subdirectories — see Collapse rules above), and Collapsed view already groups every out-of-scope directory unconditionally. What's still missing is the case in between: a *mixed* changed/unchanged out-of-scope directory in Focused or Expanded view still shows every member individually rather than collapsing to one group node colored by dominant diff state. See issue #25.
