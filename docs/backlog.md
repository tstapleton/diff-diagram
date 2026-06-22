# Future Work

Ideas and deferred features with context on why they weren't implemented yet and options for moving forward.

---

## GitHub Action

### Request
Make diff-diagram available as a GitHub Action that runs on pull requests, generates the dependency diff diagram, and posts it as an inline image in a PR comment. Reviewers see the diagram without leaving GitHub.

### Design decisions (resolved)

- **Action type: JavaScript action** — `runs.using: node20`, main entry point at `dist/action.js`. Chosen over composite because the 3-step GitHub image upload API is cleaner in TypeScript than shell `curl`.
- **Image hosting: GitHub's internal asset upload API** — the same endpoint the web UI uses when you drag-drop an image into a comment. Three-step flow: POST to `.../upload/policies/assets` for a presigned URL → PUT the PNG to S3 → POST to confirm. Returns a permanent `https://github.com/user-attachments/assets/{uuid}` URL. Only needs `GITHUB_TOKEN` with write access; no external storage.
- **Comment behavior: find-and-update** — the action tags its comment with `<!-- diff-diagram -->`. On each push it finds the existing comment and edits it; creates a new one only if none exists. One comment per PR, always current.
- **Git management: caller's responsibility** — the action accepts `base-repo-root` as an input and does no git operations itself. The caller's workflow handles checking out the base branch (via `git worktree add`, a second `actions/checkout`, etc.) and passes the path in. Keeps the action simple; the calling team controls checkout strategy.
- **Bundle committed to repo** — `dist/action.js` (esbuild bundle) is committed alongside `dist/cli.js`. Required so GitHub can execute the action immediately on checkout without a build step. A CI check verifies the bundle stays current.
- **Location: `action.yml` at repo root** — consumed as `uses: tstapleton/diff-diagram@main`. Note: the GitHub repo does not exist yet; it must be created and pushed before the action can be used.

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `feature-dir` | yes | — | Feature directory to diagram, relative to `repo-root` |
| `repo-root` | no | `$GITHUB_WORKSPACE` | Repo root for the current branch |
| `base-repo-root` | yes | — | Path to a pre-checked-out base branch |
| `source-root` | no | `src/app` | Source root prefix for label derivation |
| `token` | no | `${{ github.token }}` | GitHub token for API calls |

### Implementation steps

1. Add `esbuild` as a devDependency; add `"build:action": "esbuild src/action.ts --bundle --platform=node --target=node20 --outfile=dist/action.js"` to `package.json`. Update `"build"` to run both `tsc` and `build:action`.
2. Create `src/action.ts` — imports `@actions/core`, `@actions/github`, and the diagram modules directly (analyzer, diff-parser, renderer). Runs the full pipeline in-process (no subprocess), producing an SVG buffer in memory.
3. In `src/action.ts`, rasterize the SVG to PNG using `resvg-js` (already a dependency) — same approach as the visual tests.
4. Implement the 3-step GitHub asset upload:
   ```
   POST /repos/{owner}/{repo}/upload/policies/assets  → { upload_url, form fields }
   PUT  {upload_url}  (multipart, PNG body)            → S3 response
   POST /confirm (asset id from S3 response)           → { url }
   ```
   Use `octokit` from `@actions/github` for the GitHub API calls; plain `fetch` for the S3 PUT.
5. Implement comment find-or-update:
   ```typescript
   const marker = "<!-- diff-diagram -->";
   const body = `${marker}\n![Dependency diagram](${imageUrl})`;
   // list PR comments, find one whose body includes marker → update
   // if none found → create
   ```
6. Add `action.yml` at repo root:
   ```yaml
   name: diff-diagram
   description: Post a dependency diff diagram on a pull request
   inputs:
     feature-dir: { required: true }
     repo-root: { default: "${{ github.workspace }}" }
     base-repo-root: { required: true }
     source-root: { default: src/app }
     token: { default: "${{ github.token }}" }
   runs:
     using: node20
     main: dist/action.js
   ```
7. Commit `dist/action.js`.
8. Add CI check: a job that runs `npm run build:action` and then `git diff --exit-code dist/action.js` — fails if the committed bundle is stale. This prevents `src/action.ts` and `dist/action.js` from drifting.
9. Add an example caller workflow to `docs/action-usage.yml` showing the full setup: checkout current branch, checkout base branch to a temp dir via `git worktree add`, call the action.

### Prerequisites
- GitHub repo must exist (currently local-only; `git push` required before the action can be consumed via `uses:`).
- Caller workflow needs `pull_request` trigger and `contents: write` + `pull-requests: write` permissions for `GITHUB_TOKEN`.

### Notes
- The action runs the full analysis pipeline in-process (no subprocess), so it inherits any performance characteristics of the analyzer on large repos.
- `dist/action.js` will be large if ts-morph is bundled — evaluate whether to externalize it and install at runtime, or accept the bundle size.
- The undocumented GitHub upload API is stable in practice (used by many community actions) but could change without notice.

