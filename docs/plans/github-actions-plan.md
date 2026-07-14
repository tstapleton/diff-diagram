# GitHub Actions Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CI on every PR, plus a reusable composite action that generates the dependency diff diagram, uploads `diagram.html` as a browser-viewable non-zipped artifact, and posts/updates a PR comment with a change summary and a link to the artifact.

**Architecture:** Two workflows. `ci.yml` runs `npm run verify` on PRs and main pushes. `diagram.yml` consumes a composite action (`action.yml` at repo root) via `uses: ./` against the committed fixture pair. The composite action installs and builds this repo at runtime (no committed bundle), runs the existing CLI as a subprocess (which already writes `diagram.html` and `graph.json`), uploads the HTML via `actions/upload-artifact@v7` with `archive: false`, and runs a small Node script that builds a summary from `graph.json` and upserts a marker-tagged PR comment via `@actions/github`.

**Tech Stack:** GitHub Actions (composite action), `actions/upload-artifact@v7` (`archive: false`, single-file in-browser viewing), `@actions/github` (octokit + event context), existing CLI pipeline (ts-morph/elkjs), vitest, Biome.

## Design decisions (resolved via interview — do not re-litigate)

- **No inline image in the comment.** Target consumers are private repos; GitHub proxies comment images through camo, which requires publicly reachable URLs. The backlog's undocumented asset-upload API design is abandoned.
- **Comment = summary text + artifact link.** Counts and named changed files, *including out-of-scope (external dependency) changes*, plus a link to the `diagram.html` artifact.
- **Composite action, built at runtime** (`npm ci && npm run build` in `$GITHUB_ACTION_PATH`, ~30–60s per run). No committed esbuild bundle, no staleness CI check. Logic stays in TypeScript.
- **Artifact upload via `actions/upload-artifact@v7` step inside the composite** — NOT via the `@actions/artifact` npm package from a `run` step, because `ACTIONS_RUNTIME_TOKEN` is not exposed to plain `run` steps. With `archive: false` the artifact `name` input is ignored; the filename (`diagram.html`) becomes the artifact name. The step's `artifact-url` output is the link for the comment.
- **Comment upsert:** marker `<!-- diff-diagram -->`; find existing comment containing marker → update, else create. One comment per PR.
- **CI:** single `verify` job (build + biome check + unit tests + visual tests), node 20 (matches local v20.19.4), on `pull_request` + `push` to `main`. Visual tests are CI-safe: they bundle `test/fixtures/fonts/FiraCode-Regular.ttf` with `loadSystemFonts: false`.
- **Diagram workflow runs on every PR** (dogfooding), fixtures `fake-angular-app-base` → `fake-angular-app`, feature `src/app/features/users`.
- **Main protection:** CLAUDE.md Never rule + GitHub branch ruleset (require PR + green `verify` check), ruleset created after PR 1 merges.
- **Two PRs.** PR 1: CI workflow + CLAUDE.md. PR 2: action + summary/comment code + diagram workflow + backlog revision.

## Global Constraints

- Node version comes from the existing tracked `.nvmrc` (content: `26`) — workflows use `node-version-file: .nvmrc`, never a hardcoded `node-version`. Node 20 is EOL; do not target it. (PR feedback, 2026-07-10.)
- Pin every third-party action to a full commit SHA with a trailing version comment, never a floating major tag (PR feedback, 2026-07-10). Resolved pins:
  - `actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0`
  - `actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0`
  - `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1`
- `actions/upload-artifact` v7+ with `archive: false`.
- Never commit or push directly to `main` — including PR 1 itself. Branch, then `gh pr create`.
- One task per commit; commit messages follow existing repo style (`feat:`, `docs:`, etc. — check `git log` for tone).
- Run `npm run verify` before declaring any code task done. Never run `npm run test:visual:approve`.
- Repo is ESM (`"type": "module"`); relative imports use `.js` extensions. `tsc` compiles `src/**` → `dist/` (test files excluded from build). Biome formats with tabs.
- Merging PRs is the **user's** decision. After opening a PR and confirming checks, stop and hand off.

## Known risk (verify live in Task 12)

The changelog promises in-browser viewing for "simple HTML files (without links to CSS or JS)". Our `diagram.html` is fully self-contained but includes **inline** `<script>` for hover interactivity. If GitHub serves the artifact with a CSP that blocks inline script, the diagram still renders but interactivity dies — record the observed behavior in the PR description; a fix (if needed) is a follow-up, not part of this plan.

