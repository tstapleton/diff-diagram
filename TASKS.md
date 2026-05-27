# Tasks

Each commit must complete exactly one task from this list and mark it done (`- [x]`).

Approach: TDD (red-green). Write failing tests first that expose the bugs, then fix the code to make them pass.
Test files live next to their source (e.g. `src/diff-parser.test.js`). Tests assert expected output — not implementation details.

## Unit Test Setup

- [x] Setup: add vitest, configure `package.json` test script

## Unit Tests (write these first — they will be red until bug fixes land)

- [ ] Tests: `src/diff-parser.test.js` — `parseDiffOutput()`, `applyDiff()`, path normalization, all diff status codes; include cases that expose known bugs (non-.ts ghost nodes, removed-ghost type)
- [ ] Tests: `src/analyzer.test.js` — `toNodeId()`, `labelFromFile()`, `classifyFile()` by filename and decorator; include cases that expose known bugs (node_modules inclusion, spec/.d.ts exclusion)
- [ ] Tests: `src/filter.test.js` — `addContext()`, out-of-scope node creation, edge deduplication

## Renderer Refactor

- [ ] Extract renderer logic from `renderer.html` into modules: `src/renderer/layout.js` (elkjs wrapper, pure), `src/renderer/draw.js` (SVG generation, pure), `src/renderer/graph-helpers.js` (node/edge data helpers, pure)
- [ ] Tests: `src/renderer/layout.test.js` — ELK input construction, coordinate offset, intra/inter edge separation
- [ ] Tests: `src/renderer/draw.test.js` — node color selection, edge path generation, label truncation
- [ ] Rewrite `renderer.html` as a thin shell that imports those modules

## Bug Fixes (make red tests green)

- [ ] Fix: non-.ts files (`.md`, `.json`, etc.) appear in diagram — `src/diff-parser.js` `applyDiff()` doesn't filter by extension
- [ ] Fix: `node_modules` files included in diagram — `src/analyzer.js` glob patterns don't exclude `node_modules/`
- [ ] Fix: removed-ghost nodes always typed as `component` — `src/diff-parser.js` hardcodes type instead of calling `classifyByFilename()`
- [ ] Fix: edges/lines overlap in rendered diagram — ELK layout options lack overlap-prevention settings

## Low Priority

- [ ] Fix: edge rendering failures are silent — add `console.warn` when `laidEdge.sections` is missing
- [ ] Fix: hover doesn't improve edge visibility when edges overlap (depends on layout fix above)
