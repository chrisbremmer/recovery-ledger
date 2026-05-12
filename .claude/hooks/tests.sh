#!/usr/bin/env bash
# Smoke-test runner for the PreToolUse guards. Invoke directly:
#
#   bash .claude/hooks/tests.sh
#
# Each case pipes a JSON tool-call payload into a guard and asserts the
# expected exit code (0 = allow, 2 = block). Run this before merging any
# change to a hook script. Cases are derived from the PR #1 code review;
# extend the table when new bypasses are discovered.

set -u
cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" || realpath "${BASH_SOURCE[0]}")")"

pass=0
fail=0
fails=()

check() {
  local label="$1"; local expected="$2"; local script="$3"; local input="$4"
  local actual
  set +e
  printf '%s' "$input" | bash "$script" >/dev/null 2>&1
  actual=$?
  set -e
  if { [ "$expected" = "block" ] && [ "$actual" -ne 0 ]; } || { [ "$expected" = "allow" ] && [ "$actual" -eq 0 ]; }; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    fails+=("[$script] $label: expected=$expected actual=$actual")
  fi
}

S_PUSH=./guard-git-push-main.sh
S_BYPASS=./guard-hook-bypass.sh
S_STDOUT=./guard-mcp-stdout.sh
S_SETTINGS=./guard-settings-edit.sh

# ---- guard-git-push-main ----
check "feature branch push" allow $S_PUSH '{"tool_input":{"command":"git push -u origin chore/agent-infrastructure"}}'
check "branch contains main (chore/main-thing)" allow $S_PUSH '{"tool_input":{"command":"git push -u origin chore/main-thing"}}'
check "direct main push" block $S_PUSH '{"tool_input":{"command":"git push origin main"}}'
check "HEAD:main" block $S_PUSH '{"tool_input":{"command":"git push origin HEAD:main"}}'
check "HEAD:refs/heads/main" block $S_PUSH '{"tool_input":{"command":"git push origin HEAD:refs/heads/main"}}'
check "bare refs/heads/main" block $S_PUSH '{"tool_input":{"command":"git push origin refs/heads/main"}}'
check "force +main" block $S_PUSH '{"tool_input":{"command":"git push origin +main"}}'
check "force +refs/heads/main" block $S_PUSH '{"tool_input":{"command":"git push origin +refs/heads/main"}}'
check "single-quoted main" block $S_PUSH "{\"tool_input\":{\"command\":\"git push origin 'main'\"}}"
check "double-quoted main" block $S_PUSH '{"tool_input":{"command":"git push origin \"main\""}}'
check "--all" block $S_PUSH '{"tool_input":{"command":"git push --all origin"}}'
check "--mirror" block $S_PUSH '{"tool_input":{"command":"git push --mirror origin"}}'
check "chained && block" block $S_PUSH '{"tool_input":{"command":"git fetch && git push origin main"}}'
check "comment-after-# allow" allow $S_PUSH '{"tool_input":{"command":"git fetch # push origin main"}}'
check "git fetch origin main" allow $S_PUSH '{"tool_input":{"command":"git fetch origin main"}}'
check "git log not push" allow $S_PUSH '{"tool_input":{"command":"git log --oneline -10"}}'
check "git worktree add origin/main" allow $S_PUSH '{"tool_input":{"command":"git worktree add .worktrees/foo -b foo origin/main"}}'

# ---- guard-hook-bypass ----
check "git --no-verify" block $S_BYPASS '{"tool_input":{"command":"git commit --no-verify -m foo"}}'
check "--no-verify in -m body (false-pos fix)" allow $S_BYPASS '{"tool_input":{"command":"git commit -m \"docs: --no-verify guidance\""}}'
check "git --no-gpg-sign" block $S_BYPASS '{"tool_input":{"command":"git commit --no-gpg-sign -m foo"}}'
check "git -c commit.gpgsign=false" block $S_BYPASS '{"tool_input":{"command":"git -c commit.gpgsign=false commit -m foo"}}'
check "git -c core.hooksPath=/dev/null" block $S_BYPASS '{"tool_input":{"command":"git -c core.hooksPath=/dev/null commit -m foo"}}'
check "--gpg-sign=false" block $S_BYPASS '{"tool_input":{"command":"git commit --gpg-sign=false -m foo"}}'
check "echo non-git command with flag" allow $S_BYPASS '{"tool_input":{"command":"echo --no-verify"}}'
check "grep on file mentioning flag" allow $S_BYPASS '{"tool_input":{"command":"grep --no-verify FILE"}}'
check "normal git commit" allow $S_BYPASS '{"tool_input":{"command":"git commit -m foo"}}'
check "msg quotes around the flag only" allow $S_BYPASS '{"tool_input":{"command":"git commit -m \"--no-verify\""}}'
check "msg quotes then trailing flag" block $S_BYPASS '{"tool_input":{"command":"git commit -m \"msg\" --no-verify"}}'