---

# PR 1 — CI workflow + workflow rules

Branch: `ci-workflow` (from `main`).

### Task 1: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: a check named `verify` (job name) — referenced by the ruleset in Task 4 and required for all future PRs.

- [ ] **Step 1: Create branch**

```bash
git checkout -b ci-workflow
```

- [ ] **Step 2: Write the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run verify
```

`.nvmrc` already exists at the repo root (tracked, content `26`) — do not create or modify it.

- [ ] **Step 3: Validate locally**

Run: `npx --yes @action-validator/cli .github/workflows/ci.yml 2>/dev/null || node -e "const yaml=require('js-yaml')" 2>/dev/null; python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('YAML OK')"`
Expected: `YAML OK` (the python check is the reliable one; the validator is best-effort).

Also run: `npm run verify`
Expected: build, lint, unit tests, visual tests all pass — this is exactly what CI will run, so prove it green locally first.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add verify workflow for pull requests and main"
```

### Task 2: CLAUDE.md workflow rules

**Files:**
- Modify: `CLAUDE.md` (sections: `## Development workflow` and `## Always / Ask first / Never`)

- [ ] **Step 1: Edit `## Development workflow`**

Add as the **first** bullet of the existing list:

```markdown
- Never commit directly to `main`. All work happens on a feature branch and lands via pull request, with one independent commit per task.
```

- [ ] **Step 2: Edit the `**Never:**` list**

Add as a new bullet:

```markdown
- Commit or push directly to `main` — all changes land through pull requests (enforced by a branch ruleset).
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: require pull requests for all changes to main"
```

### Task 3: Open PR 1 and verify CI runs

- [ ] **Step 1: Push and create PR**

```bash
git push -u origin ci-workflow
gh pr create --title "Add CI workflow and PR-only workflow rules" --body "$(cat <<'EOF'
Adds a CI workflow running `npm run verify` (build + lint + unit tests + visual tests) on every pull request and on pushes to main, pinned to node 20. Updates CLAUDE.md to require all changes to land via pull request.

After this merges, a branch ruleset will be added requiring a PR and a green `verify` check on main.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Watch the check**

Run: `gh pr checks --watch`
Expected: `verify` check passes. If it fails, read the log (`gh run view --log-failed`), fix on the branch, push — do not bypass.

- [ ] **Step 3: Hand off to user for merge**

Report PR URL and check status. **Stop — the user merges.**

### Task 4: Branch ruleset (after PR 1 merges — user confirms merge first)

**Interfaces:**
- Consumes: check context `verify` from Task 1.

- [ ] **Step 1: Create the ruleset**

```bash
gh api --method POST repos/tstapleton/diff-diagram/rulesets --input - <<'EOF'
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "do_not_enforce_on_create": false,
        "required_status_checks": [{ "context": "verify" }]
      }
    }
  ]
}
EOF
```

Note: no bypass actors are configured, so even the repo admin cannot push to `main` directly. If the API rejects a parameter (ruleset API evolves), read the error, consult `gh api repos/tstapleton/diff-diagram/rulesets --method GET` and the [rulesets REST docs](https://docs.github.com/en/rest/repos/rules), and adjust — do not silently drop the `pull_request` or `required_status_checks` rules.

- [ ] **Step 2: Verify**

Run: `gh api repos/tstapleton/diff-diagram/rulesets --jq '.[] | {name, enforcement}'`
Expected: `{"name":"protect-main","enforcement":"active"}`

Run: `git push origin HEAD:main` from any branch with a dummy commit? **No** — do not test by pushing. Instead confirm via the API output above; the ruleset either exists and is active or it doesn't.

---

# PR 2 — Composite action + diagram workflow

Branch: `diagram-action` (from updated `main` after PR 1 merges).

File structure for this PR:

| File | Responsibility |
|---|---|
| `src/action/comment-body.ts` | Pure functions: build the comment markdown from a `Graph`; find an existing marker comment. No I/O. |
| `src/action/comment-body.test.ts` | Unit tests for the above. |
| `src/action/comment.ts` | Entry point: env + event context + octokit calls. Thin, no unit tests (exercised live by the workflow). |
| `action.yml` | Composite action: setup-node → install/build → run CLI → upload artifact → post comment. |
| `.github/workflows/diagram.yml` | Dogfood workflow: runs the action on every PR against the committed fixtures. |
| `docs/action-usage.yml` | Example caller workflow for external (private-repo) consumers. |
| `docs/backlog.md` | Revise the GitHub Action section to match what shipped. |

### Task 5: Add `@actions/github` dependency

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Branch and install**

```bash
git checkout main && git pull && git checkout -b diagram-action
npm install @actions/github
```

(`@actions/artifact` and `@actions/core` are deliberately NOT added — upload happens via a `uses:` step, and inputs arrive as plain env vars.)

- [ ] **Step 2: Verify install**

Run: `node -e "import('@actions/github').then(m => console.log(typeof m.getOctokit))"`
Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add @actions/github for PR comment posting"
```

