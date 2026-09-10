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

| Kind | Fill | Stroke | Width | Opacity |
|---|---|---|---|---|
| File — in scope, changed itself or touched by a changed edge | Diff Fill, gradient toward Unchanged Fill by magnitude | Diff Accent | 1 | 1 |
| File — in scope, `unchanged` and untouched | Diff Fill (unchanged tone) | Diff Accent (unchanged tone) | 1 | 0.45 |
| File — out of scope | External Fill | External Accent | 1 | 1 (exempt from dimming) |
| Stub (fully-collapsed directory placeholder), in scope, touched | Container Fill by nesting tier (tier 1 or tier 2) | Container Rim (faint) | 1 | 1 |
| Stub (fully-collapsed directory placeholder), in scope, untouched | Container Fill by nesting tier (tier 1 or tier 2) | Container Rim (faint) | 1 | 0.45 |
| Stub (fully-collapsed directory placeholder), out of scope, touched | External Fill | External Accent | 1.25 | 1 |
| Stub (fully-collapsed directory placeholder), out of scope, untouched | External Fill | External Accent | 1.25 | 0.45 |
| Whole-feature boundary (nesting tier 0) | Container Fill tier 0 | Container Rim (faint) | 1 | 1 (exempt from dimming) |
| Subdirectory group box (nesting tier 1 or tier 2; Focused + Expanded views) | Container Fill by nesting tier | Container Rim (faint) | 1 | 1 (exempt from dimming) |
| Directory — collapsed, Collapsed view, either scope, changed itself or touched | Diff Fill via `aggregateDiff()`, gradient toward Unchanged Fill by the highest member magnitude | Diff Accent | 1.25 | 1 |
| Directory — collapsed, Collapsed view, either scope, `unchanged` and untouched | Diff Fill (unchanged tone) | Diff Accent (unchanged tone) | 1.25 | 0.45 |
| Edge — touching a changed node, or itself diff-colored | - | Diff Accent | 1.5 | 1 |
| Edge — touching no changed node | - | Diff Accent (unchanged tone unless the edge itself is diff-colored) | 1.5 | 0.35 |

Every fill and stroke is flat except the two gradient rows noted above. No dash
anywhere, corner radius is 4 everywhere. Node and edge opacity are the one
place opacity varies, and they're driven by two different rules. Edge opacity
renders at full opacity (1) if either endpoint is a *changed* node — a node
whose own diff state is added/modified/removed — or the edge's own diff state
is added/modified/removed, and at 0.35 otherwise (`EDGE_OPACITY_FULL` /
`EDGE_OPACITY_DIMMED` and `computeChangedNodeIds` in `render.ts`). This
deliberately stops at nodes that changed themselves — it does **not** also
light up every edge touching a node that merely gained or lost some *other*
changed edge (that broader "touched" notion is what decides node opacity,
below, and Focused-view visibility, but applying it to edge opacity
over-spread: one added edge into an existing, otherwise-untouched node lit up
every other edge on that node too). A genuinely-unchanged edge landing on an
existing, content-unchanged file still renders at full opacity when its
*other* endpoint changed — e.g. an existing file gaining a new caller —
since that's exactly the context a reviewer needs alongside the change; an
edge whose own diff changed (e.g. a resolved import shifting because of a
barrel re-export elsewhere) is likewise always full opacity even if neither
endpoint file's own content changed.

Node opacity uses the broader "touched" rule instead: a node renders at full
opacity if it changed itself (added/modified/removed) OR it's an endpoint of
some *other* edge whose diff state changed, and at 0.45 otherwise
(`NODE_OPACITY_FULL`/`NODE_OPACITY_DIMMED` and `computeTouchedNodeIds` in
`render.ts`) — the same "touched" notion `graph-helpers.ts`'s
`touchedIds`/`isVisible` use to decide Focused-view visibility. This means a
content-unchanged file that just gained a new caller elsewhere renders at
full opacity, even though the *edge* into it might render dimmed if the
change lives one hop further away. Only a genuine out-of-scope leaf file is
exempt from this dimming (it's rendered with fixed colors regardless of diff
state — see `nodeColor()`'s early return — and has no meaningful diff state
of its own). A collapsed directory box is never exempt just because it's
out-of-scope or a stub: whether it's an in-scope stub, an out-of-scope stub,
an in-scope directory box (Collapsed view), or an out-of-scope directory box
(Collapsed view), it dims when genuinely untouched and lights up when a
changed edge was remapped onto it, same as any other node — a stub's `diff`
field is hardcoded `"unchanged"`, but that's accurate, not a placeholder: a
directory only collapses to a stub in Focused view when nothing inside it
changed at either the file or edge level.

