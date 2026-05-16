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
# Gate E: only src/infrastructure/whoop/token-store.ts may reference the WHOOP
#         refresh endpoint (oauth/oauth2/token). ADR-0002 §Enforcement: the
#         token-store module is the sole consumer of the refresh endpoint.
#         Biome's noRestrictedImports operates on import paths, not URL
#         strings, so this grep gate is the load-bearing enforcement for
#         literal URL references. Test files (*.test.ts) are excluded — the
#         Plan 02-07 fixture in src/mcp/sanitize.test.ts deliberately
#         includes the URL as a redaction-coverage test input, and
#         src/infrastructure/whoop/oauth.test.ts has test cases that
#         exercise the URL constant in error paths. Production-module
#         enforcement intent is intact.
#         Note: literal-string gate — URL-construction-via-concatenation
#         bypass is documented as out-of-scope for Plan 02-06 (single-user
#         personal tool; a developer concatenating the URL would be
#         deliberately bypassing their own constraint).
# Gate F: no fetch( outside src/infrastructure/whoop/{client,token-store,oauth}.ts.
#         Phase 3 D-21 + ADR-0007: the WHOOP HTTPS boundary is monolithic.
#         Any other fetch( call site bypasses callWithAuth, the rate-limit
#         semaphore (D-20), retry, and Zod validation. Test files exempt.
# Gate G: no drizzle-orm/* import outside src/infrastructure/db/. Phase 3 D-28
#         + ARCHITECTURE.md Anti-Pattern 3: Drizzle row types never in
#         src/domain/ or src/services/; repositories map at the boundary.
#         Test files exempt.
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
# Policy (MR-04): exclude test SOURCE files (*.test.ts) but NOT the tests/
# directory wholesale. ADR-0005 (banned tone words) explicitly scopes the
# rule to `src/formatters/`, `src/cli/`, AND `tests/fixtures/review/` — so
# fixture JSON under tests/fixtures/ must remain in scope. Excluding the
# entire tests/ directory (the WR-02 fix) silently skipped review fixtures
# the ADR considers user-facing copy. We instead exclude only files
# matching `*.test.ts` (the unit/integration test sources, which are not
# user-facing copy) and let fixture files under tests/fixtures/ stay in
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
# (b) any console.* call that landed in scripts/ or tests/integration/.
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

# ----------------------------------------------------------------------------
# Gate E — only src/infrastructure/whoop/token-store.ts may reference the
# WHOOP refresh endpoint. ADR-0002 §Enforcement (line 70): "Token-store
# module is the only consumer of the refresh endpoint." Biome's
# noRestrictedImports operates on import paths, not URL strings, so this
# grep gate is the load-bearing enforcement for literal URL references.
#
# Test files (*.test.ts) are excluded for two reasons:
#  - src/mcp/sanitize.test.ts has a Plan 02-07 fixture that includes the
#    literal URL as a redaction-coverage test input.
#  - src/infrastructure/whoop/oauth.test.ts has test cases that reference
#    the URL constant in error paths (Plan 02-03).
# Production-module enforcement intent is preserved (Plan 02-02 and 02-03
# both flagged the test-file exclusion as a required Plan 06 input).
#
# URL-construction-via-concatenation bypass is intentionally out-of-scope:
# Recovery Ledger is a single-user personal tool, and a developer
# concatenating the endpoint URL to bypass this gate would be deliberately
# bypassing their own constraint.
# ----------------------------------------------------------------------------
TOKEN_ENDPOINT_RE='oauth/oauth2/token'

if "$GREP" -rEn "$TOKEN_ENDPOINT_RE" --include='*.ts' src/ 2>/dev/null \
   | "$GREP" -Ev '^src/infrastructure/whoop/token-store\.ts:' \
   | "$GREP" -Ev '\.test\.ts:' \
   > /tmp/gate-e.$$; then
  if [ -s /tmp/gate-e.$$ ]; then
    echo "::error::Gate E — oauth/oauth2/token referenced outside src/infrastructure/whoop/token-store.ts:"
    cat /tmp/gate-e.$$
    rm -f /tmp/gate-e.$$
    exit 1
  fi
