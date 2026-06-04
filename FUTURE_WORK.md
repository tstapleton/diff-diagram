# Future Work

Ideas and deferred features with context on why they weren't implemented yet and options for moving forward.

---

## Type-Only Import Detection

### Request
Detect nodes that are imported purely for type information (TypeScript types,
interfaces) and style them differently — italic label, lighter fill, dotted border
— to communicate "this dependency vanishes at runtime and does not affect the
production bundle."

### Why deferred
TypeScript supports two syntaxes for type-only imports:

1. **`import type { X } from '...'`** — explicit type-only import (TS 3.8+)
2. **`import { X } from '...'`** — regular import where `X` happens to be a type

The ts-morph API (`ImportDeclaration.isTypeOnly()`) only detects case 1. Most
Angular codebases — including ours — use case 2: types are imported with the same
syntax as values. This means the feature would be a no-op on real code.

Using `verbatimModuleSyntax` in tsconfig would force developers to use `import type`
explicitly, which would make the detection reliable — but changing that tsconfig
option is a separate, potentially disruptive decision.

### Options for moving forward

**Option A: Enable `verbatimModuleSyntax`**  
Add `"verbatimModuleSyntax": true` to tsconfig. This forces all type-only imports
to use `import type { X }` explicitly. TypeScript will error on any value import
used only as a type. Teams would fix errors incrementally. Once the codebase
adopts the convention, `imp.isTypeOnly()` becomes reliable.

**Option B: ts-morph type resolution**  
For each imported name, use ts-morph's type checker to determine if the imported
declaration is purely a type (`isTypeAlias`, `isInterface`, `isEnum` with `const`
modifier) vs a runtime value. This works without changing tsconfig but is
significantly more complex, slower, and has edge cases (classes are both types and
values; enums depend on usage).

**Option C: Defer indefinitely**  
The diagram already shows which dependencies are in-scope vs out-of-scope. Type-only
styling adds nuance, but may not be worth the implementation complexity if the
codebase doesn't adopt `import type` syntax.

**Option D: Only flag `import type` syntax (current implementation)**  
The code is already implemented and committed. It works correctly for files that
use `import type`. Rare in the codebase today, but costs nothing at runtime. Could
be surfaced as a future opt-in once `verbatimModuleSyntax` is discussed.

---

## Subdirectory Grouping Inside Scope Container

### Request
Within the in-scope container box, visually group nodes by their first-level
subdirectory under the scope dir (e.g. `user-list/`, `user-settings/`). Each
group rendered as a subtle background rect with a label. Files at the scope root
get no group box.

### Why deferred
The implementation placed all nodes inside the workspace container (the outer
in-scope bounding box) rather than producing distinct per-subdirectory boxes
inside it. ELK's layout algorithm does not guarantee that nodes from the same
subdirectory are spatially adjacent — it optimizes for minimal edge crossings —
so the per-subdir bounding boxes computed from final node positions all overlapped
or merged into the container bounds.

A correct implementation would require either:
- Telling ELK to place nodes in subdir groups (compound graph layout), or
- Post-processing the layout to physically cluster nodes by subdir before computing bounding boxes

### Options for moving forward

**Option A: ELK compound/hierarchical layout**  
Model each subdirectory as an ELK compound node containing its files. ELK will
guarantee spatial separation between subdirs. Requires significant changes to
`computeLayout` — nodes must be nested, edges must cross compound boundaries,
and the current flat layout model changes substantially.

**Option B: Two-pass layout**  
Run a first ELK pass on subdirs (treating each as a single unit), then a second
pass within each subdir. Positions are composed. More predictable than compound
layout but adds complexity.

**Option C: Force-cluster with ELK partitions**  
Extend the existing partition approach (currently used for in-scope vs oos) to
assign each subdir its own partition number. ELK would place subdir 0 left of
subdir 1, etc. Less flexible than compound layout but simpler. May not produce
readable layouts for large graphs.

**Option D: Label-only grouping (no boxes)**  
Instead of background rectangles, render a small subdir label near each node
(above the node label). No bounding-box computation needed. Lower visual impact
but zero layout coupling.

---
