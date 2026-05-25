# Plan: Angular Architecture Diff Diagram Tool

## Context

We are building a CLI tool that takes an Angular "vertical slice" feature directory, parses all TypeScript files in it using ts-morph, adds one hop of context (files outside the scope that scope files directly import), overlays git diff status, and renders a component diagram. The intended use is as a PR review aid — showing what changed and how it fits in the architecture.

User priorities:
- **No Mermaid** — flat Mermaid is known to degrade badly above ~50 nodes and we will comfortably exceed that. Use elkjs for layout and SVG for output.
- HTML preview tool and SVG image as the two outputs (SVG embeds in GitHub PR comments as an image)
- Modern Angular with standalone components
- All `.ts` files as nodes (including utils/constants/models) — not just Angular-decorated files
- Incremental development with hard validation gates — **if a gate fails, we change approach, not skip**

---

## Node Granularity Considerations

**All `.ts` files are nodes** (except `.spec.ts`, `.scss`, `.html`). The user wants to see where utils, constants, and models are used — not just Angular-decorated entry points.

**Quick count for any existing feature directory:**
```bash
find <scope-dir> -name "*.ts" ! -name "*.spec.ts" | wc -l
```

Node counts vary widely. Rather than assuming a target, the renderer must be validated at **three scales**: ~50, ~100, and ~200 nodes. The fake Angular app must be large enough to cover the 100-node case; a second larger fixture covers 200.

**File type classification** (determines grouping/shape — NOT color; color is reserved for diff state):

| Type | Detection |
|---|---|
| `component` | `@Component(...)` decorator |
| `service` | `@Injectable(...)` + not guard/resolver/interceptor |
| `pipe` | `@Pipe(...)` decorator |
| `guard` | `@Injectable` + `*.guard.ts` filename |
| `resolver` | `@Injectable` + `*.resolver.ts` filename |
| `interceptor` | `@Injectable` + `*.interceptor.ts` filename |
| `routing` | `*.routes.ts` filename |
| `module` | `@NgModule(...)` decorator (legacy) |
| `model` | No decorator, `*.model.ts` / `*.interface.ts` / only `interface`/`type` exports |
| `constants` | No decorator, only constant/function exports |

**Visual encoding:**
- **Color** = diff state only: green (added), amber (modified), red (removed), dim gray (unchanged)
- **Shape** = file type: rectangle (component), rounded (service), diamond (guard/resolver), ellipse (pipe), plain (model/constants)
- **Subgraph** = directory grouping within scope

**Standalone Angular specifics** (modern pattern):
- `@Component({ standalone: true, imports: [OtherComponent, SomePipe] })` — the `imports` array is a runtime dependency list (what the template actually uses), distinct from TypeScript-level imports
- Both layers must be captured: TypeScript file imports (graph edges) + decorator `imports` array (annotated as `decorator-import` edge kind)
- Decorator import array elements are identifier names — must resolve name → file path via ts-morph symbol lookup

**1-hop context — exact definition:**
Everything inside the scope directory is shown. Those files import other files that live outside the scope directory. Show those external import targets as context nodes, but do not recurse into their imports. Stop at one level outside.

In practice: if `src/app/features/users/users.service.ts` imports `src/app/shared/api/api.service.ts`, then `api.service.ts` appears in the diagram as a context node. `api.service.ts`'s own imports do NOT appear.

Framework/npm packages (`@angular/`, `rxjs`, etc.) are not files on disk — they resolve as external modules and are excluded automatically by filtering to relative imports only.

---

## File Structure

```
diff-diagram/
  index.html                        ← existing prototype (design language reference)
  package.json                      ← type: module, deps: ts-morph, elkjs
  fake-angular-app/
    src/app/features/users/         ← 70-80 hand-crafted .ts files across subdirs
      components/                   ← ~20 component files
      services/                     ← ~10 service files
      models/                       ← ~12 model/interface files
      guards/                       ← ~4 guard/resolver files
      pipes/                        ← ~4 pipe files
      utils/                        ← ~6 utility/constant files
      store/                        ← ~8 NgRx-style store files (actions/reducer/selectors/effects)
      users.routes.ts
    src/app/shared/                 ← 20-25 files (realistic shared library)
      api/                          ← api.service.ts, http-client.service.ts, interceptors
      components/                   ← shared UI components (avatar, badge, spinner, etc.)
      services/                     ← permissions.service.ts, cache.service.ts, analytics.service.ts
      models/                       ← shared models and enums
      guards/                       ← auth.guard.ts, role.guard.ts
    fake.patch                      ← git unified diff / patch file simulating a PR
  src/
    renderer.html                   ← HTML renderer: reads window.GRAPH_DATA, renders via elkjs → SVG
    analyzer.js                     ← ts-morph parser → raw JSON graph
    filter.js                       ← scope + 1-hop expansion
    diff-parser.js                  ← git unified diff → file status map
    cli.js                          ← entry point: wires all modules
  dist/                             ← generated outputs
    diagram.html                    ← standalone HTML with embedded SVG
    diagram.svg                     ← SVG for GitHub PR comment image embed
    graph.json                      ← raw graph for debugging
```