---

## Sample Diagram (Legend)

### Request
Produce a standalone sample diagram that demonstrates every visual element the tool can render. The sample lives in the repo, is regenerated by an npm script, and is referenced in the README with plain-language explanations of what each color/style means. It serves as both documentation and a regression canary — if styles change, the sample needs to be regenerated and reviewed.

### Design decisions (resolved)

- **Standalone fixture** — a new `sample-app/` + `sample-app-base/` pair, separate from the existing `fake-angular-app` pair. The existing pair is coupled to a specific PR scenario; the sample fixture is purpose-built to cover every visual element.
- **Feature domain: `features/dashboard`** — generic, readable in node labels.
- **Output: `docs/sample.svg`** — GitHub renders SVG in markdown natively; no rasterization step needed.
- **Script: `npm run sample`** — no build step (assumes `dist/` is current). Once the "run without build" backlog item ships, this gets easier.

### Fixture content (what to create)

The base+current pair is designed so that every node diff state and edge diff state appears exactly once:

| File | Base | Current | Diff state |
|------|------|---------|------------|
| `dashboard.component.ts` | ✓ (imports Stats, Nav) | ✓ (imports Stats, Chart, Settings) | modified |
| `dashboard-stats.component.ts` | ✓ | ✓ (same) | unchanged — has test dot + story dot |
| `dashboard-card.component.ts` | ✓ | ✓ (same, type-only import) | unchanged — type-only edge |
| `dashboard-chart.component.ts` | — | ✓ | added |
| `dashboard-settings.component.ts` | — | ✓ | added |
| `dashboard-nav.component.ts` | ✓ | — | removed (ghost) |
| `shared/services/analytics.service.ts` | OOS dep of Stats | OOS dep of Stats | OOS node, unchanged edge |

Edges to show:
- `dashboard → dashboard-stats` unchanged
- `dashboard → dashboard-nav` removed
- `dashboard → dashboard-chart` added
- `dashboard → dashboard-settings` added
- `dashboard-stats → analytics.service` unchanged (OOS)
- `dashboard-card → SomeModel` type-only (OOS)

### Implementation steps

1. Create `sample-app-base/` and `sample-app/` with the fixture files above (`.ts` stubs, no real Angular compilation needed — same pattern as `fake-angular-app`).
2. Add spec sidecar `dashboard-stats.component.spec.ts` and stories sidecar `dashboard-stats.component.stories.ts` to `sample-app/` (and base for unchanged detection).
3. Add `"sample": "node dist/cli.js --repo-root sample-app --base-repo-root sample-app-base src/app/features/dashboard && cp dist/diagram.svg docs/sample.svg"` to `package.json`.
4. Run `npm run sample`, commit `docs/sample.svg`.
5. Add a "Reading the diagram" section to `README.md` with `![Sample diagram](docs/sample.svg)` and a table or bullet list explaining each element:
   - Green border / dark green fill = added in this PR
   - Amber border / dark amber fill = modified in this PR
   - Red border / dark red fill = removed in this PR
   - Grey border / dark fill = unchanged
   - Darker background box = out-of-scope dependency
   - Dashed border = type-only import (no runtime dependency)
   - Dashed line = removed edge
   - Green dot = has unit test; purple dot = has Storybook story
6. Exclude `sample-app/**` and `sample-app-base/**` from `vitest.config.ts` (same as the fake-angular-app dirs).
7. Add `sample-app` and `sample-app-base` to Biome's includes so they get formatted/linted.

### Notes
- The sample should be regenerated whenever rendering styles change (colors, layout, new node types). It is not auto-generated in CI — it is a developer responsibility to keep it current.
- `docs/sample.svg` is committed to the repo so the README renders on GitHub without any build step.

---

## Diff State for Test and Storybook Markers (iteration on item 10)

### Request
The current markers (green dot = has test, purple dot = has story) are static —
they show presence but not change. A reviewer would benefit from knowing whether
a spec or story file was **added**, **modified**, **removed**, or **unchanged**
as part of this PR, just like the component node itself.

### Possible approaches (pick one or combine)

**Option A: Dot color encodes diff state**  
Reuse the existing diff palette on the dots themselves. A newly-added spec file
gets a bright green dot (added); a removed spec gets a red dot; a modified spec
gets amber; unchanged stays the current green. Purple for stories follows the same
pattern. Simple visual extension with no structural change — just pass diff state
through to the dot renderer.

**Option B: Dot shape/style encodes diff state**  
Keep color fixed (green = test, purple = story) but encode diff in shape:
- Added → filled circle
- Modified → circle with ring/halo
- Removed → hollow circle (stroke only)
- Unchanged → small filled circle (current)
This separates the "what kind" signal (color) from the "what happened" signal (shape).