### Task 6: Comment body builder (TDD)

**Files:**
- Create: `src/action/comment-body.ts`
- Test: `src/action/comment-body.test.ts`

**Interfaces:**
- Consumes: `Graph`, `GraphNode` from `../types.js` (fields used: `nodes[].scope` (`"in-scope" | "out-of-scope" | "removed-ghost"`), `nodes[].diff` (`"added" | "modified" | "removed" | "unchanged" | null`), `nodes[].file`, `edges[].diff`, `meta.scopeDir`).
- Produces: `COMMENT_MARKER: string`; `buildCommentBody(graph: Graph, ctx: CommentContext): string`; `findExistingCommentId(comments: Array<{ id: number; body?: string }>): number | null`; `interface CommentContext { artifactUrl: string; runUrl: string; headSha: string }`. Task 7 imports all of these.

Grouping rule: `out-of-scope` nodes are "external dependencies"; everything else (`in-scope` and `removed-ghost`) counts as in-scope files — removed in-scope files appear in `graph.json` with `scope: "removed-ghost"`, `diff: "removed"`.

- [ ] **Step 1: Write the failing tests**

Create `src/action/comment-body.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { Graph } from "../types.js";
import {
	COMMENT_MARKER,
	buildCommentBody,
	findExistingCommentId,
} from "./comment-body.js";

const ctx = {
	artifactUrl: "https://github.com/o/r/actions/runs/1/artifacts/9",
	runUrl: "https://github.com/o/r/actions/runs/1",
	headSha: "abc1234def5678",
};

function graph(overrides: Partial<Graph> = {}): Graph {
	return {
		meta: {
			scopeDir: "src/app/features/users",
			generatedAt: "2026-07-10T00:00:00.000Z",
			nodeCount: 0,
			edgeCount: 0,
		},
		nodes: [],
		edges: [],
		...overrides,
	};
}

describe("buildCommentBody", () => {
	it("starts with the marker and names the feature dir", () => {
		const body = buildCommentBody(graph(), ctx);
		expect(body.startsWith(COMMENT_MARKER)).toBe(true);
		expect(body).toContain("`src/app/features/users`");
	});

	it("counts in-scope files by diff state, treating removed-ghost as in-scope", () => {
		const body = buildCommentBody(
			graph({
				nodes: [
					{ id: "a", label: "A", file: "f/a.ts", type: "component", scope: "in-scope", diff: "added" },
					{ id: "b", label: "B", file: "f/b.ts", type: "service", scope: "in-scope", diff: "modified" },
					{ id: "c", label: "C", file: "f/c.ts", type: "service", scope: "removed-ghost", diff: "removed" },
					{ id: "d", label: "D", file: "f/d.ts", type: "service", scope: "in-scope", diff: "unchanged" },
				],
			}),
			ctx,
		);
		expect(body).toContain("**Files:** 1 added · 1 modified · 1 removed");
	});

	it("counts external (out-of-scope) dependency changes separately", () => {
		const body = buildCommentBody(
			graph({
				nodes: [
					{ id: "x", label: "X", file: "shared/x.ts", type: "service", scope: "out-of-scope", diff: "added" },
					{ id: "y", label: "Y", file: "shared/y.ts", type: "service", scope: "out-of-scope", diff: "unchanged" },
				],
			}),
			ctx,
		);
		expect(body).toContain("**External dependencies:** 1 added · 0 modified · 0 removed");
	});

	it("counts added and removed imports (edges)", () => {
		const body = buildCommentBody(
			graph({
				edges: [
					{ from: "a", to: "b", kind: "import", diff: "added" },
					{ from: "a", to: "c", kind: "import", diff: "added" },
					{ from: "a", to: "d", kind: "import", diff: "removed" },
					{ from: "a", to: "e", kind: "import", diff: "unchanged" },
				],
			}),
			ctx,
		);
		expect(body).toContain("**Imports:** 2 added · 1 removed");
	});

	it("lists changed files by name inside a details block", () => {
		const body = buildCommentBody(
			graph({
				nodes: [
					{ id: "a", label: "A", file: "f/new.ts", type: "component", scope: "in-scope", diff: "added" },
					{ id: "x", label: "X", file: "shared/dep.ts", type: "service", scope: "out-of-scope", diff: "added" },
				],
			}),
			ctx,
		);
		expect(body).toContain("<details>");
		expect(body).toContain("- `f/new.ts`");
		expect(body).toContain("**External dependencies added**");
		expect(body).toContain("- `shared/dep.ts`");
	});

	it("omits the details block when nothing changed", () => {
		const body = buildCommentBody(graph(), ctx);
		expect(body).not.toContain("<details>");
	});

	it("links the artifact, the run, and the short head sha", () => {
		const body = buildCommentBody(graph(), ctx);
		expect(body).toContain(ctx.artifactUrl);
		expect(body).toContain(ctx.runUrl);
		expect(body).toContain("abc1234");
		expect(body).not.toContain("abc1234def5678");
	});
});

describe("findExistingCommentId", () => {
	it("returns the id of the comment containing the marker", () => {
		expect(
			findExistingCommentId([
				{ id: 1, body: "unrelated" },
				{ id: 2, body: `${COMMENT_MARKER}\nold summary` },
			]),
		).toBe(2);
	});

	it("returns null when no comment has the marker, including undefined bodies", () => {
		expect(findExistingCommentId([{ id: 1 }, { id: 2, body: "hi" }])).toBe(null);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/action/comment-body.test.ts`
