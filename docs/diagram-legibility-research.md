# Diagram legibility research

Real diff-diagram output gets visually busy on large feature directories — see the discussion
that prompted this doc, triggered by a real screenshot of a `profile-edit` feature (not checked
into this repo). This is a research pass, not a design spec: it exists to ground "make the
diagram less busy" ideas in an actual field with actual findings, before deciding what to build.

Two independent research passes fed this doc:

- **Pass 1** was given six brainstormed ideas up front and asked to research the field, then
  score those ideas against it.
- **Pass 2** was given *no* prior ideas — only the real screenshot and the codebase — and asked
  to diagnose the busyness and research the field cold, specifically to check whether Pass 1's
  scoring was anchored on the ideas it was handed rather than independently derived.

Where both passes converged on the same conclusion from different angles, that's noted below —
it's a stronger signal than either pass alone.

## The field

This is **graph drawing** (a subfield of algorithms/HCI, not a niche): a body of controlled,
citable research on what actually makes a node-link diagram legible, plus general
**information visualization** perceptual theory. Findings from both passes, combined:

| Source | Finding | Relevance here |
|---|---|---|
| Sugiyama, Tagawa & Toda, "Methods for Visual Understanding of Hierarchical System Structures," IEEE Trans. SMC 11(2), 1981 | The four-phase layered-drawing framework (cycle removal → layering → crossing minimization → coordinates) | This is what ELK's `elk.algorithm: layered` — already diff-diagram's algorithm — implements. The quality knobs it exposes (crossing-minimization strategy, spacing, routing) are well-studied parameters, not exotic extras. |
| Purchase, "Which Aesthetic Has the Greatest Effect on Human Understanding?", Graph Drawing (GD) 1997, LNCS 1353 | Empirically ranks aesthetics by effect on comprehension: **edge-crossing minimization dominates**, bends have a smaller real effect, symmetry and angular-resolution/orthogonal-grid alignment were not statistically significant | Confirms *perceived* crossing density (driven by spacing/routing, not just topology) is a first-order legibility problem here — and that chasing symmetry or grid alignment would be wasted effort |
| Purchase et al., UML class-diagram comprehension studies | Once a diagram has real semantic structure (like UML), domain-meaningful clustering matters as much or more than generic crossing/bend metrics | Directly applicable — diff-diagram's directory grouping is exactly this kind of domain clustering, and it's likely doing real work already |
| Ware, Purchase, Colpoys, McGill, "Cognitive Measurements of Graph Aesthetics," Information Visualization 1(2), 2002 | Ties crossings/bends to the actual mechanics of eye-tracing an edge — each bend/crossing costs extra fixations | The perceptual *why* behind the crossing/bend findings, not just correlation |
| Di Battista, Eades, Tamassia, Tollis, *Graph Drawing: Algorithms for the Visualization of Graphs*, Prentice Hall, 1999; Tamassia (ed.), *Handbook of Graph Drawing and Visualization*, CRC Press, 2013 | The field's canonical reference texts | Background; the Handbook covers edge bundling and clustered/hierarchical drawing specifically |
| Gansner, Koutsofios, North, Vo, "A Technique for Drawing Directed Graphs" (the Graphviz/dot paper), Software: Practice & Experience, 1993–2000 | Design rationale for the same layered-algorithm family, explicitly framed around software-engineering call graphs | The closest thing to a direct precedent for this exact use case |
| Munzner, *Visualization Analysis and Design* | The why/what/how framework; Gestalt grouping (proximity, similarity, enclosure, continuity) as the perceptual substrate of any node-link diagram | Enclosure (a boundary) is one of the strongest Gestalt cues, often stronger than color — relevant to how container boxes are styled |
| Ware, *Information Visualization: Perception for Design* | Gestalt grouping and preattentive pop-out in more depth | Same territory as Munzner, deeper perceptual grounding |
| Tufte, *The Visual Display of Quantitative Information*, 1983 | Data-ink ratio / chartjunk: ink not carrying the reader's task should recede | Best treated as a well-known, useful heuristic rather than an empirically validated law — Tufte's own basis was introspection, not controlled study, and some later work found viewers sometimes prefer *lower* data-ink designs |
| Shneiderman, "The Eyes Have It," IEEE Symp. Visual Languages, 1996 | "Overview first, zoom/filter, then details-on-demand" | diff-diagram's three view modes (collapsed → focused → expanded) already *are* this ladder, structurally — good validation the existing architecture is on the right track |
| Furnas, "Generalized Fisheye Views," CHI 1986; van Ham & Perer, "Search, Show Context, Expand on Demand," IEEE TVCG 2009 | Degree-of-Interest (DOI): blend a-priori interest + distance-from-focus to decide what to emphasize, typically by **dimming, not hiding**, so context is preserved | The direct academic ancestor of "distance-based dimming" (idea #3 below) |
| Holten, "Hierarchical Edge Bundling," IEEE TVCG 2006; Holten & van Wijk, "Force-Directed Edge Bundling," 2009 | Bends parallel edges converging on a shared target to run together through shared control points, cutting perceived clutter while preserving every connection | Directly targets diff-diagram's fan-in-to-a-shared-stub pattern (see below) |
| Ghoniem, Fekete, Castagliola, "A Comparison of the Readability of Graphs Using Node-Link and Matrix-Based Representations," IEEE InfoVis 2004 | Node-link wins for path/connectivity tasks; matrix representations start winning on most *other* tasks once density crosses a threshold | Confirms node-link is still the right representation for this tool's actual task (tracing dependency paths) — the fix is filtering/aggregation, not switching representations |
| Lanza & Ducasse, "Polymetric Views," IEEE TSE 29(9), 2003 | Mapping software metrics to visual attributes | Precedent for diff-diagram's own change-magnitude → fill-intensity gradient |
| Storey, Fracchia & Müller, "Cognitive Design Elements to Support the Construction of a Mental Model During Software Exploration," JSS 44(3), 1999 (the Rigi tool) | Hierarchical fisheye decomposition — collapse what's irrelevant, expand what matters | Same pattern diff-diagram's focused mode already reaches for |
| Diehl, *Software Visualization*, Springer, 2007 | Survey covering clustering/bundling specifically for large dependency and call graphs | Background |

## What's actually causing the busyness (from Pass 2's direct code + screenshot diagnosis)

Pass 2 read the real rendering pipeline and traced four concrete, compounding causes:

1. **Node-level filtering doesn't cascade to edges.** `computeViewNodes`'s `isVisible()` (`src/renderer/graph-helpers.ts`) decides whether a *node* is shown, but once a node earns visibility for any reason, **every one of its edges survives**, including edges whose own diff is `unchanged`. A node pulled in by one changed import drags its entire original edge set along. Pass 2 called this "almost certainly the single biggest contributor" to the screenshot's dense mesh of unchanged (periwinkle-blue) lines.
2. **Fan-in hubs.** Out-of-scope nodes get grouped into shared stub boxes (`authorization (4)`, `api-client (2)`, etc.), but grouping the *targets* doesn't reduce the *edges* — every in-scope node importing something under that directory still draws its own edge to the shared stub. Classic hub/hairball pattern.
3. **Flat, undifferentiated edge weight.** `docs/visual-encoding-reference.md` already documents this as deliberate: no dash, no opacity variation anywhere. An `unchanged` edge (the majority, pure context) renders at the exact same `stroke-width="1.5"` as an `added` edge (the actual signal) — equal visual weight for ~80% non-signal ink and ~20% signal ink, on a tool whose whole purpose is showing where a change sits.
4. **Fixed ELK spacing/routing don't scale with graph size.** `elk.spacing.nodeNode`/`nodeNodeBetweenLayers` are hardcoded constants in `layout.ts`; `elk.spacing.edgeNode`/`edgeEdge` aren't set at all (ELK's small defaults apply); no explicit `elk.edgeRouting` is set (ELK's layered default, `ORTHOGONAL`, is what's producing the many right-angle jogs in the screenshot). Tight fixed spacing on a dense graph packs unrelated edge segments close together, which inflates *perceived* crossings even without more actual topological ones.

Also: no size/density budget exists on how many partially-touched subdirectories can expand
simultaneously in focused mode — a feature with 10+ partially-touched subdirs gets 10+
simultaneously-expanded boxes, with nothing to cap total complexity. And since
`diagram-focused.svg` is the artifact that actually gets pasted into PR comments (per
`docs/spec.md`), any fix has to work as *static* layout/coloring/collapsing — the existing
hover-highlight and mode-switch interactivity in `renderer.html` doesn't reach reviewers looking
at a static image.

## The six original ideas, scored against the research

| # | Idea | Verdict | Notes |
|---|---|---|---|
| 1 | Bundle/consolidate out-of-scope destination boxes | Direction supported (Holten) but likely already substantially implemented | `computeViewNodes` already collapses an OOS directory to one stub when every member is unchanged — the *structural* consolidation Holten's bundling approximates visually. The real remaining gap, per Pass 2, is edge-level: even a collapsed stub still receives one full edge per consumer. |
| 2 | Better edge routing (crossing minimization / orthogonal vs. polyline vs. splines) | Partially already addressed, partially a real untried lever | ELK's `layered` algorithm already runs Purchase's #1 factor (crossing minimization). What's *not* tried: `elk.edgeRouting: SPLINES`, and spacing that scales with graph density instead of fixed constants — Pass 2 independently flagged both as untuned. |
| 3 | Persistent distance-based dimming | **Best-supported idea, and independently rediscovered** | Pass 1: direct match to Furnas/van Ham & Perer's Degree-of-Interest literature. Pass 2, working from the code and screenshot alone with no mention of this idea, independently arrived at "de-emphasize unchanged edges" from a completely different angle (Tufte/Ware ink-hierarchy, not DOI) and ranked it their #1 recommendation. Two independent passes converging on the same fix from different theoretical starting points is a real signal, not a coincidence of one agent anchoring on the other. |
| 4 | A coarser "mostly touched" collapse tier | Supported, and independently rediscovered | Pass 1: consistent with Shneiderman's overview→filter→detail ladder the tool already implements. Pass 2 independently found the same gap from the screenshot: no size/density budget on simultaneous subdirectory expansion. |
| 5 | Click-to-isolate (pin the hover-highlight) | Supported, recommend merging with #3 | This is "details-on-demand" made persistent. Pass 1's read: van Ham & Perer's paper title is literally "Search, Show Context, Expand on Demand" — search/select, dim by distance, click to commit — so #3 and #5 are really one DOI-based interaction, not two features. |
| 6 | A depth/size-aware layout algorithm switch (e.g. ELK `mrtree` above a node-count threshold) | **Not supported** | `mrtree` assumes a tree (strict parent→child, no cross-links). An import graph — where multiple files share a common service — is not a tree; forcing it through a tree layout either drops real multi-parent edges or fights the layout's own strength. Both passes agree on rejecting this one. |

**Two additional ideas surfaced by the research, not in the original six:**

- **Curved edges instead of straight-line bends** (Pass 1) — cheap, targets Ware et al.'s bend-tracing cost directly, no layout/algorithm change required.
- **Splines routing + density-scaled ELK spacing** (Pass 2, overlaps with idea #2 above) — same cheap-experiment category.

## Prototypes already built (not shipped)

Two real before/after renders were built directly from this project's own rendering code and a
real fixture (not a toy example) while this research was underway:

- **Borderless containers** — removes the contrasting stroke color from purely-structural boxes
  (subdirectory groups, stubs, the feature boundary), replacing it with a tinted background and
  no contrasting border, on the theory that a border which never carries diff information is
  pure decoration. The research supports this: enclosure is one of the strongest Gestalt grouping
  cues (Munzner, Ware) — often stronger than color — so a filled region still reads as "grouped"
  without needing a contrasting outline, freeing the color channel to mean only diff state.
- **Distance dimming** — the actual DOI idea (#3) above, prototyped as a raw SVG post-process:
  opacity scales with BFS graph-distance from an actual change (0/1/2/3+ hops → 1.0/0.85/0.55/0.35
  opacity, illustrative, not tuned), with any node or edge that itself has a real diff state
  exempted and always shown at full opacity.

Neither is wired into `render.ts` as a real feature. Both were one-off scripts against a
throwaway copy of the rendering code — worth rebuilding properly if either idea moves forward.

## Recommendations

### Do now — cheap, low-risk, well-supported (some independently, by both passes)

1. **De-emphasize `unchanged` edges** relative to diff-colored ones (thinner stroke and/or lower
   opacity). This is the single highest-confidence recommendation in this whole doc — found
   independently by both passes from different theoretical angles. Requires updating
   `docs/visual-encoding-reference.md`'s current "no opacity variation anywhere" rule alongside
   the code change, since that's a deliberate, already-documented choice being revisited.
2. **Reduce fan-in edge clutter into OOS/stub hubs** — draw individual edges into a stub target
   only when the edge itself is diff-relevant; let the stub's own `(N)` count represent the rest,
   rather than drawing every consumer's edge individually.
3. **Try `elk.edgeRouting: SPLINES` and density-scaled spacing** as an experiment against a real,
   dense fixture (not the small sample fixtures) — cheap to try, no architecture change, directly
   addresses the routing/spacing gap Pass 2 found.

### Do later — real feature work, needs more design

4. **Distance-based dimming as a shipped feature**, merged with click-to-isolate (issue #81 +
   idea #5) rather than built as two separate features.
5. **A density/size budget for focused-mode collapsing** (idea #4) — e.g. expand only the K
   most diff-dense subdirectory groups, stub the rest even if lightly touched. Worth exposing as
   explicit/opt-in rather than a silent default change, since it trades away visibility of some
   lightly-touched files.
6. **Curved edge rendering** instead of straight-line bend segments — cheap, but lower priority
   than items 1–3 above.

### Not pursuing

7. **Switching to a different layout algorithm (`mrtree`) for large graphs** — both passes agree
   this fights the actual shape of an import graph, which isn't a tree.

## Related

- Issue #25 — out-of-scope grouping for mixed-state directories (adjacent to recommendation #2
  above, but not the same thing: #25 is about node-level grouping when some members changed and
  some didn't; this doc's #2 is about edge-level fan-in regardless of node grouping).
- Issue #81 — persistent distance-based dimming (recommendation #4).
- Issue #86 — mechanical doc/code drift-check mechanism (unrelated to this doc's subject, but a
  reminder: if any of the "do now" items ship, `docs/visual-encoding-reference.md` needs to be
  updated in the same change, not after).
