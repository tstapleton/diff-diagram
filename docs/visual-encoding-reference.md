# Visual encoding reference

**What this is:** A living reference of diff-diagram's rendered visual language —
every color, width, and typography choice, organized by what it means and where
it applies, across files, directories, and edges together. Built while working
through GitHub issue #63 ("Revisit edge line styling") and a related cleanup
pass, going section by section to make deliberate, consistent decisions instead
of redesigning edges in isolation.

**How to use this:** This describes the *current, decided* state — update it in
the same PR as any rendering change, and use it to check whether a change
silently drifts some other element that reuses the same color/width. Source of
truth for the actual implementation is `src/renderer/render.ts`; if this
document and the code disagree, the code wins and this doc is stale (see the
doc-accuracy pass planned last, once all sections below are settled).

**Status:** These tables are updated in the same commit as any rendering change,
so they always reflect the *current* shipped encoding, not the original audited
baseline. See git history for prior states.

---

## Table 1: Structure

| Kind | Fill | Stroke | Width |
|---|---|---|---|
| File — in scope | Diff Fill, gradient toward Unchanged Fill by magnitude | Diff Accent | 1 |
| File — out of scope | External Fill | External Accent | 1 |
| Directory — aggregate (collapsed in Focused view, partially shown, or the whole-feature boundary) | Directory Fill (transparent when partially shown) | Directory Accent | 1.25 |
| Directory — collapsed, Collapsed view | Diff Fill via `aggregateDiff()`, gradient toward Unchanged Fill by the highest member magnitude | Diff Accent | 1.25 |
| Edge | - | Diff Accent | 1.5 |

Every fill and stroke is flat except the two gradient rows noted above. No dash
anywhere, no opacity variation anywhere, corner radius is 4 everywhere.

*A file's diff state defaults to `unchanged` when unset. A directory collapsed
because nothing inside it changed does not get a magnitude gradient — there's
nothing for a gradient to represent, so the flat Directory Fill is already the
correct, most-informative rendering.*

*Open question, not yet reconciled: the same directory, collapsed for the same
reason (nothing inside changed), renders with a different fill mechanism
depending on whether it's Focused view or Collapsed view doing the collapsing
— flat Directory Fill vs. diff-color fill. The two directory rows above exist
because the code genuinely renders them differently today — worth deciding
whether that's intentional.*

## Table 2: Color palette

| Hex | Human-readable name | Meaning | Used for | Constant |
|---|---|---|---|---|
| `#1f6b3d` | Deep green | added, fill tone | file fill (added), gradient target | `NODE_FILL.added` |
| `#9a5510` | Deep amber | modified, fill tone | file fill (modified), gradient target | `NODE_FILL.modified` |
| `#a03333` | Deep red | removed, fill tone | file fill (removed), gradient target | `NODE_FILL.removed` |
| `#2d3f5c` | Deep slate blue | unchanged, fill tone | file fill (unchanged); gradient origin for every magnitude fill | `NODE_FILL.unchanged` |
| `#22c55e` | Bright green | added, accent tone | file stroke, edge stroke, arrowhead (added) | `NODE_STROKE.added` / `EDGE_STROKE.added` |
| `#f59e0b` | Bright amber | modified, accent tone | file stroke, edge stroke, arrowhead (modified) | `NODE_STROKE.modified` / `EDGE_STROKE.modified` |
| `#ef4444` | Bright red | removed, accent tone | file stroke, edge stroke, arrowhead (removed) | `NODE_STROKE.removed` / `EDGE_STROKE.removed` |
| `#8fa8d6` | Periwinkle blue | unchanged, accent tone | file stroke, edge stroke, arrowhead (unchanged) | `NODE_STROKE.unchanged` / `EDGE_STROKE.unchanged` |
| `#1f3355` | Dark navy | external, fill tone | out-of-scope file fill | `OOS_FILL` |
| `#5588cc` | Medium blue | external, accent tone | out-of-scope file stroke | `OOS_STROKE` |
| `#182238` | Near-black navy | directory, fill tone | collapsed-directory fill (Focused view); whole-feature boundary fill | (inline) |
| `#7ba3d9` | Soft blue | directory, accent tone | collapsed-directory stroke (Focused view); partially-shown-directory stroke; whole-feature boundary stroke | (inline) |
| `#ffffff` | White | label text | file and directory labels | `TEXT_COLOR` |
| `#a9c1e8` | Pale blue | subtitle/meta text | out-of-scope file subtitle; whole-feature boundary label | `META_COLOR` |
| `#d3e2f7` | Near-white blue | directory label text | collapsed-directory label (Focused view); partially-shown-directory label | `STUB_TEXT` |
| `#a855f7` | Purple | has-story | story-coverage dot | `STORY_DOT` |
| `#06b6d4` | Cyan | has-test | test-coverage dot | `TEST_DOT` |
| `#0a0f1c` | Canvas black | page background | fills the entire SVG, behind every other element | (inline) |

*The Directory color family (fill + accent) is shared, unchanged, across every
directory-related element — collapsed boxes, the partially-shown wrapper, and
the whole-feature boundary all draw from it. Edges reuse the file Diff Accent
tones exactly. The Diff Fill family (deep tones) has no edge equivalent — edges
have no fill at all.*

## Table 3: Typography / labels

| Applies to | Element | Style | Notes |
|---|---|---|---|
| Everything (files, directories, edges) | Font | Fira Code, monospace | single global constant |
| File, directory (collapsed in Collapsed view) | Label color | Primary Text | — |
| Directory — aggregate | Label color | Directory Text | — |
| Out-of-scope files only | Subtitle (dir path) | Secondary Text, second text row | — |
| Directory — aggregate (`●` when fully collapsed, `◐`/`○` when partially shown); Directory — collapsed, Collapsed view (always `●`) | Label prefix icon + count | `●` closed / `◐` partial / `○` open | shared `formatDirLabel` helper; not used on the whole-feature boundary, which just shows the feature name |
| Directory — aggregate, and Directory — collapsed (Collapsed view) | Label position | always top-anchored, left-aligned (`x+8, y+13`) | same position in both cases, regardless of view mode — leaves room for a nested child box when a Collapsed-view directory is compound; kept identical for every other case too |
| Every edge | Arrowhead marker | filled triangle, color = edge stroke | one `<marker>` def per diff state |
| Edges | Label/text | none | edges carry no text at all |
| Whole-feature boundary | Label color | Secondary Text | top-left placement |
| Directory — partially shown | Label color | Directory Text | top-left placement |
