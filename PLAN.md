# Plan: Angular Architecture Diff Diagram Tool

## Context

We are building a CLI tool that takes an Angular "vertical slice" feature directory, parses all TypeScript files in it using ts-morph, adds one hop of context (files outside the scope that scope files directly import), overlays git diff status, and renders a component diagram. The intended use is as a PR review aid — showing what changed and how it fits in the architecture.

User priorities:
- **No Mermaid** — use elkjs for layout and SVG for output
- HTML preview tool and SVG image as the two outputs (SVG embeds in GitHub PR comments as an image)
- Modern Angular with standalone components
- All `.ts` files as nodes (including utils/constants/models) — not just Angular-decorated files
- Incremental development with hard validation gates — **if a gate fails, we change approach, not skip**

---

## Node Granularity Considerations

**All `.ts` files are nodes** (except `.spec.ts`, `.scss`, `.html` — none of which are written in the fake app). The user wants to see where utils, constants, and models are used — not just Angular-decorated entry points.

**Quick count for any existing feature directory:**
```bash
find <scope-dir> -name "*.ts" ! -name "*.spec.ts" | wc -l
```

**File type classification** (determines node shape and grouping — NOT color; color is reserved for diff state):

| Type | Detection | SVG shape |
|---|---|---|
| `component` | `@Component(...)` decorator | rectangle |
| `service` | `@Injectable(...)` + not guard/resolver/interceptor | rounded rect |
| `pipe` | `@Pipe(...)` decorator | ellipse |
| `guard` | `@Injectable` + `*.guard.ts` filename | diamond |
| `resolver` | `@Injectable` + `*.resolver.ts` filename | diamond |
| `interceptor` | `@Injectable` + `*.interceptor.ts` filename | diamond |
| `routing` | `*.routes.ts` filename | hexagon |
| `module` | `@NgModule(...)` decorator (legacy) | rounded rect |
| `model` | No decorator, `*.model.ts` / `*.interface.ts` / only `interface`/`type` exports | plain rect (thin border) |
| `constants` | No decorator, only constant/function exports | plain rect (thin border) |

**Visual encoding:**
- **Color** = diff state only: green (added), amber (modified), red (removed), dim gray (unchanged)
- **Shape** = file type (see table)
- **Subgraph** = directory grouping within scope

**Standalone Angular specifics:**
- `@Component({ standalone: true, imports: [OtherComponent, SomePipe] })` — the `imports` array is a runtime dependency list distinct from TypeScript-level imports
- Both layers captured: TypeScript imports (graph edges) + decorator `imports` array (edge kind: `decorator-import`)
- Decorator import identifiers resolved to file paths via ts-morph symbol lookup

**1-hop context — exact definition:**
Everything inside the scope directory is shown. Those files import other files outside the scope directory. Show those external targets as context nodes. Do NOT recurse into their imports — stop at one level outside.

Example: `users/services/users.service.ts` imports `shared/api/api.service.ts` → `api.service.ts` appears as a context node. `api.service.ts`'s imports do not appear.

Framework/npm packages (`@angular/`, `rxjs`, etc.) are not files on disk and are naturally excluded when filtering to relative imports.

**Import resolution — future-proofing:**
The analyzer uses ts-morph initialized with the project's `tsconfig.json` (when present) so the TypeScript compiler resolves all import styles automatically: relative paths, `baseUrl`-relative paths, and `paths` aliases (e.g. `@app/shared` → `src/app/shared`). Fallback: relative-only resolution when no tsconfig is found. This handles messy real-world codebases without custom import-string parsing.

```javascript
const project = new Project({
  tsConfigFilePath: path.join(repoRoot, 'tsconfig.json'), // optional, detected automatically
  skipAddingFilesFromTsConfig: true,  // we add scope files manually
});
```

---

## File Structure

