# Change magnitude styling, take two

## Problem

Issue #27 asks for changed nodes to visually convey *how much* changed, not just that they changed — so a reviewer's eye goes to the heaviest-hit files first. PR #40 implemented this once already (`e5851550`), but:

1. It predates PR #46 (content-based node diff state). It measured "how much changed" for a `modified` node as `|current.lineCount − base.lineCount|` — the *net* line-count delta. Under the old edge-based `modified` semantics that was defensible; under the new content-based semantics it's wrong. A file that's heavily rewritten but ends up the same length now correctly registers as `modified` (content-based), yet the old metric would score it `linesChanged = 0` and render it fully muted — silently contradicting its own amber border.
2. Reviewing the rendered output, the gradient was hard to notice — small real-world files (Angular components here run 10–30 lines) landed close together in intensity.
3. The fixtures don't currently have enough magnitude spread to demonstrate or validate a gradient — all four `modified` files today are 1–10 line diffs.

PR #40 / branch `issue-27-change-magnitude` is now stale and conflicting with `main` (it landed before #45/#46). It will be closed in favor of a fresh branch.

## Design

### Metric: real line-level diff, not a line-count delta

`GraphNode._content` (added by #46, the file's raw text at each snapshot) already gives `diffGraphs` everything it needs — no analyzer changes required.

- **`modified`**: run the `diff` package's `diffLines(baseNode._content, node._content)` and sum the `count` of every changed hunk (`added` or `removed` chunks) to get `linesChanged`. This correctly captures rewrites that don't change the file's total length, fixing the flaw above.
- **`added`**: `linesChanged` = the file's own line count (`node._content` split on `\n`).
- **`removed`** (ghost): `linesChanged` = the base file's line count.
- **`unchanged`**: `linesChanged = 0`, no magnitude.

We're adding `diff` (jsdiff) as a runtime dependency rather than hand-rolling an LCS line-diff — line-diffing has enough edge cases (this repo's decision, confirmed with the user) that a well-tested library beats bespoke code for something conceptually simple.

### Relative magnitude

Same shape as issue #27's own sketch (idea 3), computed by an exported pure helper (`applyChangeMagnitude`, mirroring PR #40's structure — this part of PR #40 was sound and isn't being redone):

```
max = max(linesChanged) across all added/modified/removed nodes that will
      actually render with a magnitude fill (in-scope + removed-ghost,
      excluding stubs — see Scope below)
magnitude(node) = max > 0 ? linesChanged / max : 1   // guard: no div-by-zero
```

Scoping `max` to only the nodes that render a magnitude fill (rather than every changed node in the full graph, including out-of-scope ones) matters: an out-of-scope file with a huge unrelated diff would otherwise flatten every in-scope node's magnitude toward zero. Out-of-scope nodes still get a computed `linesChanged` (cheap, consistent), just no `magnitude` — they already render with a fixed OOS fill regardless of diff state, unaffected by this change.

This is a single unified computation across `added`+`modified`+`removed` together, not computed per-type — this is what makes a 5-line added file render distinctly from a 250-line added file (per your example), and also distinctly from a heavily-modified file.

### Visualization: gradient fill (primary), diffstat-style bar as a noted fallback

Primary approach, per your call: keep the continuous fill gradient from PR #40 (`lerpHex(unchangedFill, diffStateFill, magnitude)`, sRGB per-channel lerp, ported to both `draw.ts` and `renderer.html`) — same mechanism, now fed a correct and diagram-relative `magnitude`. **Stroke color stays the fixed full-intensity diff-state color regardless of magnitude** — a barely-changed node still needs its border to clearly say "modified"/"added"/"removed"; only the fill intensity carries magnitude.

We're explicitly not committing to this being the final answer. You flagged the earlier gradient was hard to notice, and the fixture fix (below) should help — but if it's still weak once we can actually see it against realistic content, GitHub's diffstat bar (small proportional added/removed segment bar per node, rendered as its own row of squares) is the next thing to try. That's out of scope for this iteration; noted here so it's not lost.

