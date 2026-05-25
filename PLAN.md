# Plan: Angular Architecture Diff Diagram Tool

## Context

We are building a CLI tool that takes an Angular "vertical slice" feature directory, parses all TypeScript files in it using ts-morph, adds one hop of context (files outside the scope that scope files directly import), overlays git diff status, and renders a component diagram. The intended use is as a PR review aid — showing what changed and how it fits in the architecture.

User priorities:
- Mermaid for output if it can handle the complexity — validate this before committing
- Static HTML as an intermediary/validation step; SVG image also acceptable for final output
- Modern Angular with standalone components
- All `.ts` files as nodes (including utils/constants/models) — not just Angular-decorated files
- Incremental development with hard validation gates — **if a gate fails, we change approach, not skip**

---

## Node Granularity Considerations

This is the most consequential design decision. It determines diagram complexity and usefulness.

**All `.ts` files are nodes** (except `.spec.ts`). The user explicitly wants to see where utils, constants, and models are used — not just Angular-decorated entry points. This will produce 40-60 nodes for a medium feature slice, which is our stress target.

**File type classification** (determines visual color/group):

| Type | Detection | Visual |
|---|---|---|
| `component` | `@Component(...)` decorator | Blue |
| `service` | `@Injectable(...)` + not guard/resolver/interceptor | Purple |
| `pipe` | `@Pipe(...)` decorator | Cyan |
| `guard` | `@Injectable` + `*.guard.ts` filename | Amber |
| `resolver` | `@Injectable` + `*.resolver.ts` filename | Amber |
| `interceptor` | `@Injectable` + `*.interceptor.ts` filename | Amber |
| `routing` | `*.routes.ts` filename | Green-dim |
| `module` | `@NgModule(...)` decorator (legacy) | Gray-blue |
| `model` | No decorator, `*.model.ts` / `*.interface.ts` / only `interface`/`type` exports | Slate |
| `constants` | No decorator, only constant/function exports | Slate-dim |

**Standalone Angular specifics** (modern pattern):
- `@Component({ standalone: true, imports: [OtherComponent, SomePipe] })` — the `imports` array is a runtime dependency list (what the template actually uses), distinct from TypeScript-level imports
- Both layers must be captured: TypeScript file imports (graph edges) + decorator `imports` array (annotated as `decorator-import` edge kind)
- Decorator import array elements are identifier names — must resolve name → file path via ts-morph symbol lookup

**1-hop context (outgoing only):**
- Show files outside scope that are directly imported by scope files
- Exclude: `node_modules`, `@angular/`, `rxjs`, `@ngrx/`, `@ngxs/` — framework paths add noise without architectural insight
- Do NOT recurse into 1-hop files' dependencies (stop at 1 level)
- 1-hop nodes rendered dimmed to visually separate them from scope

**What we exclude:**
- `.spec.ts` — always
- `environments/` — runtime config, not architecture
- Barrel `index.ts` files: resolve through them to actual source files (ts-morph handles this automatically)

**The 50-node readability question:** A medium Angular feature slice hits 40-60 nodes. This is above the comfort zone for flat Mermaid. We validate this in Gate 1 *before* building the analyzer. Output thresholds:
- <40 nodes → Mermaid with ELK (GitHub-embeddable)
- 40-100 nodes → SVG image (rendered from HTML, embeddable in PR comment as image)
- >100 nodes → Clustered Mermaid overview + SVG detail

---

## File Structure

```
diff-diagram/
  index.html                        ← existing prototype (design language reference)
  package.json                      ← type: module, deps: ts-morph, elkjs
  fake-angular-app/
    src/app/features/users/         ← ~44 hand-crafted .ts files (stress test data)
    src/app/shared/                 ← ~5 files (1-hop context targets)
    fake.diff                       ← simulated PR diff (static text)
  src/
    renderer.html                   ← HTML renderer: reads window.GRAPH_DATA, renders via Mermaid+ELK
    analyzer.js                     ← ts-morph parser → raw JSON graph
    filter.js                       ← scope + 1-hop expansion
    diff-parser.js                  ← git diff → file status map
    cli.js                          ← entry point: wires all modules
  dist/                             ← generated outputs
    diagram.html
    diagram.mermaid.md              ← only if <40 nodes
    graph.json                      ← raw graph for debugging
```

