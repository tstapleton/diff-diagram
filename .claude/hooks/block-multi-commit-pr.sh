#!/usr/bin/env bash
# PreToolUse hook (Bash matcher): enforce the one-commit-per-PR rule.
#
# The harness pipes a JSON description of the pending Bash tool call to stdin.
# If the command is a `gh pr create` and the current branch is more than one
# commit ahead of its base branch, print a "deny" verdict so the harness
# blocks the call and shows Claude the reason. Everything else passes silently.

input=$(cat)
command=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

case "$command" in
*"gh pr create"*) ;;
*) exit 0 ;;
esac

# Run git where the command would run — may be an agent worktree, not the repo root.
dir=$(printf '%s' "$input" | jq -r '.cwd // "."')

# Respect an explicit `--base <branch>` / `--base=<branch>` (stacked PRs); default to main.
base=$(printf '%s' "$command" | sed -n 's/.*--base[= ]\([^ ]*\).*/\1/p')
base=${base:-main}

# If the base ref can't be resolved (no origin/<base> here), stay out of the way.
count=$(git -C "$dir" rev-list --count "origin/$base..HEAD" 2>/dev/null) || exit 0

if [ "${count:-0}" -gt 1 ]; then
	cat <<EOF
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: branch has $count commits ahead of origin/$base. Rule: one logical change per commit, ONE commit per PR. Split this into separate single-commit branches and PRs before creating any PR."}}
EOF
fi

exit 0