**JSON graph schema** (contract shared between all modules):
```javascript
{
  meta: { scopeDir, generatedAt, nodeCount, edgeCount, diffSha },
  nodes: [{
    id: "users_list_component",        // sanitized: alphanumeric + underscore only
    label: "UsersListComponent",       // display name
    file: "src/app/features/users/components/users-list.component.ts",
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

Create hand-crafted `.ts` files for a "users" feature with subdirectories. Files must have real TypeScript import statements and Angular decorator syntax so ts-morph can parse them. Bodies can be stubs.

**Target: ~75 in-scope files + ~20 out-of-scope shared files = ~95 total nodes**

This covers the 100-node scale test. The same fake app can be filtered to sub-directories for the 50-node test.

**`src/app/features/users/` breakdown:**

`components/` (~20 files):
- `users-list.component.ts` — imports UserCardComponent, UserFilterComponent, UsersService, UserModel, PaginationComponent (shared)
- `user-detail.component.ts` — imports UserAvatarComponent, UserRolesBadgeComponent, UsersService, UserModel
- `user-card.component.ts` — imports UserAvatarComponent, UserStatusPipe, UserModel
- `user-filter.component.ts` — imports FilterStateService, FilterModel, SearchComponent (shared)
- `user-avatar.component.ts` — standalone, no local deps
- `user-roles-badge.component.ts` — imports RoleModel
- `user-create-dialog.component.ts` — imports UserFormComponent, UsersService
- `user-edit-dialog.component.ts` — imports UserFormComponent, UsersService, UserModel
- `user-form.component.ts` — imports UserModel, ValidationUtils, FormErrorsComponent (shared)
- `user-bulk-actions.component.ts` — imports BulkActionService, PermissionsService (shared)
- `user-table-header.component.ts` — imports SortStateService, SortModel
- `user-permissions.component.ts` — imports PermissionsService (shared), UserPermissionsModel
- `user-activity-log.component.ts` — imports UserAuditService, AuditEventModel
- `user-export-dialog.component.ts` — imports UserExportService, ExportModel
- `user-search-results.component.ts` — imports UsersService, UserModel, UserCardComponent
- `user-profile-header.component.ts` — imports UserModel, UserAvatarComponent
- `user-settings.component.ts` — imports UserPreferencesService, UserPreferencesModel
- `user-notification-prefs.component.ts` — imports UserPreferencesService, NotificationModel
- `user-security.component.ts` — imports UserService, AuthService (shared)
- `users-page.component.ts` — imports UsersListComponent, UsersBulkActionsComponent

`services/` (~10 files):
- `users.service.ts` — imports UserModel, ApiService (shared), UserApiResponseModel
- `users-cache.service.ts` — imports UsersService, CacheService (shared)
- `filter-state.service.ts` — imports FilterModel
- `sort-state.service.ts` — imports SortModel
- `bulk-action.service.ts` — imports UsersService, UserModel
- `user-preferences.service.ts` — imports UserPreferencesModel, StorageService (shared)
- `user-export.service.ts` — imports UserModel, CsvService (shared)
- `user-audit.service.ts` — imports UserModel, AuditEventModel, AnalyticsService (shared)
- `user-notifications.service.ts` — imports NotificationModel, NotificationService (shared)
- `user-settings.service.ts` — imports UserPreferencesModel, ApiService (shared)

`models/` (~12 files):
- `user.model.ts`, `role.model.ts`, `filter.model.ts`, `sort.model.ts`
- `user-status.model.ts`, `audit-event.model.ts`, `bulk-action.model.ts`
- `user-preferences.model.ts`, `user-api-response.model.ts`, `export.model.ts`
- `notification.model.ts`, `user-permissions.model.ts`

`guards/` (~4 files):
- `user-edit.guard.ts` — imports UsersService, PermissionsService (shared)
- `user-admin.guard.ts` — imports PermissionsService (shared), RoleModel
- `user-feature.guard.ts` — imports UserPreferencesService
- `user-detail.resolver.ts` — imports UsersService, UserModel

`pipes/` (~4 files):
- `user-status.pipe.ts`, `user-role.pipe.ts`, `user-initials.pipe.ts`, `user-display-name.pipe.ts`

`utils/` (~6 files):
- `api-endpoints.constants.ts`, `user-permissions.constants.ts`
- `validation.utils.ts` — imports UserModel
- `user-sort.utils.ts` — imports SortModel
- `user-format.utils.ts` — imports UserModel
- `user-search.utils.ts` — imports UserModel, FilterModel

`store/` (~8 files, NgRx-style):
- `user.actions.ts` — imports UserModel
- `user.reducer.ts` — imports user.actions, UserModel
- `user.selectors.ts` — imports UserModel
- `user.effects.ts` — imports user.actions, UsersService
- `user.state.ts` — imports UserModel
- `user-filter.actions.ts` — imports FilterModel
- `user-filter.reducer.ts` — imports user-filter.actions, FilterModel
- `user-filter.selectors.ts` — imports FilterModel

`users.routes.ts` — imports all components, guards, resolvers

**`src/app/shared/` breakdown (~20 files — realistic shared library):**

`api/`:
- `api.service.ts` — core HTTP wrapper, used by many features
- `http-interceptor.ts` — auth token injection
- `api-error-handler.service.ts`

`components/`:
- `avatar.component.ts`, `badge.component.ts`, `spinner.component.ts`
- `pagination.component.ts`, `search.component.ts`, `form-errors.component.ts`

`services/`:
- `permissions.service.ts`, `cache.service.ts`, `analytics.service.ts`
- `notification.service.ts`, `storage.service.ts`, `csv.service.ts`
- `auth.service.ts`

`guards/`:
- `auth.guard.ts`, `role.guard.ts`

**fake.patch** — git unified diff format (standard `.patch` file), simulating a PR that:
- Adds `user-bulk-actions.component.ts` (new file)
- Modifies `users.service.ts` (adds a method)
- Modifies `user.model.ts` (adds a field)
- Removes `user-modal.component.ts` (deleted file, becomes red ghost node)

Format:
```
diff --git a/src/app/features/users/... b/src/app/features/users/...
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/app/features/users/components/user-bulk-actions.component.ts
...
```

**Verify:** `find fake-angular-app -name "*.ts" ! -name "*.spec.ts" | wc -l` → expect ~95

---

### Phase 2 — HTML Renderer (`src/renderer.html`) → Gate 1

Self-contained HTML file. No build step — open directly in a browser. Loads elkjs from CDN, takes an embedded `window.GRAPH_DATA`, and renders as SVG.

**Why elkjs instead of Mermaid:**
Mermaid degrades badly above ~50 nodes (edge crossings, unreadable labels). elkjs (Eclipse Layout Kernel) is an industrial-grade hierarchical layout engine used in VS Code's extension API. It runs in the browser, produces x/y coordinates, and we render the SVG by hand. Full control over node shapes, colors, and edge routing.

**Renderer pipeline:**
1. Read `window.GRAPH_DATA`
2. Group nodes into elkjs `children` by directory (subgraphs)
3. Run `elk.layout(graph)` — produces x/y/width/height for every node and edge bend points
4. Render SVG manually: `<rect>` / `<ellipse>` / `<polygon>` per node type, `<path>` per edge, `<text>` labels
5. Apply diff colors: unchanged = `#1e293b` fill / `#475569` stroke; added = `#14532d` fill / `#22c55e` stroke; modified = `#78350f` fill / `#f59e0b` stroke; removed = `#7f1d1d` fill / `#ef4444` stroke + dashed border
6. Sidebar: scope meta, diff legend, changed files list