**JSON graph schema** (contract shared between all modules):
```javascript
{
  meta: { scopeDir, generatedAt, nodeCount, edgeCount, renderer, diffSha },
  nodes: [{
    id: "users_list_component",        // sanitized: alphanumeric + underscore only
    label: "UsersListComponent",       // display name
    file: "src/app/features/users/users-list.component.ts",  // repo-relative path
    type: "component",                 // see table above
    scope: "in-scope",                 // "in-scope" | "out-of-scope"
    diff: "modified"                   // "added" | "modified" | "removed" | "unchanged" | null
  }],
  edges: [{
    from: "users_list_component",
    to: "user_card_component",
    kind: "import"                     // "import" | "decorator-import"
  }]
}
```

---

## Phases and Validation Gates

### Phase 0 — Scaffolding (no gate)
- Create `package.json` (`type: module`, deps: ts-morph, elkjs)
- Create `.gitignore`
- `npm install`

---

### Phase 1 — Fake Angular App Fixture (no gate)

Create hand-crafted `.ts` files for a "users" feature. Files must have real TypeScript import statements and Angular decorator syntax so ts-morph can parse them. Bodies can be stubs.

Target: **44 in-scope files + 5 out-of-scope** = 49 total nodes at the stress threshold.

File breakdown in `fake-angular-app/src/app/features/users/`:
- 12 components (standalone, with `imports: [...]` arrays in decorator)
- 8 services (injectable)
- 3 guards + 2 resolvers
- 3 pipes
- 9 models/interfaces
- 5 constants/utils
- 2 routing files

Out-of-scope in `fake-angular-app/src/app/shared/`:
- 5 files: `permissions.service.ts`, `cache.utils.ts`, `storage.utils.ts`, `csv.utils.ts`, `audit.service.ts`

Also create `fake-angular-app/fake.diff` — a static git-diff-format file simulating a PR that:
- Adds one component (green)
- Modifies a service and a model (amber)
- Removes one component (red / ghost node)

**Verify:** `find fake-angular-app -name "*.ts" ! -name "*.spec.ts" | wc -l` → expect 49

---

### Phase 2 — HTML Renderer (`src/renderer.html`) → Gate 1

Self-contained HTML file. No build step — open directly in a browser. Embed a hardcoded 49-node `window.GRAPH_DATA` built from the fake app structure.

**Renderer responsibilities:**
1. Read `window.GRAPH_DATA`
2. Build a Mermaid flowchart string with:
   - `%%{init: {"flowchart": {"defaultRenderer": "elk"}}}%%` header
   - Subgraphs grouping nodes by `type` (Components, Services, Guards/Resolvers, Pipes, Models, Constants/Utils, Routing)
   - `classDef` for each type color + diff state (`diff` overrides `type` color — assign diff class last)
   - `linkStyle` on new/changed edges where needed
3. Render with Mermaid v10 async API
4. Show sidebar: scope meta panel, type legend + diff legend, changed files list

Reuse dark theme, color palette, card/tab CSS from `index.html`.

**Critical:** Mermaid node IDs must be sanitized to alphanumeric + underscore. Labels in brackets are display text.

**Gate 1 — open `src/renderer.html` in browser:**

✅ Pass: All nodes visible, subgraph labels readable, diff colors distinct, ELK layout not catastrophically tangled, fits 1920×1080 (scrolling acceptable)

❌ Fail options (try in order):
1. Switch `flowchart LR` → `flowchart TB` — ELK handles dependency trees better top-down
2. Add a toggle to hide `model`/`constants` nodes — reduces to ~25 decorated-only nodes
3. Abandon Mermaid as primary renderer: use elkjs directly in Node.js to compute x/y coordinates, render hand-crafted SVG. Keep Mermaid only for <20-node cases.

---

### Phase 3 — Analyzer (`src/analyzer.js`) → Gate 2

ts-morph based file parser. ESM module (`"type": "module"` in package.json).

**Algorithm:**
1. `Project.addSourceFilesAtPaths(scopeDir + '/**/*.ts')`, remove `.spec.ts` files
2. Classify each file by decorator + filename pattern (see table above)
3. Extract TypeScript imports: relative paths only, resolve to absolute, skip framework paths
4. Extract decorator `imports` array for `@Component` classes — read the `imports: [...]` property, resolve identifier names to file paths via ts-morph symbol resolution
5. Return raw graph (in-scope nodes + edges, no 1-hop expansion yet)

`src/filter.js` called after: adds 1-hop out-of-scope nodes by following all in-scope import targets that resolve outside the scope directory.