`unchanged`/untouched elements are pure context and typically the large
majority of both nodes and edges in a real diagram; rendering them at the
same visual weight as genuinely-changed elements was the top-ranked finding
of a graph-drawing/information-visualization literature review (Purchase,
Tufte's data-ink ratio, Ware) into this diagram's busyness. Node dimming is
applied as an `opacity` attribute on the outer `<g class="node-group">`
wrapper, so the rect, label text, and test/story dots all dim together as
one unit — this mirrors the edge convention (a presentation attribute, not
inline style, kept free for `renderer.html`'s hover JS to layer transient
highlighting on top of; in practice the hover JS only touches edge opacity
today, not node opacity, but the convention is kept consistent regardless).
Stroke width does not vary by diff state or by dimming — it's a fixed value
per element kind: 1 for a leaf file and for structural chrome (the boundary,
subdirectory group boxes, in-scope stubs), 1.25 for an out-of-scope stub and
a Collapsed-view directory box, 1.5 for an edge. Opacity is the one
de-emphasis mechanism used, not stacked with a width change. Edge paths are
also rendered as a locally-rounded curve through ELK's routed points rather
than sharp straight-line bends (see `buildEdgePath` in `render.ts`) —
smoothing bends reduces the visual-tracing effort of following a path, per
Ware's findings on bend perception. This rounds each corner independently (a
quadratic Bezier arc, radius up to 12px, clamped to at most half of each
adjacent segment) rather than fitting a spline through every point — ELK's
routing is orthogonal and often produces very short stair-step segments
(parallel edges fanning into adjacent ports), and a spline's extrapolated
tangents overshoot those, producing visible looping/waviness; local
corner-rounding never strays from the original routed path by more than the
radius. ELK spacing (`elk.spacing.edgeNode`/`elk.spacing.edgeEdge` in
`layout.ts`) is also opened up beyond the default, giving routed edges more
room to breathe around nodes and each other.

