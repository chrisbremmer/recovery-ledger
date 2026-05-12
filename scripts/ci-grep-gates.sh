#!/usr/bin/env bash
# CI grep gates — three rules that Biome cannot catch on its own.
#
# Gate A: banned tone words (CLAUDE.md "Critical Rules" list) — banned in code,
#         tests, formatters, configs, and docs other than the rule definitions
#         themselves. Self-exempt: CLAUDE.md (the rule source) and this script
#         (which has to spell the words to grep for them).
# Gate B: console.log / console.error / console.warn — banned outside src/cli/**
#         and test files (CLAUDE.md §Critical Rules — MCP stdout purity).
# Gate C: process.stdout.write — banned outside src/cli/commands/doctor.ts
#         (the one CLI output point per 01-CONTEXT.md D-04 + D-11).
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
# `--exclude-dir=test` (singular) was previously misspelled as `tests`, which
# silently scanned the real test/ directory. Fixed via WR-02. Keep both forms
# so a future `tests/` directory (e.g., consumer-side packaging tests) is also
# skipped without a script change. Documented intent: test files are
# treated as not user-facing copy and therefore exempt from the tone-words
# rule. If that policy ever changes, remove both exclusions and audit.
REPO_EXCLUDES=(
  --exclude-dir=.git
  --exclude-dir=.planning
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=coverage
  --exclude-dir=.worktrees
  --exclude-dir=test
  --exclude-dir=tests
  --exclude=CLAUDE.md
  --exclude=ci-grep-gates.sh
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
# Gate C — process.stdout.write outside src/cli/commands/doctor.ts.
# D-04 + D-11: the only approved CLI output point in v1 is the doctor command.
# All other code must route through Pino (stderr) or MCP framing.
# ----------------------------------------------------------------------------
STDOUT_RE='\bprocess\.stdout\.write\s*\('

if "$GREP" -rEn "$STDOUT_RE" --include='*.ts' src/ 2>/dev/null \
   | "$GREP" -Ev '^src/cli/commands/doctor\.ts:' \
   > /tmp/gate-c.$$; then
  if [ -s /tmp/gate-c.$$ ]; then
    echo "::error::Gate C — process.stdout.write outside src/cli/commands/doctor.ts:"
    cat /tmp/gate-c.$$
    rm -f /tmp/gate-c.$$
    exit 1
  fi
fi
rm -f /tmp/gate-c.$$

echo "All grep gates passed."
exit 0