**Framework path filter:**
```javascript
const FRAMEWORK_PREFIXES = ['@angular/', 'rxjs', 'zone.js', '@ngrx/', '@ngxs/', 'lodash', 'tslib'];
const isFrameworkImport = spec => FRAMEWORK_PREFIXES.some(p => spec.startsWith(p)) || !spec.startsWith('.');
```

**Gate 2 — `node src/analyzer.js fake-angular-app/src/app/features/users`:**

✅ Pass: Node count matches `find` output, every node has a valid `type`, specific edges verified (e.g. `UsersListComponent` → `UserCardComponent`, `UsersService`, `UserModel`)

❌ Fail options:
- Decorator import resolution fails → mark edges as `kind: "decorator-import-unresolved"`, still include them
- Classifier wrong → prefer filename-pattern as primary, decorator detection as secondary
- ts-morph parse errors → add `skipFilesWithErrors: true` to Project config

---

### Phase 4 — Diff Parser (`src/diff-parser.js`) → Gate 3

Parses `git diff --name-status` output.

```
A\tsrc/app/features/users/user-bulk-actions.component.ts  → "added"
M\tsrc/app/features/users/users.service.ts                → "modified"
D\tsrc/app/features/users/user-modal.component.ts         → "removed"
R090\told.ts\tnew.ts                                       → "modified" (rename)
```

Exports: `parseDiffOutput(str)` (string → `Map<filepath, status>`) and `getDiffStatus(repoRoot, sha1, sha2)` (shells out to git).

**Removed files:** Must appear as "ghost nodes" in the graph even if they no longer exist on disk — add them from the diff with `diff: "removed"` and `scope: "removed-ghost"`.

**Path normalization:** git diff produces repo-relative paths; analyzer produces absolute paths. CLI normalizes both to repo-relative before merging.

**Gate 3 — merge `fake.diff` into graph, reload `renderer.html`:**

✅ Pass: Added = green, Modified = amber, Removed = red dashed border, Unchanged = dimmed. Legend matches.

❌ Fail: If Mermaid `class` assignment doesn't override type classDef → try multi-class syntax `class nodeId type,diff` (last class wins). If removed ghost nodes cause render errors → validate that ghost node IDs are unique and their edges only point inward.

---

### Phase 5 — CLI Entry Point (`src/cli.js`) → Gate 4

```bash
node src/cli.js \
  --diff-file fake-angular-app/fake.diff \
  --out-dir dist \
  fake-angular-app/src/app/features/users
```

**Flow:** analyze → 1-hop filter → parse diff → merge diff → auto-select renderer → write outputs

**Auto-select renderer:**
- <40 nodes → `mermaid`
- 40-100 nodes → `svg`
- >100 nodes → `clustered` (Mermaid domain overview + SVG detail)

**Outputs in `dist/`:**
- `diagram.html` — always
- `graph.json` — always (for debugging)
- `diagram.mermaid.md` — only if <40 nodes

**Gate 4 — run CLI, open `dist/diagram.html`:**

✅ Pass: HTML opens without error, node count matches `graph.json`, diff colors on correct nodes, sidebar shows correct changed-file counts

❌ Fail: Add `--debug` flag logging each file's classification and imports. Add `graph-pre-diff.json` / `graph-post-diff.json` intermediate outputs to isolate path normalization bugs.

---

### Phase 6 — Polish (only after all gates pass)
- Clustered mode: collapse `model`/`constants`/`routing` into summary nodes, expand only if they contain changed files
- Toggle in renderer: "show all" vs "changed + neighbors only"
- `--format` flag: `auto` | `mermaid` | `svg` | `html`

---

## Risks

| Risk | Mitigation |
|---|---|
| ELK render time >5s for 50 nodes | Fall back to dagre for live preview; use ELK only for final SVG export |
| Decorator `imports` array symbol resolution fails | Treat as display-only annotations; don't block the graph |
| Barrel file (`index.ts`) indirection | ts-morph's `getModuleSpecifierSourceFile()` resolves through barrels automatically |
| Mermaid `class` assignment order | Diff state class must be assigned last (after type class) |
| git diff path vs. analyzer absolute path mismatch | Normalize all paths to repo-relative in CLI before merging |

---

## Reused from Prototype (`index.html`)
- Dark theme CSS variables and color palette
- `classDef` color scheme for diff states
- Mermaid `initialize()` config with `themeVariables`
- `renderInto()` async pattern with lazy rendering
- Sidebar card layout and legend structure
