# Diff-representable facts — brainstorm reference

**What this is:** An exhaustive, codebase-blind brainstorm of every kind of fact a
PR-review dependency diagram like diff-diagram could conceivably want to visually
represent. Generated 2026-08-19 while scoping GitHub issue #63 ("Revisit edge line
styling"). A subagent was given only a description of what diff-diagram does
(Angular feature diff → dependency graph diagram, nodes = files, edges = imports)
and asked to brainstorm broadly — deliberately *without* reading any code — so the
list wouldn't be anchored to what's already implemented. The goal was to catch
gaps that a codebase-focused audit would structurally miss, since an audit can
only tell you what's there, not what's absent.

**How to use this:** This is a raw idea-generation artifact, not a spec and not a
backlog — it was **not** vetted against the actual implementation. Most items
below are either already handled, partially handled, or would require
substantial new analysis (cycle detection, git rename detection, CODEOWNERS
integration, etc.) to build — don't assume something listed here is a real gap
without checking the code first. Before treating anything here as "missing,"
cross-reference `docs/architecture.md`, `docs/glossary.md`, `src/renderer/render.ts`,
`src/diff-parser.ts`, and `src/analyzer.ts`.

**Companion document:** this brainstorm was produced alongside a codebase visual-
encoding audit covering the current node/edge/container rendering and doc
accuracy (produced in the same investigation, see the PR that references this
file for its contents, or re-run the same investigation prompt against the
current codebase state).

---

## 1. File/Node-Level Facts

- **File added** — A file exists on the PR branch but not the base branch. *Reviewer wants to know what new surface area they're approving.*
- **File removed** — A file existed on base but is gone on the PR branch. *Removed files can break unseen consumers or silently drop functionality.*
- **File modified** — Same path exists on both branches with different content. *The core "what changed" signal — where to actually read the diff.*
- **File renamed/moved (vs. delete+add)** — Content is substantially the same but the path changed. *Without rename detection, a pure move looks like a scary delete + a scary add, wasting reviewer attention.*
- **Change magnitude** — How much of the file's content changed (lines touched, % rewritten). *Distinguishes a one-line tweak from a near-total rewrite masquerading as a "modified" file.*
- **Whitespace/formatting-only change** — The diff has no semantic content (reformatting, import sorting). *Lets a reviewer skip noise instead of re-reading unchanged logic.*
- **Comment/JSDoc-only change** — Only documentation changed, code is identical. *Low-risk change that can be skimmed rather than scrutinized.*
- **Exported API surface changed** — The set of symbols a file exports grew or shrank, independent of internal logic changes. *Export changes ripple to every importer; internal-only changes don't.*
- **Newly a barrel/re-export file** — A file didn't previously just re-export others, but now does (or vice versa). *Barrels obscure the real dependency graph and silently widen what's importable.*
- **Angular decorator metadata changed** — `@Component`/`@Directive`/`@Injectable` config changed (selector, inputs/outputs, providers, changeDetection). *These changes affect template bindings and DI wiring in ways invisible to a pure import diff.*
- **Dependency-injection providers changed** — A file's constructor-injected services were added/removed/reordered. *Signals new runtime dependencies and possible test-mocking gaps.*
- **Newly/no-longer deprecated** — A `@deprecated` marker was added or removed on the file or its exports. *Flags consumers that should migrate, or confirms a planned deprecation landed.*
- **Test coverage changed** — The file gained, lost, or had its associated unit test modified. *Untested new/changed logic is a direct risk signal.*
- **Story coverage changed** — The file gained, lost, or had its associated Storybook story modified. *For UI components, missing visual coverage is a review gap.*
- **Co-located template/style change with no `.ts` import change** — An Angular component's `.html`/`.scss` changed but its dependency graph didn't move. *Purely visual/behavioral changes are invisible to an import-only diff and could be missed entirely.*
- **File newly a change-magnitude outlier** — This file's diff size is statistically much larger than the rest of the PR. *Flags the one file that deserves disproportionate reviewer attention.*
- **Generated vs. hand-written** — The file is codegen output (e.g. GraphQL types, OpenAPI clients) vs. authored code. *Generated diffs usually don't need line-by-line human review; hand-written ones do.*