Expected: FAIL — cannot resolve `./comment-body.js`.

- [ ] **Step 3: Implement**

Create `src/action/comment-body.ts`:

```typescript
import type { DiffState, Graph, GraphNode } from "../types.js";

export const COMMENT_MARKER = "<!-- diff-diagram -->";

export interface CommentContext {
	artifactUrl: string;
	runUrl: string;
	headSha: string;
}

function byDiff(nodes: GraphNode[], diff: DiffState): GraphNode[] {
	return nodes.filter((n) => n.diff === diff);
}

export function buildCommentBody(graph: Graph, ctx: CommentContext): string {
	const external = graph.nodes.filter((n) => n.scope === "out-of-scope");
	const inScope = graph.nodes.filter((n) => n.scope !== "out-of-scope");
	const importsAdded = graph.edges.filter((e) => e.diff === "added").length;
	const importsRemoved = graph.edges.filter((e) => e.diff === "removed").length;

	const lines = [
		COMMENT_MARKER,
		`### 📊 Dependency diff — \`${graph.meta.scopeDir}\``,
		"",
		`**Files:** ${byDiff(inScope, "added").length} added · ${byDiff(inScope, "modified").length} modified · ${byDiff(inScope, "removed").length} removed`,
		`**External dependencies:** ${byDiff(external, "added").length} added · ${byDiff(external, "modified").length} modified · ${byDiff(external, "removed").length} removed`,
		`**Imports:** ${importsAdded} added · ${importsRemoved} removed`,
	];

	const changed: string[] = [];
	const section = (title: string, nodes: GraphNode[]): void => {
		if (nodes.length === 0) return;
		changed.push("", `**${title}**`, ...nodes.map((n) => `- \`${n.file}\``));
	};
	section("Added", byDiff(inScope, "added"));
	section("Modified", byDiff(inScope, "modified"));
	section("Removed", byDiff(inScope, "removed"));
	section("External dependencies added", byDiff(external, "added"));
	section("External dependencies removed", byDiff(external, "removed"));

	if (changed.length > 0) {
		lines.push("", "<details>", "<summary>Changed files</summary>", ...changed, "", "</details>");
	}

	lines.push(
		"",
		`**[Open interactive diagram ↗](${ctx.artifactUrl})** — link expires with artifact retention`,
		"",
		`<sub>Updated for ${ctx.headSha.slice(0, 7)} · [workflow run](${ctx.runUrl})</sub>`,
	);
	return lines.join("\n");
}