```
diff-diagram/
  index.html                        ← existing prototype (design language reference)
  package.json                      ← exact pinned versions, "save-exact": true
  package-lock.json                 ← committed, pins the full dependency tree
  .npmrc                            ← save-exact=true, audit-level=high
  .gitignore
  fake-angular-app/
    src/app/features/users/         ← domain-organized, ~65 .ts files
    src/app/shared/                 ← ~20 files (realistic shared library)
    fake-simple.patch               ← 3 changes: easy comprehension test
    fake-complex.patch              ← 8 changes: full scenario coverage
  src/
    graph.schema.js                 ← JSON schema / JSDoc for the graph contract
    renderer.html                   ← elkjs → SVG renderer (hand-authored JSON input)
    analyzer.js                     ← ts-morph parser → JSON graph
    filter.js                       ← 1-hop expansion
    diff-parser.js                  ← git unified diff → file status map
    cli.js                          ← entry point
  dist/
    diagram.html                    ← standalone HTML with embedded SVG
    diagram.svg                     ← for GitHub PR comment image embed
    graph.json                      ← raw graph for debugging
```

**JSON graph schema** (contract between all modules, documented in `src/graph.schema.js`):
```javascript
{
  meta: { scopeDir, generatedAt, nodeCount, edgeCount, diffSha },
  nodes: [{
    id: "users_list_component",        // sanitized: alphanumeric + underscore
    label: "UsersListComponent",
    file: "src/app/features/users/user-list/users-list.component.ts",
    type: "component",
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

Create `package.json` with exact pinned versions:
```json
{
  "type": "module",
  "scripts": { "analyze": "node src/cli.js" },
  "dependencies": {
    "ts-morph": "28.0.0",
    "elkjs": "0.11.1"
  }
}
```

`.npmrc`:
```
save-exact=true
audit-level=high
```

Run `npm install` — commit the resulting `package-lock.json` alongside `package.json`.

---

### Phase 1 — Fake Angular App Fixture (no gate)

**Domain-organized structure** — files are grouped by sub-feature/domain, not by file type. Each domain directory contains whatever it needs (components, services, models together).

No `.spec.ts` files are written. No barrel `index.ts` files (to keep import paths explicit and traceable by the analyzer).

**Target: ~65 in-scope + ~20 out-of-scope = ~85 total nodes**

#### `src/app/features/users/` layout:

```
user-list/           ← sub-feature: listing and browsing
  users-list.component.ts     imports: UserCardComponent, UserFilterComponent,
                               UsersService, UserModel, PaginationComponent(shared)
  user-card.component.ts      imports: UserAvatarComponent, UserStatusPipe, UserModel
  user-filter.component.ts    imports: FilterStateService, FilterModel,
                               SearchComponent(shared)
  user-table-header.component.ts  imports: SortStateService, SortModel
  user-search-results.component.ts  imports: UsersService, UserModel, UserCardComponent
  filter-state.service.ts     imports: FilterModel
  sort-state.service.ts       imports: SortModel
  filter.model.ts
  sort.model.ts
  user-sort.utils.ts          imports: SortModel
  user-search.utils.ts        imports: UserModel, FilterModel

user-detail/         ← sub-feature: viewing a profile
  user-detail.component.ts    imports: UserAvatarComponent, UserRolesBadgeComponent,
                               UsersService, UserModel
  user-profile-header.component.ts  imports: UserModel, UserAvatarComponent
  user-activity-log.component.ts  imports: UserAuditService, AuditEventModel
  user-avatar.component.ts    (standalone, no local deps)
  user-roles-badge.component.ts  imports: RoleModel
  user-audit.service.ts       imports: UserModel, AuditEventModel,
                               AnalyticsService(shared)
  audit-event.model.ts

user-edit/           ← sub-feature: create / edit
  user-edit-dialog.component.ts  imports: UserFormComponent, UsersService, UserModel
  user-create-dialog.component.ts  imports: UserFormComponent, UsersService
  user-form.component.ts      imports: UserModel, ValidationUtils,
                               FormErrorsComponent(shared)
  validation.utils.ts         imports: UserModel
  user-format.utils.ts        imports: UserModel

user-settings/       ← sub-feature: preferences and security
  user-settings.component.ts  imports: UserPreferencesService, UserPreferencesModel
  user-notification-prefs.component.ts  imports: UserPreferencesService,
                               NotificationModel, NotificationService(shared)
  user-security.component.ts  imports: UsersService, AuthService(shared)
  user-preferences.service.ts  imports: UserPreferencesModel, StorageService(shared)
  user-settings.service.ts    imports: UserPreferencesModel, ApiService(shared)
  user-preferences.model.ts
  notification.model.ts

