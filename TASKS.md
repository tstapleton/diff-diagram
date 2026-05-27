# Tasks

Each commit must complete exactly one task from this list and mark it done (`- [x]`).

## Bug Fixes

- [ ] Fix: non-.ts files (`.md`, `.json`, etc.) appear in diagram — `diff-parser.js` `applyDiff()` doesn't filter by extension before creating ghost nodes
- [ ] Fix: `node_modules` files included in diagram — `analyzer.js` glob patterns don't exclude `node_modules/`
- [ ] Fix: removed-ghost nodes always typed as `component` — `diff-parser.js` line 127 hardcodes type instead of calling `classifyByFilename()`
- [ ] Fix: edges/lines overlap in rendered diagram — ELK layout options lack overlap-prevention settings (spacing, spline mode)

## Unit Tests

- [ ] Setup: add vitest, configure `package.json` test script, add `tests/` directory
- [ ] Tests: `diff-parser.js` — `parseDiffOutput()`, `applyDiff()`, path normalization, all diff status codes
- [ ] Tests: `analyzer.js` — file classification, `toNodeId()`, `labelFromFile()`, exclusion of spec/d.ts/node_modules files
- [ ] Tests: `filter.js` — `addContext()`, out-of-scope node creation, edge deduplication

## Renderer Refactor

- [ ] Extract renderer logic from `renderer.html` into `src/renderer/` modules: `layout.js` (elkjs wrapper, pure), `draw.js` (SVG generation, pure), `graph-data.js` (data access helpers)
- [ ] Rewrite `renderer.html` as a thin shell that imports those modules
- [ ] Tests: `renderer/layout.js` — ELK input construction, coordinate offset logic, intra/inter edge separation
- [ ] Tests: `renderer/draw.js` — node color selection, edge path generation, label truncation

## Low Priority

- [ ] Fix: edge rendering failures are silent — add `console.warn` when `laidEdge.sections` is missing
- [ ] Fix: hover doesn't improve edge visibility when edges overlap (depends on layout fix above)