export function findExistingCommentId(
	comments: Array<{ id: number; body?: string }>,
): number | null {
	return comments.find((c) => c.body?.includes(COMMENT_MARKER))?.id ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/action/comment-body.test.ts`
Expected: PASS (9 tests).

Note: the last test asserts the full sha does not appear. `slice(0, 7)` of `"abc1234def5678"` is `"abc1234"` — the full sha must not be printed anywhere else in the body.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify`
Expected: all green.

```bash
git add src/action/comment-body.ts src/action/comment-body.test.ts
git commit -m "feat: build PR comment body from diff graph"
```

### Task 7: Comment entry point

**Files:**
- Create: `src/action/comment.ts`

**Interfaces:**
- Consumes: `buildCommentBody`, `findExistingCommentId`, `CommentContext` from `./comment-body.js` (Task 6); `Graph` from `../types.js`.
- Consumes at runtime: env vars `GITHUB_TOKEN`, `ARTIFACT_URL`, `GRAPH_JSON` (set by `action.yml` in Task 8); a `pull_request` event payload.
- Produces: `dist/action/comment.js` after `npm run build` — executed by `action.yml`.

- [ ] **Step 1: Implement**

Create `src/action/comment.ts`:

```typescript
import { readFile } from "node:fs/promises";
import * as github from "@actions/github";
import type { Graph } from "../types.js";
import { buildCommentBody, findExistingCommentId } from "./comment-body.js";

async function main(): Promise<void> {
	const token = process.env.GITHUB_TOKEN;
	const artifactUrl = process.env.ARTIFACT_URL;
	const graphJsonPath = process.env.GRAPH_JSON;
	if (!token || !artifactUrl || !graphJsonPath) {
		throw new Error("GITHUB_TOKEN, ARTIFACT_URL, and GRAPH_JSON must be set");
	}
	const pr = github.context.payload.pull_request;
	if (!pr) {
		throw new Error("This action only runs on pull_request events");
	}

	const graph: Graph = JSON.parse(await readFile(graphJsonPath, "utf8"));
	const { owner, repo } = github.context.repo;
	const runUrl = `${github.context.serverUrl}/${owner}/${repo}/actions/runs/${github.context.runId}`;
	const body = buildCommentBody(graph, {
		artifactUrl,
		runUrl,
		headSha: pr.head.sha,
	});

	const octokit = github.getOctokit(token);
	const comments = await octokit.paginate(octokit.rest.issues.listComments, {
		owner,
		repo,
		issue_number: pr.number,
		per_page: 100,
	});
	const existingId = findExistingCommentId(comments);
	if (existingId !== null) {
		await octokit.rest.issues.updateComment({
			owner,
			repo,
			comment_id: existingId,
			body,
		});
		console.log(`Updated comment ${existingId}`);
	} else {
		const created = await octokit.rest.issues.createComment({
			owner,
			repo,
			issue_number: pr.number,
			body,
		});
		console.log(`Created comment ${created.data.id}`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
```

(`pr.head.sha` over `github.context.sha`: on `pull_request` events `context.sha` is the synthetic merge commit, not the branch head the reviewer sees.)

- [ ] **Step 2: Verify it builds and fails cleanly without env**

Run: `npm run build && node dist/action/comment.js; echo "exit: $?"`
Expected: error message `GITHUB_TOKEN, ARTIFACT_URL, and GRAPH_JSON must be set`, then `exit: 1`.

- [ ] **Step 3: Verify and commit**

Run: `npm run verify`
Expected: all green.

```bash
git add src/action/comment.ts
git commit -m "feat: add comment-posting entry point for the action"
```

### Task 8: Composite action

**Files:**
- Create: `action.yml` (repo root)

**Interfaces:**
- Consumes: `dist/cli.js` (built in-step; writes `diagram.html` and `graph.json` to `--out-dir`), `dist/action/comment.js` (Task 7).
- Produces: the action consumed by `.github/workflows/diagram.yml` (Task 9) and external callers (`uses: tstapleton/diff-diagram@main`).

- [ ] **Step 1: Write `action.yml`**

```yaml
name: diff-diagram
description: Post a dependency diff diagram summary with an artifact link on a pull request
inputs:
  feature-dir:
    description: Feature directory to diagram, relative to repo-root
    required: true
  repo-root:
    description: Repo root for the current branch
    default: ${{ github.workspace }}
  base-repo-root:
    description: Path to a pre-checked-out base branch
    required: true
  source-root:
    description: Source root prefix for label derivation
    default: src/app
  token:
    description: GitHub token used to post the PR comment
    default: ${{ github.token }}
runs:
  using: composite
  steps:
    - name: Read node version from .nvmrc
      id: node-version
      shell: bash
      run: echo "version=$(cat "${{ github.action_path }}/.nvmrc")" >> "$GITHUB_OUTPUT"
    - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
      with:
        node-version: ${{ steps.node-version.outputs.version }}
        # NOT node-version-file: setup-node resolves that relative to GITHUB_WORKSPACE,
        # which breaks for actions (live failure: run 29124796826). The version still
        # comes only from the action's .nvmrc via the step above.
    - name: Install and build diff-diagram
      shell: bash
      working-directory: ${{ github.action_path }}
      env:
        HUSKY: "0"
      run: |
        npm ci --no-audit --no-fund
        npm run build
    - name: Generate diagram
      shell: bash
      run: |
        node "${{ github.action_path }}/dist/cli.js" \
          --repo-root "${{ inputs.repo-root }}" \
          --base-repo-root "${{ inputs.base-repo-root }}" \
          --source-root "${{ inputs.source-root }}" \
          --out-dir "${{ runner.temp }}/diff-diagram" \
          "${{ inputs.feature-dir }}"
    - name: Upload diagram artifact
      id: upload
      uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
      with:
        path: ${{ runner.temp }}/diff-diagram/diagram.html
        archive: false
    - name: Post PR comment
      shell: bash
      env:
        GITHUB_TOKEN: ${{ inputs.token }}
        ARTIFACT_URL: ${{ steps.upload.outputs.artifact-url }}
        GRAPH_JSON: ${{ runner.temp }}/diff-diagram/graph.json
      run: node "${{ github.action_path }}/dist/action/comment.js"
```

Implementation notes baked into this file — keep them true:
- `HUSKY: "0"` — when the action is consumed remotely, the action path has no `.git`, and husky's `prepare` script would fail `npm ci` without it.
- `archive: false` requires `actions/upload-artifact@v7`; the artifact `name` input is ignored in this mode (filename becomes the artifact name), so none is passed.
- Env var names are plain (`GITHUB_TOKEN`, not `INPUT_*`) because composite `run` steps don't get automatic input env mapping.

- [ ] **Step 2: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('action.yml')); print('YAML OK')"`
Expected: `YAML OK`

