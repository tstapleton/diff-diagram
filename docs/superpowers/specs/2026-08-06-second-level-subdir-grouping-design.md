# Second-level subdirectory grouping inside scope container

## Problem

The existing subdirectory grouping (`docs/superpowers/specs/2026-07-30-subdir-grouping-design.md`, issue #28) boxes in-scope nodes by their *first-level* subdirectory under the scope dir. A file nested two or more directories deep (e.g. `data-access/store/user.actions.ts`) still groups under only its first-level subdir (`data-access`) — this was an explicit non-goal of that spec ("Deeper hierarchical grouping ... out of scope per the issue").

This spec extends grouping one level deeper: a file's second path segment (e.g. `store`) now gets its own nested box inside its first-level subdir's box, using the same rules the first level already established. Depth is capped at exactly 2 levels — this is a scoped extension of the existing feature, not a move to arbitrary recursive nesting (rejected as a larger, riskier change: `layout.ts`'s edge-LCA routing and container construction are written for a fixed hierarchy depth, and unbounded box-in-box nesting risks visual noise for no asked-for benefit).

## Design

### Grouping key

For each in-scope node, `path.relative(scopeDir, node.file).split(path.sep)` already yields `level1` (today's first-level key: first segment, or `""` if the file is at scope root). This spec adds `level2`: the second segment, meaningful only when `level1 !== ""`; `""` when the file sits directly in the level-1 directory (no second-level box, mirroring the existing "files at this level get no box" rule one level down). A file 3+ directories deep still collapses into its `level2` box — the same deliberate simplification the current code already applies one level up, carried one level down.

### ELK tree

Each level-1 compound node's children become: its direct files (`level2 === ""`) plus one nested compound child per distinct `level2` value present under it. Level-2 container nodes get identical `layoutOptions` (algorithm, spacing, padding, direction) to level-1 containers — same rules, one level deeper.

Container ids become `__subdir__<level1>` (unchanged) and `__subdir__<level1>/<level2>` for the nested case, so that two different level-1 directories which happen to share a child directory name (e.g. two features both containing a `utils/` subfolder) don't collide. The label rendered for a level-2 box is just its own directory name (`"store"`, not `"data-access/store"`), matching the existing level-1 convention of showing only the directory's own name.

### Edge placement (LCA rule)

Extends from 2 branches to 3, same principle as today (an edge is declared on the lowest common ancestor of its endpoints):

1. Both endpoints share `level1` and the same non-empty `level2` → the level-2 container's `edges` array.
2. Both endpoints share `level1` but not case 1 (different `level2`, or one/both have `level2 === ""`) → the level-1 container's `edges` array (today's existing rule).
3. Otherwise (different `level1`, root-level node involved, or out-of-scope node involved) → the root graph's `edges` array (today's existing rule).

### Flattening and rendering — unchanged

`layout.ts`'s `walk()` already recurses generically: it looks up each ELK child's id in the id→label map and, if found, records a container and recurses into that child's own children with an accumulated offset — nothing about it assumes a fixed depth. It requires no changes to support a third tree level.

`Layout.subdirContainers` stays a single flat array of `{x, y, width, height, label}` covering both levels combined — there is no need to distinguish level in the output type, since rendering treats every entry identically (per design decision: level-2 boxes use the same dashed-rect style as level-1, since nesting itself communicates the hierarchy).

Because of this, `src/renderer/draw.ts`, `src/renderer.html`, and `src/cli.ts`'s `ModeData`/`buildModeData` need **no code changes** — they already iterate `layout.subdirContainers` as an undifferentiated list. ELK's structural non-overlap guarantee (the reason Option A was chosen over bounding-box inference in the original spec) extends automatically to the nested case: a level-2 compound node is sized from its own children and treated as one opaque box among its level-1 parent's children, so a level-2 box is guaranteed to sit fully inside its level-1 box with no separate math required.

### Sample fixture change

`sample-app`'s `dashboard` feature already has both shapes needed to demonstrate this feature side by side: `widgets/` is flat (first-level box only, no deeper nesting) and `settings/` has one direct file (`dashboard-settings.component.ts`) plus a nested `settings/preferences/dashboard-notification-prefs.component.ts` (second-level box). The only change needed is adding `settings/preferences/notification-prefs.model.ts`, a small type imported by `dashboard-notification-prefs.component.ts`, so the second-level box shows 2 linked nodes rather than 1 — consistent with how the original spec ensured first-level boxes had genuine multi-node content. Both files are new (present in `sample-app` only), rendering as "added".

`fake-angular-app`'s existing `data-access/store/` (7 files: actions, reducer, selectors, effects, state — genuine cross-file dependencies) already gives real 2-level nesting for the integration test fixtures, no change needed there, same as the original feature's precedent.

## Non-goals

- **Arbitrary recursive depth.** Capped at exactly 2 levels, matching what was asked for.
- **Distinct visual style per nesting level.** Level-2 boxes use identical styling to level-1; nesting position alone communicates hierarchy.
- **Changing `renderer.html`'s and `draw.ts`'s parallel, non-shared implementation structure.** Not touched by this change since no rendering code changes at all.

## Test changes

`src/renderer/layout.test.ts`'s existing case "groups a file nested two levels deep under its first-level subdirectory" currently asserts that a file two directories deep (`sub/nested/deep.ts`) lands in the *same* box as a shallow sibling (`sub/shallow.ts`), with only one container produced. This is exactly the behavior this feature changes, so that test is rewritten to expect two containers: `sub` (containing the shallow file) and a nested `nested` container inside `sub` (containing the deep file).

New cases added to the same file:

- A level-2 container is created and is fully contained within its level-1 container's box.
- A level-1 box containing both a direct file and a nested level-2 sub-box (mixed children).
- An edge between two files in the same level-2 directory routes correctly (edge sections present).
- An edge between a level-2 file and its level-1-direct sibling routes correctly, and the level-2 box doesn't expand to swallow the sibling.
- An edge crossing level-1 directories (each endpoint under a different level-1 dir, at least one nested in level-2) still routes on the root graph.
- A file 3+ directories deep still collapses into its level-2 box rather than getting its own box.
- Container ids/labels stay distinct when two different level-1 directories share a level-2 directory name (e.g. `sub-one/utils` and `sub-two/utils` produce two separate boxes, each correctly scoped to its own parent's files).

No changes are needed to `draw.test.ts`, `renderer.html.test.ts`, or `cli.test.ts`'s subdirectory-grouping tests — they exercise the flat `subdirContainers` array/rendering contract directly with hand-built fixtures, which is unchanged by this feature.

After the sample fixture change, `docs/sample-diff.svg` and `docs/sample-all.svg` are regenerated via `npm run docs:sample:generate`, reviewed visually, and `npm run test:visual:approve` is run to update the pixel-snapshot references (the dashboard sample's layout changes).