## 2. Edge/Import-Level Facts

- **Edge added** — A new file-to-file import relationship exists that didn't before. *A new coupling point — does it make architectural sense?*
- **Edge removed** — An import relationship that existed on base is gone. *Confirms intended decoupling, or flags an accidental drop of a needed dependency.*
- **Imported symbols changed on an existing edge** — Same two files still connected, but the specific named imports differ. *The dependency looks unchanged at a glance, but what's actually being used from the target shifted.*
- **Type-only ↔ value import** — An import switched between `import type {}` and a regular value import. *A value import can carry runtime cost and creates a real (not just compile-time) coupling; the direction of this switch matters.*
- **Default/named/namespace import style changed** — The shape of the import statement changed without the target changing. *Usually cosmetic, but can signal an API shape change on the target module.*
- **Relative path ↔ alias path** — Import switched between `../../foo` and a path-alias/barrel form. *Pure refactor, not a new dependency — reviewer shouldn't mistake it for a structural change.*
- **Import direction reversed** — A used to import B; now B imports A. *A classic sign of a layering violation or a newly introduced cycle.*
- **Dynamic import added/removed** — An `import()` lazy-load boundary appeared or disappeared. *Affects bundle splitting and load-time behavior, not just static structure.*
- **Side-effect-only import added/removed** — An import with no bindings (`import './polyfill'`) appeared or vanished. *Invisible in most diffs but can change module-load-time behavior.*
- **Edge now routed through a barrel** — Same ultimate dependency, but now imported via an `index.ts` re-export instead of the direct file. *Obscures the true dependency target and can widen the effective coupling surface.*
- **Newly circular edge** — This specific edge, combined with existing ones, completes a cycle. *Cycles cause tree-shaking, testability, and initialization-order problems.*
- **Edge crosses a new architectural boundary** — E.g., a component now imports directly from another feature's internals or reaches past a service layer. *Bypassing intended layering is a common source of long-term maintenance pain.*
- **Dead/unused edge removed** — An import existed but nothing from it was actually referenced, and it's now cleaned up. *Confirms a genuine simplification rather than a functional change.*

## 3. Directory/Aggregate-Level Facts

- **Subdirectory added/removed wholesale** — An entire folder appeared or disappeared. *Bigger-picture signal than enumerating each file individually.*
- **Net-zero file count masking real churn** — Equal numbers of files added and removed in a directory, so a naive count looks unchanged. *A count-only summary can hide that the directory's contents were substantially replaced.*
- **Aggregate change magnitude for a collapsed node** — The combined/max change intensity of everything inside a collapsed directory stub. *Lets a reviewer sense "something big happened in here" without expanding every collapsed region.*
- **Structural change hidden inside a collapsed region** — A cycle, orphaning, or boundary violation occurs entirely within files that would otherwise be collapsed as "unchanged." *Collapsing for clutter shouldn't also collapse away a fact the reviewer actually needs to see.*
- **Directory cohesion shift** — The ratio of intra-directory edges to cross-directory edges changed. *A module becoming more self-contained (or more entangled with siblings) is a structural health signal.*
- **Directory role-composition shift** — E.g. a `components/` folder now contains a service, breaking the project's file-organization convention. *Convention drift is easy to miss file-by-file but obvious in aggregate.*
- **Directory-level test/story coverage delta** — The fraction of files with associated tests/stories in a directory went up or down. *Aggregate coverage trend for a module, not just a single file.*
- **Whole-directory rename/move** — A batch of files moved together as a unit (vs. scattered individual moves). *Recognizing a folder-level reorganization avoids reviewing it as N unrelated file changes.*
- **Cross-directory import volume change** — The number of imports entering or leaving a directory changed even though its internal files look unchanged. *Signals the module's role in the larger graph shifted without its own content changing.*