The purely-structural directory chrome — the whole-feature boundary, the
subdirectory group boxes, and the fully-collapsed in-scope subdirectory stubs
— carries no diff state, so it is distinguished from diff-colored nodes and
from edges routed nearby (issue #90) by a **depth-stepped background fill**
rather than a contrasting border: a filled, tinted region reads as "a group"
on its own via Gestalt *enclosure* (Munzner, Ware), which is often a stronger
grouping cue than an outline. Each nesting tier steps lighter than the one
enclosing it, with a deliberately small tier-0 -> tier-1 step (a level-1
subdirectory box reads as a gentle subdivision of the boundary, not a bold
panel) and a larger tier-1 -> tier-2 step (a level-2 nest still stands out
clearly against its level-1 parent):
Container Fill tier 0 (`#1c3352`) for the whole-feature boundary, tier 1
(`#2a4569`) for a level-1 subdirectory box or stub, tier 2 (`#4a72a4`) for a
level-2 one, all over the `#0a0f1c` canvas (`CONTAINER_FILL_BY_DEPTH` in
`render.ts`; `containerFill()` clamps deeper nesting to the last tier — layout
never boxes more than 2 levels deep). The tier is threaded from `layout.ts`
(`LayoutSubdirContainer.depth`, counted from the `__subdir__<l1>[/<l2>]`
container id) for group boxes, and from `graph-helpers.ts`'s `makeStub` calls
(`GraphNode.depth`) for stubs. The border is reduced to a **faint Container
Rim** (`#3a5170`, width 1) — just enough to keep a box's extent crisp where
edges crowd it, without the stroke competing as a relationship line (it is
darker and less saturated than the periwinkle unchanged-edge accent `#8fa8d6`
and the out-of-scope blue `#5588cc`, the two lines it could be confused with).
An out-of-scope stub is unaffected — it keeps the out-of-scope palette
(External Fill / External Accent, width 1.25). The structural fill is exempt
from proximity dimming for the boundary and the group boxes; an in-scope stub
still dims to 0.45 when genuinely untouched, same as any other collapsed
directory node.

*A file's diff state defaults to `unchanged` when unset. A subdirectory
collapsed because nothing inside it changed does not get a magnitude gradient —
there's nothing for a gradient to represent, so the flat Container Fill for its
nesting tier is already the correct, most-informative rendering.*

*Open question, not yet reconciled: the same directory, collapsed for the same
reason (nothing inside changed), renders with a different fill mechanism
depending on whether it's Focused view or Collapsed view doing the collapsing
— depth-stepped Container Fill vs. diff-color fill via `aggregateDiff()`. The
directory rows above exist because the code genuinely renders them differently
today — worth deciding whether that's intentional.*

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
| `#8fa8d6` | Periwinkle blue | unchanged, accent tone | file stroke, edge stroke, arrowhead (unchanged) — an unchanged edge's stroke *and* its arrowhead render at opacity 0.35 when neither endpoint is a changed node (see Table 1); the SVG `opacity` attribute on a path dims its `marker-end` too, so line and arrowhead recede together; an untouched in-scope/directory/stub node also renders at opacity 0.45 via the `opacity` attribute on its `<g class="node-group">` wrapper | `NODE_STROKE.unchanged` / `EDGE_STROKE.unchanged` / `EDGE_OPACITY_DIMMED` / `NODE_OPACITY_DIMMED` |
| `#1f3355` | Dark navy | external, fill tone | out-of-scope file fill | `OOS_FILL` |
| `#5588cc` | Medium blue | external, accent tone | out-of-scope file stroke | `OOS_STROKE` |
| `#1c3352` | Deep navy | structural container fill, tier 0 | whole-feature boundary fill | `CONTAINER_FILL_BY_DEPTH[0]` |
| `#2a4569` | Dark navy-blue | structural container fill, tier 1 | level-1 subdirectory group box fill; in-scope stub fill (level-1) | `CONTAINER_FILL_BY_DEPTH[1]` |
| `#4a72a4` | Slate blue | structural container fill, tier 2 | level-2 subdirectory group box fill; in-scope stub fill (level-2) | `CONTAINER_FILL_BY_DEPTH[2]` |
| `#3a5170` | Muted steel blue | structural container rim | faint stroke (width 1) on the whole-feature boundary, every subdirectory group box, and every in-scope stub — a boundary cue, not a relationship line, so it sits well below the periwinkle/OOS blues in contrast | `CONTAINER_STROKE` |
| `#ffffff` | White | label text | file and directory labels | `TEXT_COLOR` |
| `#a9c1e8` | Pale blue | subtitle/meta text | out-of-scope file subtitle; whole-feature boundary label | `META_COLOR` |
| `#d3e2f7` | Near-white blue | directory label text | partially-shown-directory label; whole-feature-boundary-adjacent subdirectory group box label | `STUB_TEXT` |
| `#a855f7` | Purple | has-story | story-coverage dot | `STORY_DOT` |
| `#06b6d4` | Cyan | has-test | test-coverage dot | `TEST_DOT` |
| `#0a0f1c` | Canvas black | page background | fills the entire SVG, behind every other element | (inline) |

*The structural-container family is a three-step fill ramp (tiers 0–2) plus one
faint shared rim, applied to every purely-structural directory element in
Focused and Expanded views — the whole-feature boundary, the subdirectory group
boxes, and the in-scope stubs. It is deliberately NOT reused for Collapsed-view
directory boxes, which carry a real `aggregateDiff()` color and gradient (that
colour is signal, not chrome). Edges reuse the file Diff Accent tones exactly.
The Diff Fill family (deep tones) has no edge equivalent — edges have no fill at
all.*

## Table 3: Typography / labels

| Applies to | Element | Style | Notes |
|---|---|---|---|
| Everything (files, directories, edges) | Font | Fira Code, monospace | single global constant |
| File, directory (collapsed in Collapsed view), stub (collapsed in Focused view) | Label color | Primary Text | in-scope stub used to render its label in Directory Text at a smaller font size (10 vs. 11) — unified onto the same style as directory, since an in-scope stub and an in-scope directory box are the same "collapsed group" concept and previously diverged only because they came from different view modes. An out-of-scope stub/directory box is styled like an out-of-scope file instead (see below), not like this row |
| Directory — aggregate (partially shown, or the whole-feature boundary) | Label color | Directory Text | — |
| Out-of-scope, any type (file, stub, or directory box) | Subtitle (dir path) | Secondary Text, second text row | every out-of-scope node shows this, not just individual files — its label alone is just a bare basename, which can be ambiguous, and the tool doesn't control out-of-scope naming the way it does the in-scope feature being diagrammed. For a stub/directory node the subtitle is the group's own full directory (its `.file` already *is* a directory, unlike a real file's `.file`, which needs its trailing filename segment stripped first) |
| Stub, Directory — collapsed (Collapsed view) (`●` when fully collapsed), Directory — aggregate (`◐`/`○` when partially shown) | Label prefix icon + count | `●` closed / `◐` partial / `○` open | shared `formatDirLabel` helper; not used on the whole-feature boundary, which just shows the feature name |
| Stub, Directory — aggregate, Directory — collapsed (Collapsed view) — **in scope only** | Label position | top-anchored, left-aligned (`x+8, y+13`) | leaves room for a nested child box when a Collapsed-view directory is compound; kept identical for every in-scope case. An **out-of-scope** stub/directory box is vertically centered instead, with the path subtitle below the label — the same two-line layout as an individual out-of-scope file uses, not this top-anchored one |
| Every edge | Arrowhead marker | filled triangle, color = edge stroke | one `<marker>` def per diff state |
| Edges | Label/text | none | edges carry no text at all |
| Whole-feature boundary | Label color | Secondary Text | top-left placement |
| Directory — partially shown | Label color | Directory Text | top-left placement |