**Option C: Sidecar files as first-class nodes in the graph**  
Treat `.spec.ts` and `.stories.ts` files as proper `GraphNode` entries with their
own diff state, type (`spec` / `story`), and edges back to their component. Show
them as satellite nodes in the layout. Enables full diff treatment but increases
graph density significantly.

**Option D: Track sidecar presence in base vs current in the analyzer**  
The analyzer currently checks existence in the current snapshot only. Pass the
base snapshot's file list into the analyzer (or re-run `existsSync` against the
base repo root) and compute `testsDiff` / `storiesDiff` on each node:
- present in current, absent in base → `added`
- absent in current, present in base → `removed`
- present in both → `unchanged` (content diff would require hashing/reading)
- absent in both → no marker
Requires threading base path into the analyzer or doing a post-diff step.

**Option E: Post-diff computation in `diffGraphs`**  
After `diffGraphs` runs, compare `hasTests`/`hasStories` between base and current
nodes (by file). If a component node existed in both snapshots, compare the sidecar
flags to detect adds/removes. A component that gained a test → `testsDiff: 'added'`.
No changes to analyzer; all diff logic stays in `diff-parser.ts`.

**Option F: Use git diff output (requires git access)**  
Before running the analysis, shell out to `git diff --name-status <base> HEAD` and
parse the output to identify which `.spec.ts` and `.stories.ts` files changed.
Inject the results as metadata into the graph. Works accurately even when file
content is unchanged but the test file was renamed. Requires the CLI to have access
to a real git repo, which CI workflows typically provide.

**Option G: Hash-based content diff for "modified" detection**  
Options A–E can detect presence changes (added/removed) but not content changes
(modified). Reading and hashing both the base and current sidecar files would
distinguish "file exists in both and is identical" (unchanged) from "file exists
in both but content differs" (modified). Adds I/O cost per node.

### Recommended starting point
**Option E** (post-diff in `diffGraphs`) is the lowest-effort path: it leverages
data already computed (`hasTests`/`hasStories` on base and current nodes), requires
no new I/O or git access, and detects the most common case (test file added or
removed alongside a feature change). Combine with **Option A** (dot color) for the
visual encoding. Hash-based "modified" detection (Option G) can layer on later if
that distinction proves useful.

---

## Grouping Out-of-Scope Nodes by Parent Directory

### Request
Instead of showing each out-of-scope (external dependency) node individually with
a path subtitle, group them visually by their parent directory. A shared services
directory with 5 components would become a single collapsed group node rather than
5 individual nodes.

### Current behavior
Each OOS node is shown individually with its label and a path subtitle (e.g.
`shared/services`). This gives the most detail but can create clutter when a
feature imports many things from the same shared directory.

### Why this was deferred (simpler option chosen first)
Individual nodes with path subtitles were implemented as the simpler first option.
They convey precise information without requiring grouping logic. The grouped
option would reduce clutter for large diagrams but requires design decisions about
what constitutes a "group" and how to handle mixed changed/unchanged groups.

### Design for grouped option

**Grouping rule:** Collect OOS nodes that share the same immediate parent directory
(after stripping `sourceRoot`). E.g., `shared/services/analytics.service.ts` and
`shared/services/logging.service.ts` both belong to group `shared/services`.

**Group node rendering:**
- Single rect with the directory path as label
- Fill/stroke reflects the highest-severity diff state among member nodes
  (added > modified > removed > unchanged)
- Dashed border if any member is type-only
- Tooltip or expand-on-click could reveal individual members (future)

**Implementation:**
- In `computeViewNodes` or a new step: collapse OOS nodes by parent dir into
  synthetic group nodes
- Edges from in-scope nodes that targeted any member of a group get redirected
  to the group node
- Group node `id` = canonical parent dir path

---

## Type-Only Import Detection

### Request
Detect nodes that are imported purely for type information (TypeScript types,
interfaces) and style them differently — italic label, lighter fill, dotted border
— to communicate "this dependency vanishes at runtime and does not affect the
production bundle."

### Why deferred
TypeScript supports two syntaxes for type-only imports:

1. **`import type { X } from '...'`** — explicit type-only import (TS 3.8+)
2. **`import { X } from '...'`** — regular import where `X` happens to be a type

The ts-morph API (`ImportDeclaration.isTypeOnly()`) only detects case 1. Most
Angular codebases — including ours — use case 2: types are imported with the same
syntax as values. This means the feature would be a no-op on real code.

Using `verbatimModuleSyntax` in tsconfig would force developers to use `import type`
explicitly, which would make the detection reliable — but changing that tsconfig
option is a separate, potentially disruptive decision.

### Options for moving forward