- [ ] **Step 3: Commit**

```bash
git add action.yml
git commit -m "feat: add composite action for PR diagram comments"
```

### Task 9: Diagram workflow (dogfood)

**Files:**
- Create: `.github/workflows/diagram.yml`

**Interfaces:**
- Consumes: `action.yml` (Task 8) via `uses: ./`; committed fixtures `fake-angular-app/`, `fake-angular-app-base/`.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/diagram.yml`:

```yaml
name: Diagram

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: diagram-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  diagram:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - uses: ./
        with:
          feature-dir: src/app/features/users
          repo-root: fake-angular-app
          base-repo-root: fake-angular-app-base
```

(Relative `repo-root`/`base-repo-root` resolve against the workspace — the CLI calls `path.resolve` from cwd.)

- [ ] **Step 2: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/diagram.yml')); print('YAML OK')"`
Expected: `YAML OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/diagram.yml
git commit -m "ci: run diff-diagram action on every pull request"
```

### Task 10: Example caller workflow for external consumers

**Files:**
- Create: `docs/action-usage.yml`

- [ ] **Step 1: Write the example**

Create `docs/action-usage.yml`:

```yaml
# Example workflow for consuming the diff-diagram action from another repo.
# Copy into .github/workflows/ of the consuming repo and adjust feature-dir.
#
# Note: if the consuming repo is private and this repo is also private, the
# consuming repo's org/owner must grant Actions access to this repo
# (Settings → Actions → General → Access) or the `uses:` resolution fails.
name: diff-diagram

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: diff-diagram-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  diagram:
    runs-on: ubuntu-latest
    steps:
      # Current branch (PR head)
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      # Base branch, checked out into a subdirectory
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          ref: ${{ github.event.pull_request.base.sha }}
          path: .diff-diagram-base
      - uses: tstapleton/diff-diagram@main
        with:
          feature-dir: src/app/features/my-feature
          base-repo-root: .diff-diagram-base
```

- [ ] **Step 2: Commit**