**Scale tests embedded in renderer.html:**
Use a dropdown or button set to switch between three hardcoded datasets:
- **50 nodes** — subset of fake app (users/components + users/services)
- **100 nodes** — full fake app (all users/ + shared/)
- **200 nodes** — two feature slices side by side (duplicate the graph with renamed IDs)

**Gate 1 — open `src/renderer.html` in browser, test all three scale buttons:**

✅ Pass: At 50 nodes — all labels readable, no overlapping text; at 100 nodes — still navigable with acceptable density; at 200 nodes — groups are distinguishable even if individual labels are small

❌ Fail options (try in order):
1. Reduce node label font size or abbreviate labels at higher node counts
2. Add zoom/pan (SVG `viewBox` manipulation or `transform` scaling via mouse wheel)
3. Increase padding/spacing in elkjs layout options (`elk.spacing.nodeNode`, `elk.layered.spacing.edgeEdgeBetweenLayers`)
4. If elkjs can't handle 200 nodes without catastrophic overlap: implement domain clustering (collapse unchanged directories into summary nodes) before the analyzer phase

---

### Phase 3 — Analyzer (`src/analyzer.js`) → Gate 2

ts-morph based file parser. ESM module.

**Algorithm:**
1. `Project.addSourceFilesAtPaths(scopeDir + '/**/*.ts')`, remove `.spec.ts` files
2. Classify each file by decorator + filename pattern (see table above)
3. Extract TypeScript imports: **relative paths only** (`./*` or `../*`), resolve to absolute file path
4. Extract decorator `imports` array for `@Component` classes — resolve identifier names to file paths via ts-morph symbol resolution
5. Return raw graph (in-scope nodes + edges, no 1-hop expansion)

