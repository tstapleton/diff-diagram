# Tasks

Each commit must complete exactly one task from this list and mark it done (`- [x]`).

Approach: TDD where practical. Tests assert expected output — not implementation details.
Test files live next to their source (e.g. `src/analyzer.test.ts`).

## 1. Documentation (do this first — locks in decisions before code changes)

- [x] Update PLAN.md to reflect final architecture ← done in grill session; verify accuracy
- [x] Update CLAUDE.md — architecture overview, CLI flags, agent context
- [x] Add PLAN.md section: Clustered mode future consideration (description, benefits, how it would work)

## 2. Fix Test Infrastructure

- [x] Fix: vitest/rollup missing native binary — delete node_modules + package-lock.json, reinstall; verify `npm test` runs all existing tests

## 3. TypeScript Setup

- [x] Add TypeScript: tsconfig.json, update package.json build + test scripts, convert existing .test.js files to .test.ts

## 4. Shared Types

- [ ] Define src/types.ts — GraphNode, GraphEdge, Graph, GraphMeta, DiffState, NodeScope, NodeType, EdgeKind

## 5. Core Module Conversion (JS → TS + bug fixes)

- [ ] Convert src/analyzer.js → src/analyzer.ts; fix: node_modules glob exclusion; fix: labelFromFile splits on `.` as well as `-` (e.g. `user-list.component.ts` → `UserListComponent`)
- [ ] Convert src/filter.js → src/filter.ts; remove duplicate classifyByFilename (import from analyzer)
- [ ] Convert src/diff-parser.js → src/diff-parser.ts; fix: non-.ts files must not produce ghost nodes; fix: removed-ghost nodes must call classifyByFilename not hardcode `component`; remove applyDiff (replaced by graph diffing in step 6)

## 6. Edge-Level Diff

- [ ] Implement src/diff-parser.ts diffGraphs(base: Graph, current: Graph): Graph — diffs node sets and edge sets; nodes in current only → added; nodes in base only → removed-ghost; edges in current only → added; edges in base only → removed; matched nodes with import set changes → modified
- [ ] Create fake-angular-app-base/ — base state fixture; update fake-angular-app/ to represent the after state with meaningful differences (added files, modified files, changed imports, new out-of-scope deps)
- [ ] Integration tests: run full pipeline with --base-dir fake-angular-app-base, verify node diff states and edge diff states

## 7. Renderer Modules

- [ ] Extract src/renderer/graph-helpers.ts — computeViewNodes(graph, mode): returns nodes and edges for a given view mode; implements collapse rules (in-scope unchanged subdirs → stubs; out-of-scope unchanged parent groups → stubs; partially-changed dirs → fully expanded; stubs preserve edges)
- [ ] Tests: src/renderer/graph-helpers.test.ts — collapse rules, stub creation, edge preservation, partial change expansion
- [ ] Extract src/renderer/layout.ts — computeLayout(nodes, edges): elkjs wrapper; returns node positions and edge bend points; pure function; runs in Node only
- [ ] Tests: src/renderer/layout.test.ts — ELK input construction, output shape
- [ ] Extract src/renderer/draw.ts — toSvg(layout, nodes, edges): generates SVG string from pre-computed layout; pure function; no DOM
- [ ] Tests: src/renderer/draw.test.ts — node color selection, edge path generation, label truncation

## 8. CLI Rewrite

- [ ] Rewrite src/cli.ts — replace --patch with --base-dir; run analyze() twice (base + current); call diffGraphs(); compute layouts for each view mode; write diagram.svg (diff-focused), diagram.html (all layouts embedded), graph.json
- [ ] Rewrite renderer.html as thin shell — reads pre-computed layout JSON embedded by CLI; no elkjs CDN; handles hover interactions, mode switching (All nodes / Diff-focused), sidebar

## 9. Documentation

- [ ] README.md — what it does, installation, CLI usage, output description, how to integrate with CI
- [ ] Document internal architecture for agents: how the pipeline flows, module responsibilities, how to add a new view mode