```bash
git add docs/action-usage.yml
git commit -m "docs: add example caller workflow for the action"
```

### Task 11: Revise the backlog section

**Files:**
- Modify: `docs/backlog.md` (the `## GitHub Action` section only)

User approval for this backlog change was given in the planning interview (2026-07-10).

- [ ] **Step 1: Rewrite the section**

Replace the entire `## GitHub Action` section (from `## GitHub Action` up to, but not including, the next `---`) with:

```markdown
## GitHub Action

**Shipped 2026-07** as a composite action (`action.yml` at repo root) — see `docs/action-usage.yml` for consumer setup. The design changed from the original plan during implementation planning:

- **No inline image in the PR comment.** Original design uploaded a PNG via GitHub's undocumented asset API. Abandoned: target consumers are private repos, and GitHub proxies comment images through camo, which requires publicly reachable image URLs. The comment instead contains a text summary (file/dependency/import diff counts and named changes) plus a link to the `diagram.html` workflow artifact, uploaded non-zipped (`actions/upload-artifact@v7`, `archive: false`) so it renders directly in the browser.
- **Composite action instead of a bundled JS action.** The JS-action rationale (TypeScript for the 3-step image upload) died with the image upload. The composite variant runs `npm ci && npm run build` in the action path at runtime (~30–60s), keeping the repo free of a ~10MB committed esbuild bundle and its staleness check.
- **The action shells out to `dist/cli.js`** rather than running the pipeline in-process; the comment script builds its summary from the CLI's `graph.json` output.

### Deferred follow-ups

- **Inline image in the comment** — only viable for public repos, or if GitHub changes camo behavior; would need public image hosting.
- **Interactivity under CSP** — if GitHub serves artifact HTML with a CSP blocking inline `<script>`, hover highlighting is dead in the artifact view. Recorded observed behavior in PR #<n>; fix would be a static-fallback rendering.
- **Versioned action refs** — consumers currently pin `@main`; cut a `v1` tag once the action stabilizes.
```

(Replace `#<n>` with the actual PR 2 number, and correct the CSP line to match what Task 12 actually observes — delete the bullet if interactivity works.)

- [ ] **Step 2: Commit**

```bash
git add docs/backlog.md
git commit -m "docs: update GitHub Action backlog entry to shipped design"
```

### Task 12: Open PR 2 and verify live end-to-end

- [ ] **Step 1: Final local verify**

Run: `npm run verify`
Expected: all green.

- [ ] **Step 2: Push and create PR**

```bash
git push -u origin diagram-action
gh pr create --title "Add diff-diagram composite action and PR diagram workflow" --body "$(cat <<'EOF'
Adds a composite action that generates the dependency diff diagram, uploads `diagram.html` as a non-zipped browser-viewable artifact, and posts/updates a summary comment on the PR. A new Diagram workflow dogfoods the action on every PR using the committed fixture apps. See the comment on this very PR for a live demo.

- Comment: diff counts (files, external dependencies, imports) + named changed files + artifact link
- Upsert via `<!-- diff-diagram -->` marker — one comment per PR, updated on each push
- No committed bundle: the action installs and builds itself at runtime

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Watch checks and the comment**

Run: `gh pr checks --watch`
Expected: `verify` and `diagram` both pass.

Then: `gh pr view --comments`
Expected: a comment starting with the diagram marker content, showing non-zero counts (fixtures diff: 2 added, 2 modified in-scope; 1 removed; 2 external added; 8 imports added, 6 removed) and an artifact link.

If the diagram job fails, read `gh run view --log-failed`. Likely first-run issues: `upload-artifact` version/option names (verify `archive: false` is the shipped input name for v7), missing `artifact-url` output name, or the comment step failing on token permissions (workflow must have `pull-requests: write` — it does).

- [ ] **Step 4: Hand off to user**

Report: PR URL, check status, and ask the user to click the artifact link to confirm (a) the HTML renders in-browser, (b) whether hover interactivity works (CSP question). Update the backlog CSP bullet on the branch if needed (amend via a new commit, re-push). **Stop — the user merges.**

---

## Post-merge checklist (user-visible wrap-up)

- PR 1 merged, ruleset `protect-main` active (Task 4).
- PR 2 merged; next PR on any branch should automatically receive a diagram comment.
- Delete `github-actions-plan.md` in a follow-up PR once both PRs land (or keep it — user's call).
