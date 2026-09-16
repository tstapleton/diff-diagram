#!/usr/bin/env bash
# PreToolUse hook (EnterWorktree matcher): force worktree creation through
# plain `git worktree add` instead of the built-in EnterWorktree tool.
#
# EnterWorktree always creates/resolves worktrees under .claude/worktrees/ —
# a path the user's local `worktrunk` tool does not watch. This repo's
# worktrees must live under the canonical `main` checkout's .worktrees/
# directory instead, so worktrunk can see and check them out for review
# (see CLAUDE.md). The matcher already scopes this hook to EnterWorktree
# calls, so it always denies; there's no conditional case to check.

input=$(cat)
dir=$(printf '%s' "$input" | jq -r '.cwd // "."')

# If we can't resolve the repo layout, stay out of the way rather than
# block with a useless message.
common_dir=$(git -C "$dir" rev-parse --git-common-dir 2>/dev/null) || exit 0
repo_container=$(cd "$(dirname "$common_dir")" && pwd)
main_checkout="$repo_container/main"

cat <<EOF
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"EnterWorktree is disabled for this project: it always creates worktrees under .claude/worktrees/, a path the user's local worktrunk tool does not watch. Use plain git instead, then work from that directory: git worktree add -b <branch-name> $main_checkout/.worktrees/<branch-name> origin/main"}}
EOF
