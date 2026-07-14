# Audit Follow-up: Grouped Bug/Gap Fixes

> **Source:** `docs/audit/2026-07-07-codebase-audit.md` (2026-07-07 codebase audit), triaged by
> Thomas Stapleton via crit review on 2026-07-14. This document is the durable record of the
> items marked "please fix as suggested" — the audit file itself will eventually be deleted.
>
> **REQUIRED SUB-SKILL:** Use `superpowers:executing-plans` or `superpowers:subagent-driven-development`
> to implement. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Commit policy exception:** per direction from Thomas Stapleton (2026-07-14), this batch does
> **not** follow the repo's normal one-logical-change-per-commit rule. Related and small items are
> intentionally grouped into a single commit per group below. Each group is still its own PR-sized
> unit of work — do not merge groups together.

## Group 1 — CLI input robustness (`src/cli.ts`)

Both items are boundary-validation gaps in argument handling; group into one commit.

- [ ] **BUG-02: Implement `--repo-root` auto-detection via `.git`**
  - **Location:** `src/cli.ts:97-104` (`_detectRepoRoot`, never called), `src/cli.ts:198`
  - **Problem:** `spec.md`, `README.md:31`, and the CLI's own `--help` text all document
    `--repo-root` as "auto-detected via `.git`". The detection function `_detectRepoRoot` exists
    but is dead code — `main()` falls back to `process.cwd()` instead. Running from a repo
    subdirectory without `--repo-root` silently produces wrong node IDs and a diff where nothing
    matches.
  - **Fix:** Wire it up — `const repoRoot = args.repoRoot ? path.resolve(args.repoRoot) : detectRepoRoot(process.cwd());` (drop the leading underscore from the function name).
  - **Also resolves DOC-02** (spec/README/help already document this behavior correctly — no doc
    changes needed once implemented).
  - **Verification:** Unit test `detectRepoRoot` (walks up to a dir containing `.git`, falls back
    to start dir if none found). Manual: `cd fake-angular-app/src && node ../../dist/cli.js app/features/users`
    should resolve the same repo root as running from `fake-angular-app/`.

- [ ] **GAP-02: Validate parsed CLI arguments**
  - **Location:** `src/cli.ts:54-93` (`parseArgs`)
  - **Problem:** No validation of flag values or unknown flags. `--out-dir` as the last token sets
    `args.outDir = undefined` (crashes later with a confusing `TypeError` from `path.resolve`). A
    misspelled flag (e.g. `--base-repo`) is silently ignored *and* its value becomes the
    positional `scopeDir`, silently rebinding what gets diagrammed. Multiple positionals: last one
    wins with no warning.
  - **Fix:** In each flag branch, error if `argv[++i]` is `undefined` or starts with `-`. Add a
    final `else` for unrecognized `-`-prefixed tokens that prints help and exits 1. Error if a
    second positional appears.
  - **Verification:** Unit tests for `parseArgs` (export it): missing value, unknown flag, double
    positional each produce an error; the happy path still parses as before.
  - **Follow-up issue:** file a separate GitHub issue to evaluate replacing the hand-rolled parser
    with a CLI argument library (see issue list below) — out of scope for this fix itself.

**Files touched:** `src/cli.ts`, `src/cli.test.ts` (or equivalent)

---

## Group 2 — Analyzer path/ID correctness (`src/analyzer.ts`, `src/renderer/graph-helpers.ts`)

Both items are string/path-handling bugs that can silently corrupt the graph (dropped edges,
collided node IDs); group into one commit.