A "Change magnitude" gradient legend row is added to the HTML sidebar (interactive renderer only — the static SVG has no legend mechanism today, matching the prior design's note).

### Scope of magnitude fill

Applied only to in-scope and `removed-ghost` nodes, excluding stubs — identical rule to PR #40. Out-of-scope nodes and stubs are untouched (they don't render diff-based fill today regardless).

### Plumbing

- **`package.json`**: add `diff` as a runtime dependency.
- **`src/diff-parser.ts`**: compute `linesChanged` per node during the existing node-classification loop (no new lookups needed — `baseNode`/`node` and their `_content` are already in scope there); add exported `applyChangeMagnitude(nodes)` pure helper, called after `diffedNodes` is fully built.
- **`src/types.ts`**: `GraphNode` gains optional public fields `linesChanged?: number` and `magnitude?: number`.
- **`src/renderer/draw.ts`**: exported `lerpHex(from, to, t)`; `nodeColor()` uses it for in-scope/removed-ghost non-stub nodes.
- **`src/renderer.html`**: mirror `lerpHex`/fill logic in the client script; include `linesChanged`/`magnitude` in the embedded per-node data; add the legend row.
- **`src/cli.ts`**: include `linesChanged`/`magnitude` in `buildModeData()` node output (same place `diff` itself is already threaded through).
- **`docs/architecture.md` / `docs/spec.md`**: document the new fields and move "Change magnitude styling" from Planned to implemented; document the `diff` dependency.

### Fixture updates

Current fixture `modified` diffs are all 1–10 lines — not enough spread to see a gradient. Per your direction:

- **Expand one existing modified file into a substantially larger rewrite.** `user-list/users-list.component.ts` is the best candidate — it already carries real behavioral changes (new analytics dependency, removed search-results usage), so growing it further (e.g. more list-rendering logic, a bulk-selection affordance) reads as a natural, larger change rather than padding. Target: at least 30 changed lines (added+removed, per the real line-diff metric above), vs. 1–2 lines for the other three modified files — enough to be unambiguously the "hottest" node in the diagram.
- **Add one small new file** alongside the two existing larger additions in `user-settings/` (`user-security.component.ts` at 33 lines, `user-notification-prefs.component.ts` at 40 lines) — a small model/type (~5–8 lines) so the `added` gradient has visible range too.
- Removed side is left as-is (one removed file; not the axis you asked to demonstrate).
- `CLAUDE.md`'s fixture-diff description gets updated to match.
- `docs/sample-diff.svg` / `docs/sample-all.svg` will need regeneration (`npm run docs:sample:check-drift` will otherwise fail) — expected and reviewed alongside the visual snapshots.

### Testing

- `src/diff-parser.test.ts`: `linesChanged` for added (= own line count), removed ghost (= base line count), modified via real content-diff fixtures including a same-length rewrite (proves the PR #40 flaw is fixed), unchanged (= 0). `applyChangeMagnitude`: relative scaling with a known set of values, single-changed-node → magnitude 1, out-of-scope node excluded from `max` computation, no-changes graph doesn't divide by zero.
- `src/renderer/draw.test.ts`: `lerpHex` boundary/midpoint values; `nodeColor()` fill scales with magnitude while stroke stays fixed; out-of-scope/stub nodes unaffected.
- `src/renderer.html.test.ts`: mirrors the above for the client-side script.
- Visual: `npm run test:visual:approve` after visual review, called out prominently in the PR per the project's standing rule.

## Non-goals

- **Diffstat-style bar visualization** — the noted fallback above; not implemented this iteration.
- **Rename tracking, git management, runtime dependency analysis** — unaffected, same as the prior content-diff design.
- **Perceptual (Oklab) color interpolation** — sRGB per-channel lerp carries over from PR #40 unchanged; not revisited here.

## PR #40 disposition

Close PR #40 and the `issue-27-change-magnitude` branch as superseded. New work lands on a fresh branch off current `main`.