user-permissions/    ← sub-feature: roles and bulk operations
  user-permissions.component.ts  imports: PermissionsService(shared), UserPermissionsModel
  user-bulk-actions.component.ts  imports: BulkActionService, PermissionsService(shared)
  bulk-action.service.ts      imports: UsersService, UserModel
  user-permissions.model.ts
  user-permissions.constants.ts

user-export/         ← sub-feature: exporting user data
  user-export-dialog.component.ts  imports: UserExportService, ExportModel
  user-export.service.ts      imports: UserModel, CsvService(shared)
  export.model.ts

data-access/         ← shared data layer within users feature
  users.service.ts            imports: UserModel, ApiService(shared), UserApiResponseModel
  users-cache.service.ts      imports: UsersService, CacheService(shared)
  user-api-response.model.ts  imports: UserModel
  store/
    user.actions.ts           imports: UserModel
    user.reducer.ts           imports: user.actions, UserModel
    user.selectors.ts         imports: UserModel
    user.effects.ts           imports: user.actions, UsersService
    user.state.ts             imports: UserModel
    user-filter.actions.ts    imports: FilterModel
    user-filter.reducer.ts    imports: user-filter.actions, FilterModel
    user-filter.selectors.ts  imports: FilterModel

shared-ui/           ← pipes and micro-components shared across sub-features
  user-status.pipe.ts         imports: UserStatusModel
  user-role.pipe.ts           imports: RoleModel
  user-initials.pipe.ts       (no local deps)
  user-display-name.pipe.ts   imports: UserModel

models/              ← shared models across sub-features
  user.model.ts
  role.model.ts
  user-status.model.ts
  bulk-action.model.ts

users.routes.ts      imports: all top-level components + guards from user-list,
                     user-detail, user-edit, user-settings, user-permissions
users-page.component.ts  imports: UsersListComponent, UsersBulkActionsComponent
```

**Total in-scope:** ~65 files. No specs, no barrel files.

#### `src/app/shared/` layout (~20 files, realistic library):

```
api/
  api.service.ts              (used by UsersService, UserSettingsService, etc.)
  http-interceptor.ts
  api-error-handler.service.ts
components/
  avatar.component.ts
  badge.component.ts
  spinner.component.ts
  pagination.component.ts
  search.component.ts
  form-errors.component.ts
services/
  permissions.service.ts      (used by UserPermissionsComponent, BulkActionService)
  cache.service.ts            (used by UsersCacheService)
  analytics.service.ts        (used by UserAuditService)
  notification.service.ts     (used by UserNotificationPrefsComponent)
  storage.service.ts          (used by UserPreferencesService)
  csv.service.ts              (used by UserExportService)
  auth.service.ts             (used by UserSecurityComponent)
guards/
  auth.guard.ts
  role.guard.ts