- [ ] **BUG-03: Scope membership needs a path-separator guard**
  - **Location:** `src/analyzer.ts:153`, `src/analyzer.ts:179`, `src/analyzer.ts:198`
  - **Problem:** In/out-of-scope classification uses raw prefix checks:
    `sf.getFilePath().startsWith(scopeDir)` / `!targetPath.startsWith(scopeDir)`. A sibling
    directory sharing the prefix — e.g. scope `/repo/src/app/features/users` and neighbor
    `/repo/src/app/features/users-admin` — passes the check. Concrete failure: an in-scope file
    imports `/repo/.../users-admin/roles.service.ts`. It's not in `nodeIdByFile` and
    `targetPath.startsWith(scopeDir)` is (wrongly) true, so the `else if` OOS branch in `addEdge`
    also fails — the edge is silently dropped entirely (no in-scope edge, no OOS node).
  - **Fix:** Compare against `scopeDir + path.sep`:
    `const inScope = (p: string) => p === scopeDir || p.startsWith(scopeDir + path.sep);` — use it
    in all three places.
  - **Verification:** Analyzer integration test (same tmp-dir pattern as the existing `analyze`
    integration test) with scope `features/users` and a sibling `features/users-admin` imported
    from in-scope; assert the import appears as an OOS edge/node instead of vanishing.

- [ ] **BUG-11: ID sanitization can collide distinct files/directories onto one node ID**
  - **Location:** `src/analyzer.ts:49-56` (`toNodeId`), `src/renderer/graph-helpers.ts:110-115`
    (`sanitize` for stub IDs)
  - **Problem:** All non-alphanumerics collapse to `_` with run-deduplication, so
    `user-list.component.ts` and `user.list.component.ts` (or dirs `shared/api` vs `shared-api`)
    map to the same ID. Two nodes with the same ID break edge attribution, ELK layout (duplicate
    child IDs), and hover targeting. Same risk for two OOS stub IDs colliding in diff-focused mode.
  - **Fix:** On collision, disambiguate deterministically — append a short hash of the raw path
    (`_${hash(file).slice(0,6)}`) when a generated ID is already taken. Track a `Map<id, file>`
    during node construction in `analyze` (and stub creation in `computeViewNodes`).
  - **Verification:** Unit test: two files whose sanitized paths collide must yield distinct node
    IDs, and the graph must contain both nodes with correctly attributed edges.

**Files touched:** `src/analyzer.ts`, `src/renderer/graph-helpers.ts`, plus their test files

---

## Group 3 — HTML artifact injection fix (`src/cli.ts`)

Standalone: a correctness bug in how the diagram payload is embedded, worth its own commit and
its own regression test.

- [ ] **BUG-04: `buildHtml` uses `String.replace` with JSON as a replacement pattern**
  - **Location:** `src/cli.ts:185` (`buildHtml`)
  - **Problem:** `template.replace("__DIFF_DIAGRAM_DATA__", JSON.stringify(data))` treats the
    second argument as a replacement *pattern* — `$&`, `` $` ``, `$'`, `$$` sequences inside the
    JSON get expanded (e.g. `$&` becomes the matched string `__DIFF_DIAGRAM_DATA__`). Any node
    label, file path, or imported name containing such a sequence yields corrupt embedded JSON and
    a blank diagram. Related latent issue: `JSON.stringify` doesn't escape `</script>`, so a
    string containing it would terminate the script block early.
  - **Fix:** Use a function replacement, which is taken literally:
    `template.replace("__DIFF_DIAGRAM_DATA__", () => json)`. For the `</script>` case, serialize
    with `JSON.stringify(data).replaceAll("</", "<\\/")` before embedding.
  - **Verification:** Unit test `buildHtml` with a data object containing a label of
    `"$& $' $$"` and `"</script>"`; parse the emitted HTML's embedded JSON back out and assert
    round-trip equality.

**Files touched:** `src/cli.ts`, `src/cli.test.ts`

---

## Group 4 — Visual regression self-approve guard (`src/renderer/visual.test.ts`)

Standalone test-infra behavior change. Per direction from Thomas Stapleton: **keep the check
simple** — don't over-engineer this into a full bootstrap-mode flag system beyond what's needed.