## 4. Structural/Graph-Level Facts

- **New cycle introduced** — Two or more files now import each other transitively where they didn't before. *Cycles are a well-known source of subtle bugs and build/tooling issues.*
- **Existing cycle broken** — A previously-cyclic relationship was resolved. *Worth celebrating/confirming as a structural improvement.*
- **File newly reachable from outside the feature** — Some file becomes importable by code outside the feature directory for the first time. *An accidental widening of the feature's public API/blast radius.*
- **File newly unreachable from the feature's entry point** — A file is no longer transitively imported from the feature root. *Likely dead code left behind after a refactor.*
- **Dramatic fan-in change** — The number of files importing a given file jumped or collapsed. *A utility becoming a heavily-shared bottleneck (or losing all its consumers) changes its risk profile.*
- **Dramatic fan-out change** — The number of files a given file imports jumped. *A file quietly becoming a "god file" that pulls in many dependencies is a maintainability smell.*
- **Shared dependency becomes exclusive (or vice versa)** — A file previously imported by multiple files is now imported by only one, or an exclusive dependency became shared. *Signals a de-duplication/inlining opportunity, or conversely a new unintended coupling.*
- **Longest import chain (graph depth) changed** — The deepest transitive import path within the feature got longer or shorter. *Deeper chains are harder to reason about and slower to trace mentally.*
- **Disconnected subgraphs merge or split** — Two previously separate clusters within the feature become connected, or one connected graph splits into islands. *A visible signal of concerns being merged or properly separated.*
- **New external (out-of-scope) dependency introduced** — The feature now depends on a module outside its directory that it didn't before. *New external coupling can indicate scope creep or a missing abstraction.*
- **External dependency removed** — The feature no longer depends on something outside its directory. *Confirms intended decoupling from external context.*
- **Feature entry point changed** — Which file is the routed/bootstrapped root of the feature changed. *Reframes how the whole diagram should be read — the "start here" node moved.*
- **New single point of failure** — Many files now transitively depend on one file, and that file lacks test coverage. *Concentrated, untested risk that's easy to miss looking file-by-file.*
- **Overall node/edge count delta** — Net growth or shrinkage of the feature's total size. *A quick "is this feature getting bigger or smaller/simpler" gut check.*
- **Test/story file leaking into the production graph** — A `.spec.ts` or `.stories.ts` file is now imported by non-test code. *Almost always a mistake — test-only code shipping into the app bundle.*

## 5. Meta Facts

- **True rename vs. delete+add** — Whether the tool used git rename detection to recognize a moved file rather than treating it as unrelated churn. *Prevents a simple move from being reviewed as if it were all-new code.*
- **Ownership/CODEOWNERS signal** — The change touches a file outside the PR author's usual area or owned by a different team. *Flags changes that may need a domain expert's sign-off.*
- **Multi-author file** — A changed file was touched by more than one contributor within this PR's history. *Co-authored or merged work on the same file is worth an extra look for conflicting intent.*
- **File churn/hotspot history** — The file has been modified unusually often in recent history. *Frequently-changed files are statistically more bug-prone; another edit adds to a known risk area.*
- **Statistical diff-size outlier** — This file's change is much larger than the median change size in the PR. *Directs limited review attention to the highest-leverage file.*
- **Feature-flag-gated change** — The change (including new imports) is wrapped in a feature flag conditional. *Changes behind a flag carry different risk/rollout characteristics than always-on changes.*
- **Breaking export-shape change** — A modified file's exported type/interface/function signature changed shape. *Could break external consumers even if the file's own tests still pass.*
- **Security-sensitive file touched** — The change touches an auth guard, sanitizer, or other security-relevant file. *Deserves scrutiny regardless of how small the diff looks, given blast radius.*
- **Linked ticket/issue reference added or removed** — A `@see`/comment reference to a tracking ticket changed. *Helps a reviewer find intent/context that isn't in the diagram itself.*
- **License/copyright header churn** — Boilerplate header text changed. *Pure noise the reviewer should be able to filter out.*