```

Shared files have their own imports to each other (e.g. `auth.service.ts` imports `api.service.ts`) — these do NOT appear in the diagram because we do not recurse into out-of-scope files' imports.

#### Patch files:

**`fake-simple.patch`** — 3 changes for easy comprehension testing:
- `A` add `user-export/user-bulk-export.component.ts` (new file, imports `UserExportService`, `ExportModel`)
- `M` modify `data-access/users.service.ts` (add a method)
- `M` modify `models/user.model.ts` (add a field)

**`fake-complex.patch`** — 8 changes for full UI scenario coverage:
- `A` add `user-export/user-bulk-export.component.ts` (new in-scope file)
- `M` modify `user-list/users-list.component.ts` (adds a new import of `UserSettingsService` already in scope — new edge to existing node)
- `M` modify `data-access/users.service.ts`
- `M` modify `models/user.model.ts`
- `D` delete `user-list/user-search-results.component.ts` (removed → ghost node, red)
- `M` modify `user-detail/user-detail.component.ts` to import `AnalyticsService` from shared (adds a NEW out-of-scope context node)
- `M` modify `user-list/user-filter.component.ts` to drop its import of `SearchComponent` from shared (removes an existing out-of-scope context node)
- `M` modify `src/app/shared/api/api.service.ts` (shared context node is modified — node in the out-of-scope 1-hop layer gets diff color)
- `R` rename `user-list/user-table-header.component.ts` → `user-list/user-sort-header.component.ts`

Both patches use git unified diff format (output of `git format-patch` or `git diff`).

**Verify:** `find fake-angular-app -name "*.ts" | wc -l` → expect ~85

---

### Phase 2 — HTML Renderer (`src/renderer.html`) → Gate 1

Self-contained HTML file. No build step. Loads elkjs from CDN.

**Input:** A hand-authored `window.GRAPH_DATA` JSON file embedded in the page — built by manually writing out the graph structure that matches the fake Angular app. This is not the analyzer output; we write it by hand so we can validate the renderer independently of the analyzer.

**Why elkjs:**
Mermaid degrades above ~50 nodes (edge crossings, unreadable layout). elkjs (Eclipse Layout Kernel, used in VS Code's diagrams) computes precise x/y coordinates and edge bend points. We render the SVG manually from those coordinates, giving full control over node shapes, colors, and label sizing.

**elkjs algorithm selection:**

ELK offers several layout algorithms. For import dependency graphs:

| Algorithm | When to use |
|---|---|
| `layered` (Sugiyama, **default**) | Hierarchical DAGs, directed dependency graphs. Produces clean layers. Best fit for import graphs. |
| `mrtree` | Pure trees (one parent per node). Fails on graphs with shared dependencies — not appropriate here. |
| `force` | Organic/exploratory layouts with no hierarchy. Not appropriate for directed import graphs. |
| `stress` | Similar to force, better for symmetric graphs. Not appropriate here. |

**We use `layered`** with `elk.direction: RIGHT` (entry-point components on left, leaf dependencies on right — matches how dependencies are read). Gate 1 tries both `RIGHT` and `DOWN` to confirm readability.

Key tunable options for `layered`:
```javascript
{
  "algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.layered.spacing.nodeNodeBetweenLayers": "80",
  "elk.spacing.nodeNode": "30",
  "elk.layered.mergeEdges": "true",
  "elk.edgeRouting": "ORTHOGONAL"
}
```

**Renderer pipeline:**
1. Read `window.GRAPH_DATA`
2. Build elkjs input: nodes grouped into `children` arrays by directory, edges as flat array
3. Run `elk.layout(graph)` — returns x/y/width/height per node, bend points per edge
4. Render SVG manually: shapes per `type`, `<path>` per edge, `<text>` labels, `<title>` for hover
5. Apply diff colors: unchanged = `#1e293b`/`#475569`; added = `#14532d`/`#22c55e`; modified = `#78350f`/`#f59e0b`; removed = `#7f1d1d`/`#ef4444` + dashed stroke
6. Sidebar: scope meta, diff legend (color key), changed files list

**Presentation modes (controlled via sidebar toggles):**
- **All nodes** — show every node in the graph
- **Diff-focused** — show only changed nodes + their direct neighbors (1 hop); collapse the rest to labeled directory stubs
- **Clustered** — collapse each directory to a summary box showing only the count and diff status of its contents

These are the scale strategies — not separate datasets. The same ~85-node fake app dataset is used for all three modes.

**Gate 1 — open `src/renderer.html` in browser:**

✅ Pass: `All nodes` mode shows all ~85 nodes without catastrophic overlap; `Diff-focused` mode is clearly more readable than `All nodes` for a PR review context; diff colors are distinguishable; node shapes are recognizable

❌ Fail options (try in order):
1. Tune `elk.layered.spacing` — increase padding until labels stop overlapping
2. Switch `elk.direction` from `RIGHT` to `DOWN`
3. Reduce label font size or truncate with `…` suffix for nodes with long names
4. If elkjs still can't produce a clean layout at 85 nodes: implement the `Clustered` mode as the default and show `All nodes` only as an opt-in

---

### Phase 3 — Analyzer (`src/analyzer.js`) → Gate 2

ts-morph based file parser. ESM module.