- [ ] **GAP-04: Visual regression test silently self-approves when the reference snapshot is missing**
  - **Location:** `src/renderer/visual.test.ts:48-52` (`compareWithSnapshot`)
  - **Problem:** If `test/snapshots/reference/<name>.png` is absent, the current render is written
    *as* the reference and the test returns 0 (pass). On a fresh clone or CI where references were
    lost, or when a new snapshot name is introduced, a rendering regression is silently baptized as
    the new baseline — the inverse of this repo's "never approve snapshots without explicit user
    instruction" rule.
  - **Fix (keep it simple):** Fail with a clear message ("no reference snapshot — run
    `npm run test:visual:approve` after review") when the reference file is missing, instead of
    writing it and passing. Don't add an env-var bootstrap escape hatch unless it turns out to be
    needed — approval is already a manual, explicit `npm run test:visual:approve` step.
  - **Verification:** Delete a reference PNG locally and run `npm run test:visual` — must fail
    with the explanatory message, not pass.

**Files touched:** `src/renderer/visual.test.ts`

---

## Group 5 — Small mechanical cleanup batch

Three small, low-risk, low-lift fixes across unrelated files. Bundled into one commit because none
is individually commit-worthy.

- [ ] **GAP-09: `.DS_Store` files are not gitignored**
  - **Location:** `.gitignore`
  - **Problem:** `git status` shows untracked `test/.DS_Store` and `test/fixtures/.DS_Store`; they
    will eventually get swept into a commit by a broad `git add`.
  - **Fix:** Add `.DS_Store` to `.gitignore`.
  - **Verification:** `git status` no longer lists them.

- [ ] **IMP-06: `GraphMeta.diffSha` is a dead field**
  - **Location:** `src/types.ts:43`, `src/analyzer.ts:284`, `docs/architecture.md:41`
  - **Problem:** `diffSha` is always set to `null` in `analyze` and never populated by anything
    (the tool is git-agnostic by design, so nothing *can* populate it today). It's schema noise
    that misleads `graph.json` consumers into expecting a real SHA.
  - **Fix:** Delete the field from `GraphMeta`, the `analyze` initializer, and the
    architecture.md type listing. (If the GitHub Action later wants it, it can be reintroduced
    with an actual producer.)
  - **Verification:** `npm run verify` green; `graph.json` no longer contains `diffSha`.

- [ ] **GAP-07: Removed edges lose `typeOnly` and `importedNames` metadata**
  - **Location:** `src/diff-parser.ts:124-131` (removed-edge reconstruction)
  - **Problem:** Removed edges are rebuilt from scratch, copying only `from`/`to`/`kind`/`diff` and
    dropping the base edge's `typeOnly` flag and `importedNames`. A removed type-only import
    renders as a solid removed edge instead of the dashed type-only style, and `graph.json`
    consumers can't see what was removed. Everything needed is already available on the base edge
    at that point.
  - **Fix:** Spread the base edge's optional fields:
    `{ from: fromId, to: toId, kind: e.kind, diff: "removed", ...(e.typeOnly ? { typeOnly: true } : {}), ...(e.importedNames ? { importedNames: e.importedNames } : {}) }`.
  - **Verification:** `diff-parser` unit test: a base edge with `typeOnly: true` that's removed in
    current must retain `typeOnly` and `importedNames` on the resulting removed edge.

**Files touched:** `.gitignore`, `src/types.ts`, `src/analyzer.ts`, `docs/architecture.md`, `src/diff-parser.ts`, `src/diff-parser.test.ts`

---

## Explicitly out of scope for this document

The following audit items were triaged separately and are **not** part of this plan:

- Marked "done" in review (already fixed prior to this triage): BUG-05, BUG-06, BUG-07, PERF-01,
  PERF-02, BUG-01, GAP-01, GAP-05, GAP-08, DOC-01 through DOC-07.
- Marked "skip it" (accepted risk, no action planned): BUG-08, BUG-09, BUG-10, GAP-06, IMP-01,
  IMP-02, FEATURE-05.
- Spun off as standalone GitHub issues instead of grouped here (each deletes cleanly with the
  audit doc since the issue carries full context): GAP-03, IMP-04, IMP-05, FEATURE-01, FEATURE-02,
  FEATURE-03, FEATURE-04, FEATURE-06, plus a new "evaluate a CLI argument-parsing library" issue
  spun off from GAP-02.

## Validation

- `npm run verify` green after each group's commit.
- Gate 2 (`node dist/cli.js --repo-root fake-angular-app --base-repo-root fake-angular-app-base src/app/features/users`) still runs clean after each group.
