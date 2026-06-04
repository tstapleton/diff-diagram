# Glossary

Common terms used in diff-diagram docs and code.

---

**feature directory**  
The Angular directory passed to the CLI as `<feature-dir>`. It defines the scope of the diagram — all `.ts` files in this directory and its subdirectories become in-scope nodes. Example: `src/app/features/users`. The internal code variable and `graph.json` field are named `scopeDir` for historical reasons.

**in-scope node**  
A graph node representing a `.ts` file that lives inside the feature directory. `scope: 'in-scope'` in the graph schema.

**out-of-scope (OOS) node**  
A graph node for a file outside the feature directory that is imported by an in-scope file. Added by the one-layer context expansion in `filter.ts`. `scope: 'out-of-scope'`.

**removed ghost**  
A node that existed in the base branch but was deleted in the current branch. Appears in the diagram with a red border and `diff: 'removed'` so reviewers can see what was deleted. `scope: 'removed-ghost'`.

**stub node**  
A synthetic node representing a collapsed directory in Diff-focused view. When all files in a subdirectory are unchanged, they are replaced by a single stub node labeled with the directory name. Stubs have `type: 'stub'` and are not real files. Edges to/from collapsed files are redirected to the stub.

**diff state**  
One of four values indicating how a node or edge changed between base and current branches:
- `added` — present in current, not in base
- `removed` — present in base, not in current
- `modified` — present in both but with changed imports
- `unchanged` — identical in both branches

**base branch / base repo root**  
The state of the repository before the PR changes. The CLI requires a pre-materialized checkout of the base branch (e.g. via `git worktree add`) passed via `--base-repo-root`. The CLI does not manage git state.

**one-layer context**  
The out-of-scope nodes added by `filter.ts`. The analyzer finds all imports that point outside the feature directory (`_oosEdges`). Filter follows each of those edges one level and creates an OOS node for the target file. No further hops are followed.

**diff-focused view**  
A collapsed view mode that reduces the diagram to what matters for a PR review. Subdirectories with no changed files are replaced by stub nodes. Subdirectories with any change (added/modified/removed file) are fully expanded. This is the default view and the layout used for `diagram.svg`.

**all-nodes view**  
A view mode that shows every node individually with no collapsing. Useful for understanding the full architecture but can be dense for large feature directories.

**layout**  
The output of `computeLayout(nodes, edges)` — x/y positions and dimensions for each node, plus bend-point coordinates for each edge. Computed server-side by elkjs and embedded in `diagram.html` as JSON. The browser renderer draws from these pre-computed positions without running elkjs.

**node type**  
Classification of what a `.ts` file is: `component`, `service`, `pipe`, `guard`, `resolver`, `interceptor`, `routing`, `module`, `model`, `constants`, or `stub`. Determined by Angular decorators and filename patterns. Affects border style in the diagram (not color — color is reserved for diff state).

**type-only import**  
An import used only for TypeScript type information (interfaces, type aliases). Detected via `import type { X }` syntax. Rendered with a dashed edge. Not all type imports use this syntax — see `docs/plans/task-02-type-only-imports.md` for context.