**Algorithm:**
1. Detect `tsconfig.json` in repo root; initialize `Project` with it if found (enables path alias resolution); otherwise use `{ skipAddingFilesFromTsConfig: true }` with relative-only fallback
2. Add scope files: `project.addSourceFilesAtPaths(scopeDir + '/**/*.ts')`, remove `.spec.ts`
3. Classify each file by decorator + filename pattern (see table above)
4. Extract imports: use ts-morph's `getModuleSpecifierSourceFile()` per import declaration — this handles relative paths, `baseUrl`, `paths` aliases, and barrel resolution transparently
5. Extract decorator `imports` array: for `@Component` classes, read `imports: [...]`, resolve identifier names to source files via symbol lookup
6. Return raw JSON graph (in-scope nodes + edges only)

`src/filter.js`: follows all in-scope import targets that resolve outside the scope directory; adds them as 1-hop context nodes; does NOT recurse.

**Gate 2:**
```bash
node src/analyzer.js fake-angular-app/src/app/features/users
```

✅ Pass: node count matches `find` output; every node has a valid `type`; specific edges verified (e.g. `UsersListComponent` → `UserCardComponent`, `UsersService`, `UserModel`); shared context nodes present

❌ Fail options:
- Symbol resolution fails for decorator imports → mark as `decorator-import-unresolved`, keep the edge
- Classifier wrong → filename pattern takes priority over decorator detection
- ts-morph parse errors → add `skipFilesWithErrors: true`

---

### Phase 4 — Diff Parser (`src/diff-parser.js`) → Gate 3

Parses `git diff --name-status` / `git format-patch` output.

Status codes: `A` → added, `M` → modified, `D` → removed, `R*` → modified (rename, use new path), `C*` → modified (copy).

Exports: `parseDiffOutput(str)` (string → `Map<filepath, status>`) and `getDiffStatus(repoRoot, sha1, sha2)`.

**Removed files → ghost nodes:** Added to graph with `diff: "removed"` and `scope: "removed-ghost"` even if they don't exist on disk. Only include ghost nodes whose path falls inside the scope directory.

**Path normalization:** git diff paths are repo-relative; analyzer paths are absolute. CLI normalizes both to repo-relative before merging.

**Gate 3 — merge `fake-complex.patch` into graph, reload renderer:**

✅ Pass: All 8 diff scenarios render correctly — new node (green), modified nodes (amber), ghost node (red dashed), new out-of-scope context node (green, out-of-scope style), removed out-of-scope context node (absent), modified out-of-scope node (amber, out-of-scope style), renamed node correctly labeled

❌ Fail: Use `fake-simple.patch` first (3 scenarios) to isolate basic rendering, then progress to complex.

---

### Phase 5 — CLI Entry Point (`src/cli.js`) → Gate 4

```bash
node src/cli.js \
  --patch fake-angular-app/fake-complex.patch \
  --out-dir dist \
  fake-angular-app/src/app/features/users
```

Outputs: `dist/diagram.html`, `dist/diagram.svg`, `dist/graph.json`.

**Gate 4:**

✅ Pass: HTML opens, node count matches `graph.json`, all 8 diff scenarios from `fake-complex.patch` visible with correct colors, SVG renders cleanly when opened in a browser and when embedded in a GitHub Markdown preview

---

### Phase 6 — Polish (only after all gates pass)
- Zoom/pan via SVG `transform` + mouse/wheel events
- `--cluster` flag: collapse directories with >N unchanged nodes to summary boxes
- `--focus` flag: show only diff nodes + N-hop neighbors (default 1)

---

## Risks

| Risk | Mitigation |
|---|---|
| elkjs `layered` produces too-dense layout at 85 nodes | Tune spacing in Gate 1; fall back to `Clustered` mode as default |
| Decorator `imports` array symbol resolution fails | Mark as unresolved edge kind; don't block the graph |
| tsconfig path aliases not detected | Default to relative-only resolution; add `--tsconfig` flag for explicit override |
| Renamed files create two nodes (ghost + new) | Detect `R*` status: do not add ghost for old path, add new path as added |
| Modified out-of-scope context nodes not in analyzer output | Add ghost-node logic for diff entries whose paths are outside scope but appear as existing context nodes |
| SVG label overflow | Truncate at ~25 chars with `…`; show full name in SVG `<title>` (tooltip) |

---

## Reused from Prototype (`index.html`)
- Dark theme CSS variables and color palette  
- Diff state color scheme (added/modified/removed/unchanged)
- Sidebar card layout and legend structure
