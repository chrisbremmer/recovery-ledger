#!/usr/bin/env bash
# CI grep gates — four rules that Biome cannot catch on its own.
#
# Gate A: banned tone words (CLAUDE.md "Critical Rules" list) — banned in code,
#         tests, formatters, configs, and docs other than the rule definitions
#         themselves. Self-exempt: CLAUDE.md (the rule source) and this script
#         (which has to spell the words to grep for them).
# Gate B: console.log / console.error / console.warn — banned outside src/cli/**
#         and test files (CLAUDE.md §Critical Rules — MCP stdout purity).
# Gate C: process.stdout.write — banned outside src/cli/commands/**/*.ts
#         (Phase 2 Plan 05 broadens from the single doctor.ts file to any
#         CLI command file; init.ts and auth.ts both emit human-facing
#         output via process.stdout.write per D-04 + D-11. ADR-0001's
#         MCP-stdout-purity rule still holds: src/cli/commands/ is NOT
#         reachable from src/mcp/, so widening the scope here does not
#         break MCP framing).
# Gate D: server.registerTool — banned outside src/mcp/register.ts (D-09 — the
#         one chokepoint where the try/catch/sanitize wrapper applies). Any
#         direct call from a tool module would bypass the sanitizer and risk
#         leaking secrets through MCP error responses (PITFALLS.md Pitfall 17).
#
# Exit-code semantics (Pitfall 10): grep returns 0 on match (= violation found).
# Each gate inverts that: if grep -rEn matches, the gate prints ::error:: and
# exits 1. The script exits 0 only when every gate finds no matches.
#
# Plan 06 wires this into .github/workflows/ci.yml as a single
# `run: bash scripts/ci-grep-gates.sh` step.

set -euo pipefail

# Use the system grep explicitly so the script behaves identically on macOS and
# in the GitHub Actions macos-latest runner. LC_ALL=C makes byte-level patterns
# (used for emoji detection in Gate A) portable across BSD and GNU grep.
GREP="${GREP:-grep}"
export LC_ALL=C

# Shared exclusions for repo-wide scans (Gate A).
#
# Policy (MR-04): exclude test SOURCE files (*.test.ts) but NOT the test/
# directory wholesale. ADR-0005 (banned tone words) explicitly scopes the
# rule to `src/formatters/`, `src/cli/`, AND `tests/fixtures/review/` — so
# fixture JSON under test/fixtures/ must remain in scope. Excluding the
# entire test/ directory (the WR-02 fix) silently skipped review fixtures
# the ADR considers user-facing copy. We instead exclude only files
# matching `*.test.ts` (the unit/integration test sources, which are not
# user-facing copy) and let fixture files under test/fixtures/ stay in
# scope of the gate.
#
# Self-exempt files: CLAUDE.md and this script (each spell the banned
# words by necessity), plus ADR-0005 itself (the ADR is the authoritative
# source of the rule and lists the words verbatim — same logic as the
# CLAUDE.md self-exemption).
REPO_EXCLUDES=(
  --exclude-dir=.git
  --exclude-dir=.planning
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=coverage
  --exclude-dir=.worktrees
  --exclude='*.test.ts'
  --exclude=CLAUDE.md
  --exclude=ci-grep-gates.sh
  --exclude=0005-banned-tone-words.md
)

# ----------------------------------------------------------------------------
# Gate A — banned tone words (CLAUDE.md §Critical Rules)
# Wordlist verbatim from CLAUDE.md: optimize, wellness, honor, journey, crush,
# nail, dial in, tune, vibe, unlock. Plus emoji (any UTF-8 4-byte sequence in
# the 0xF0 prefix range covers U+10000+, which contains every modern emoji).
# Word boundaries (\b) prevent false positives on legitimate substrings
# (e.g., "honored" vs. "honor", "tuned" vs. "tune").
# ----------------------------------------------------------------------------
TONE_WORDS_RE='\b(optimize|wellness|honor|journey|crush|nail|tune|vibe|unlock)\b|\bdial in\b'
EMOJI_RE=$'[\xf0-\xf4][\x80-\xbf][\x80-\xbf][\x80-\xbf]'

if "$GREP" -rEni "$TONE_WORDS_RE" "${REPO_EXCLUDES[@]}" . > /tmp/gate-a-tone.$$  2>/dev/null; then
  echo "::error::Gate A — banned tone word found (CLAUDE.md §Critical Rules):"
  cat /tmp/gate-a-tone.$$
  rm -f /tmp/gate-a-tone.$$
  exit 1