fi
rm -f /tmp/gate-e.$$

# ----------------------------------------------------------------------------
# Gate F — no fetch( outside src/infrastructure/whoop/client.ts,
# src/infrastructure/whoop/token-store.ts, src/infrastructure/whoop/oauth.ts.
# D-21 + ADR-0007 (read-only WHOOP, GET-only) + ADR-0002 §Enforcement: the
# WHOOP HTTPS boundary is monolithic. Any other fetch( call site bypasses
# callWithAuth (the Plan 02-04 401-reactive chokepoint), the rate-limit
# semaphore (D-20), retry, and Zod validation.
#
# At Wave 0 land time this gate is green-on-empty: client.ts does not
# exist yet; token-store.ts and oauth.ts are the only files in src/
# that call fetch( and both are allowlisted. The gate's value lands the
# moment Wave 2 Plan 03-06 writes client.ts with the third fetch( site.
#
# Test files (*.test.ts) are excluded — mirrors Gate E rationale: a
# contract test for client.ts will naturally reference fetch in MSW
# fixtures, and that is fine; the chokepoint applies to production
# modules, not their unit tests.
# ----------------------------------------------------------------------------
FETCH_RE='\bfetch\s*\('

if "$GREP" -rEn "$FETCH_RE" --include='*.ts' src/ 2>/dev/null \
   | "$GREP" -Ev '^src/infrastructure/whoop/client\.ts:' \
   | "$GREP" -Ev '^src/infrastructure/whoop/token-store\.ts:' \
   | "$GREP" -Ev '^src/infrastructure/whoop/oauth\.ts:' \
   | "$GREP" -Ev '\.test\.ts:' \
   > /tmp/gate-f.$$; then
  if [ -s /tmp/gate-f.$$ ]; then
    echo "::error::Gate F — fetch( outside src/infrastructure/whoop/{client,token-store,oauth}.ts:"
    cat /tmp/gate-f.$$
    rm -f /tmp/gate-f.$$
    exit 1
  fi
fi
rm -f /tmp/gate-f.$$

# ----------------------------------------------------------------------------
# Gate G — no drizzle-orm/* import outside src/infrastructure/db/.
# ARCHITECTURE.md Anti-Pattern 3 + D-28: Drizzle row types must never appear
# in src/domain/ or src/services/. Repositories return domain entity types;
# the snake_case-to-camelCase mapping + JSON parse + score-state narrowing
# all live inside the repository file at the boundary. A drizzle-orm/*
# import anywhere else means a Drizzle row type has leaked out of the
# infrastructure layer.
#
# Regex matches `from '...drizzle-orm...'` (and `from "..."`) only --
# bare identifier mentions of "drizzle-orm" in comments or strings do not
# trip the gate. Directory-prefix exclude is anchored at
# `^src/infrastructure/db/` so a sibling directory cannot match by
# substring.
#
# At Wave 0 land time this gate is green-on-empty: there are zero
# drizzle-orm/* imports anywhere in src/ yet. The gate's value lands the
# moment Wave 1 Plan 03-02 writes src/infrastructure/db/schema.ts with
# the first `from 'drizzle-orm/sqlite-core'` import.
# ----------------------------------------------------------------------------
DRIZZLE_IMPORT_RE="from\s+['\"]drizzle-orm"

if "$GREP" -rEn "$DRIZZLE_IMPORT_RE" --include='*.ts' src/ 2>/dev/null \
   | "$GREP" -Ev '^src/infrastructure/db/' \
   | "$GREP" -Ev '\.test\.ts:' \
   > /tmp/gate-g.$$; then
  if [ -s /tmp/gate-g.$$ ]; then
    echo "::error::Gate G — drizzle-orm/* imported outside src/infrastructure/db/:"
    cat /tmp/gate-g.$$
    rm -f /tmp/gate-g.$$
    exit 1
  fi
fi
rm -f /tmp/gate-g.$$

echo "All grep gates passed."
exit 0