# ---- guard-mcp-stdout ----
check "console.log in absolute src/mcp" block $S_STDOUT '{"tool_name":"Edit","tool_input":{"file_path":"/foo/src/mcp/handler.ts","new_string":"console.log(x)"}}'
check "console.log in relative src/mcp" block $S_STDOUT '{"tool_name":"Write","tool_input":{"file_path":"src/mcp/server.ts","content":"console.log(x)"}}'
check "./src/mcp prefix" block $S_STDOUT '{"tool_name":"Edit","tool_input":{"file_path":"./src/mcp/server.ts","new_string":"console.log(x)"}}'
check "console.dir in src/domain" block $S_STDOUT '{"tool_name":"Edit","tool_input":{"file_path":"src/domain/baselines.ts","new_string":"console.dir(x)"}}'
check "console.table in src/services" block $S_STDOUT '{"tool_name":"Edit","tool_input":{"file_path":"src/services/sync.ts","new_string":"console.table(x)"}}'
check "process.stdout.write in src/services" block $S_STDOUT '{"tool_name":"Write","tool_input":{"file_path":"src/services/sync.ts","content":"process.stdout.write(x)"}}'
check "*.test.ts exempt" allow $S_STDOUT '{"tool_name":"Write","tool_input":{"file_path":"src/domain/baselines.test.ts","content":"console.log(x)"}}'
check "*.spec.ts exempt" allow $S_STDOUT '{"tool_name":"Write","tool_input":{"file_path":"src/services/sync.spec.ts","content":"console.log(x)"}}'
check "src/cli/ exempt" allow $S_STDOUT '{"tool_name":"Edit","tool_input":{"file_path":"src/cli/init.ts","new_string":"console.log(x)"}}'
check "MultiEdit with console.log" block $S_STDOUT '{"tool_name":"MultiEdit","tool_input":{"file_path":"src/mcp/server.ts","edits":[{"new_string":"console.log(x)"}]}}'
check "Pino logger in src/services" allow $S_STDOUT '{"tool_name":"Write","tool_input":{"file_path":"src/services/sync.ts","content":"const logger = pino()"}}'
check "Bash tool ignored" allow $S_STDOUT '{"tool_name":"Bash","tool_input":{"command":"ls"}}'

# ---- guard-settings-edit ----
check "edit settings.json blocked" block $S_SETTINGS '{"tool_name":"Edit","tool_input":{"file_path":".claude/settings.json","new_string":"{}"}}'
check "edit absolute settings.json blocked" block $S_SETTINGS '{"tool_name":"Edit","tool_input":{"file_path":"/foo/.claude/settings.json","new_string":"{}"}}'
check "edit hook .sh blocked" block $S_SETTINGS '{"tool_name":"Write","tool_input":{"file_path":".claude/hooks/guard-mcp-stdout.sh","content":"exit 0"}}'
check "MultiEdit hook .sh blocked" block $S_SETTINGS '{"tool_name":"MultiEdit","tool_input":{"file_path":"/foo/.claude/hooks/new-hook.sh","edits":[]}}'
check "edit hooks/README.md allowed" allow $S_SETTINGS '{"tool_name":"Edit","tool_input":{"file_path":".claude/hooks/README.md","new_string":"..."}}'
check "edit unrelated file allowed" allow $S_SETTINGS '{"tool_name":"Edit","tool_input":{"file_path":"agent_docs/learnings.md","new_string":"..."}}'
check "Bash tool ignored" allow $S_SETTINGS '{"tool_name":"Bash","tool_input":{"command":"ls"}}'

# ---- summary ----
echo ""
echo "===================="
echo "PASS: $pass  FAIL: $fail"
echo "===================="
if [ "$fail" -gt 0 ]; then
  printf '\nFailures:\n'
  for f in "${fails[@]}"; do
    printf '  - %s\n' "$f"
  done
  exit 1
fi
exit 0