fi
rm -f /tmp/gate-a-tone.$$

if "$GREP" -rEn "$EMOJI_RE" "${REPO_EXCLUDES[@]}" . > /tmp/gate-a-emoji.$$ 2>/dev/null; then
  echo "::error::Gate A — emoji found (CLAUDE.md §Critical Rules — banned in all output):"
  cat /tmp/gate-a-emoji.$$
  rm -f /tmp/gate-a-emoji.$$
  exit 1
fi
rm -f /tmp/gate-a-emoji.$$

# ----------------------------------------------------------------------------
# Gate B — console.log / console.error / console.warn outside src/cli/** and
# test files. Biome's noConsole catches these inside src/, but the grep gate
# is the second layer that would catch (a) an inline `biome-ignore` and
# (b) any console.* call that landed in scripts/ or test/integration/.
# Test files (*.test.ts) are exempt by the biome.json override mirror.
# ----------------------------------------------------------------------------
CONSOLE_RE='\bconsole\.(log|error|warn)\s*\('

if "$GREP" -rEn "$CONSOLE_RE" --include='*.ts' src/ 2>/dev/null \
   | "$GREP" -Ev '^src/cli/' \
   | "$GREP" -Ev '\.test\.ts:' \
   > /tmp/gate-b.$$; then
  if [ -s /tmp/gate-b.$$ ]; then
    echo "::error::Gate B — console.log/error/warn outside src/cli/** and test files:"
    cat /tmp/gate-b.$$
    rm -f /tmp/gate-b.$$
    exit 1
  fi
fi
rm -f /tmp/gate-b.$$

# ----------------------------------------------------------------------------
# Gate C — process.stdout.write outside src/cli/commands/**/*.ts.
# D-04 + D-11: CLI command files are the approved human-facing-output point.
# Phase 2 Plan 05 broadened the scope from doctor.ts only to the entire
# src/cli/commands/ directory so init.ts and auth.ts can emit user-facing
# output too. All non-CLI-command code must route through Pino (stderr) or
# MCP framing. The src/cli/commands/ directory is NOT reachable from
# src/mcp/ — widening the scope here does not break ADR-0001's MCP-stdout
# purity contract.
# ----------------------------------------------------------------------------
STDOUT_RE='\bprocess\.stdout\.write\s*\('

if "$GREP" -rEn "$STDOUT_RE" --include='*.ts' src/ 2>/dev/null \
   | "$GREP" -Ev '^src/cli/commands/[A-Za-z0-9._/-]+\.ts:' \
   > /tmp/gate-c.$$; then
  if [ -s /tmp/gate-c.$$ ]; then
    echo "::error::Gate C — process.stdout.write outside src/cli/commands/**/*.ts:"
    cat /tmp/gate-c.$$
    rm -f /tmp/gate-c.$$
    exit 1
  fi
fi
rm -f /tmp/gate-c.$$

# ----------------------------------------------------------------------------
# Gate D — server.registerTool outside src/mcp/register.ts. D-09 + MR-01:
# every MCP tool registration must funnel through the register() wrapper so
# the try/catch/sanitize contract applies uniformly. A direct call from a
# tool module would bypass the sanitizer and risk leaking secrets through
# error responses. register.ts itself is the sole site allowed to call
# `server.registerTool(...)`; this gate enforces that contract at CI time.
# ----------------------------------------------------------------------------
REGISTER_TOOL_RE='\bserver\.registerTool\s*\('

# Test sources are exempt — register.test.ts must reference the method
# name in prose to describe the contract under test. The chokepoint
# applies to production tool modules, not their unit tests.
if "$GREP" -rEn "$REGISTER_TOOL_RE" --include='*.ts' src/mcp/ 2>/dev/null \
   | "$GREP" -Ev '^src/mcp/register\.ts:' \
   | "$GREP" -Ev '\.test\.ts:' \
   > /tmp/gate-d.$$; then
  if [ -s /tmp/gate-d.$$ ]; then
    echo "::error::Gate D — server.registerTool outside src/mcp/register.ts:"
    cat /tmp/gate-d.$$
    rm -f /tmp/gate-d.$$
    exit 1
  fi
fi
rm -f /tmp/gate-d.$$

echo "All grep gates passed."
exit 0