`src/filter.js` called after: follows all in-scope import targets that resolve outside the scope directory, adds them as 1-hop context nodes. Does NOT recurse into their imports.

**Gate 2 — `node src/analyzer.js fake-angular-app/src/app/features/users`:**

✅ Pass: Node count matches `find` output, every node has a valid `type`, specific edges verified (e.g. `UsersListComponent` → `UserCardComponent`, `UsersService`, `UserModel`), 1-hop shared nodes present

❌ Fail options:
- Decorator import resolution fails → mark edges as `kind: "decorator-import-unresolved"`, still include them
- Classifier wrong → prefer filename-pattern as primary, decorator detection as secondary
- ts-morph parse errors → add `skipFilesWithErrors: true` to Project config

---

### Phase 4 — Diff Parser (`src/diff-parser.js`) → Gate 3

Parses git unified diff / patch format (output of `git diff --name-status` or a `.patch` file).

```
A\tsrc/app/features/users/components/user-bulk-actions.component.ts  → "added"
M\tsrc/app/features/users/services/users.service.ts                  → "modified"
D\tsrc/app/features/users/components/user-modal.component.ts         → "removed"
R090\told.ts\tnew.ts                                                   → "modified" (rename)
```

Exports: `parseDiffOutput(str)` (string → `Map<filepath, status>`) and `getDiffStatus(repoRoot, sha1, sha2)` (shells out to `git diff --name-status`).

**Removed files:** Must appear as "ghost nodes" in the graph even if they no longer exist on disk — added from the diff with `diff: "removed"` and `scope: "removed-ghost"`.

**Path normalization:** git diff produces repo-relative paths; analyzer produces absolute paths. CLI normalizes both to repo-relative before merging.

**Gate 3 — merge `fake.patch` into graph, reload renderer:**

✅ Pass: Added = green, Modified = amber, Removed = red dashed border, Unchanged = dim. Legend matches.

❌ Fail: Ghost nodes for removed files should only appear if they were in the scope — add a check in `mergeDiff` to skip ghost nodes for paths outside the scope directory.

---

### Phase 5 — CLI Entry Point (`src/cli.js`) → Gate 4

```bash
node src/cli.js \
  --patch fake-angular-app/fake.patch \
  --out-dir dist \
  fake-angular-app/src/app/features/users
```

**Flow:** analyze → 1-hop filter → parse diff → merge diff → render SVG → write outputs

**Outputs in `dist/`:**
- `diagram.html` — always (embeds GRAPH_DATA + SVG inline, fully self-contained)
- `diagram.svg` — always (for GitHub PR comment: `![Architecture diff](./diagram.svg)`)
- `graph.json` — always (for debugging)

No Mermaid output. SVG is the distribution format.

**Gate 4 — run CLI, open `dist/diagram.html`:**

✅ Pass: HTML opens without error, node count matches `graph.json`, diff colors on correct nodes, sidebar shows correct file change counts, `diagram.svg` renders in GitHub Markdown preview

❌ Fail: Add `--debug` flag logging each file's classification and imports. Check path normalization between patch and analyzer with intermediate JSON dumps.

---

### Phase 6 — Polish (only after all gates pass)
- Zoom/pan in renderer.html via SVG `transform` + mouse events
- "Changed + neighbors only" toggle: collapse unchanged nodes, expand only diff nodes + 1 hop
- `--cluster` flag: collapse each directory into a summary node when >N files in it (configurable threshold)

---

## Risks

| Risk | Mitigation |
|---|---|
| elkjs layout quality at 200 nodes | Test in Gate 1; tune `elk.spacing` options; fall back to domain clustering |
| Decorator `imports` array symbol resolution fails | Mark as `decorator-import-unresolved`; don't block the graph |
| Barrel file (`index.ts`) indirection | ts-morph `getModuleSpecifierSourceFile()` resolves through barrels automatically |
| Removed files (ghost nodes) missing from analyzer output | Add ghost nodes explicitly from diff in `mergeDiff` step |
| git diff path vs. analyzer absolute path mismatch | Normalize all paths to repo-relative in CLI before merging |
| SVG text overflow at small node sizes | Truncate labels with ellipsis; show full label on hover via `<title>` element |

---

## Reused from Prototype (`index.html`)
- Dark theme CSS variables and color palette
- Diff state color scheme (added/modified/removed/unchanged)
- Sidebar card layout and legend structure