**Option A: Enable `verbatimModuleSyntax`**  
Add `"verbatimModuleSyntax": true` to tsconfig. This forces all type-only imports
to use `import type { X }` explicitly. TypeScript will error on any value import
used only as a type. Teams would fix errors incrementally. Once the codebase
adopts the convention, `imp.isTypeOnly()` becomes reliable.

**Option B: ts-morph type resolution**  
For each imported name, use ts-morph's type checker to determine if the imported
declaration is purely a type (`isTypeAlias`, `isInterface`, `isEnum` with `const`
modifier) vs a runtime value. This works without changing tsconfig but is
significantly more complex, slower, and has edge cases (classes are both types and
values; enums depend on usage).

**Option C: Defer indefinitely**  
The diagram already shows which dependencies are in-scope vs out-of-scope. Type-only
styling adds nuance, but may not be worth the implementation complexity if the
codebase doesn't adopt `import type` syntax.

**Option D: Only flag `import type` syntax (current implementation)**  
The code is already implemented and committed. It works correctly for files that
use `import type`. Rare in the codebase today, but costs nothing at runtime. Could
be surfaced as a future opt-in once `verbatimModuleSyntax` is discussed.

---

## Change Magnitude Styling

### Request
Show how much a file changed, not just that it changed. Nodes with more lines
changed should be more visually prominent; nodes with fewer changes should appear
more muted — so a reviewer's eye is drawn to the heaviest-changed files first.

### Why deferred
The implemented approach (4 hardcoded fill levels based on absolute line counts)
produced nearly-black nodes for small files, making changed nodes indistinguishable
from unchanged ones. Real Angular components are typically 10–30 lines, so all
changed files landed in the "minor" bucket and looked nearly black regardless of
diff state.

### Ideas for a better approach

**1. Relative buckets instead of absolute thresholds**  
Identify which file has the most changes, then bucket all other files relative to
that maximum. The file with the most changes is the most vivid; everything else
is relative. A file that changed 10 lines when the max is 11 lines still looks
nearly as vivid as the max.

**2. Legend explaining the encoding**  
Add a legend (similar to the edge diff legend) that describes what fill intensity
means. Without a legend, the visual encoding is ambiguous.

**3. Gradient or continuous encoding**  
Instead of 4 discrete buckets, use a continuous color gradient from the "unchanged"
fill to the full diff-state fill color, linearly interpolated by relative change
magnitude. This avoids the bucket-boundary discontinuities and is perceptually
more accurate.

**4. Implementation sketch**
```
1. Compute lineCount per file in analyzer.ts (already done, can be reverted)
2. In diffGraphs: compute linesChanged per node (absolute delta)
3. After diffing, find maxChanged = max(linesChanged) across all changed nodes
4. magnitude(node) = linesChanged / maxChanged  (0.0 – 1.0)
5. fill = lerp(unchangedFill, diffStateFill, magnitude)
6. Add a "change magnitude" row to the legend
```

---

## Subdirectory Grouping Inside Scope Container

### Request
Within the in-scope container box, visually group nodes by their first-level
subdirectory under the scope dir (e.g. `user-list/`, `user-settings/`). Each
group rendered as a subtle background rect with a label. Files at the scope root
get no group box.

### Why deferred
The implementation placed all nodes inside the workspace container (the outer
in-scope bounding box) rather than producing distinct per-subdirectory boxes
inside it. ELK's layout algorithm does not guarantee that nodes from the same
subdirectory are spatially adjacent — it optimizes for minimal edge crossings —
so the per-subdir bounding boxes computed from final node positions all overlapped
or merged into the container bounds.

A correct implementation would require either:
- Telling ELK to place nodes in subdir groups (compound graph layout), or
- Post-processing the layout to physically cluster nodes by subdir before computing bounding boxes

### Options for moving forward

**Option A: ELK compound/hierarchical layout**  
Model each subdirectory as an ELK compound node containing its files. ELK will
guarantee spatial separation between subdirs. Requires significant changes to
`computeLayout` — nodes must be nested, edges must cross compound boundaries,
and the current flat layout model changes substantially.

**Option B: Two-pass layout**  
Run a first ELK pass on subdirs (treating each as a single unit), then a second
pass within each subdir. Positions are composed. More predictable than compound
layout but adds complexity.

**Option C: Force-cluster with ELK partitions**  
Extend the existing partition approach (currently used for in-scope vs oos) to
assign each subdir its own partition number. ELK would place subdir 0 left of
subdir 1, etc. Less flexible than compound layout but simpler. May not produce
readable layouts for large graphs.

**Option D: Label-only grouping (no boxes)**  
Instead of background rectangles, render a small subdir label near each node
(above the node label). No bounding-box computation needed. Lower visual impact
but zero layout coupling.

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
Try Option A first (zero new dependencies). If import extension issues arise, evaluate Option B. Keep `npm run build` for CI and `npm run verify` for type checking.

---

