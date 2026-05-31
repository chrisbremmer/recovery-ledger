---
phase: 05-doctor-polish-install-guide-20-minute-setup-validation
plan: 08
subsystem: docs-install
tags: [docs, install, mcp-clients, launchd, doc-04, doc-05]
requires:
  - 05-01  # docs/install/ + templates/ .gitkeep (Wave 0); doctor --offline/--stress flags
provides:
  - INSTALL.md  # root install entry
  - docs/install/whoop-app.md
  - docs/install/claude-code.md
  - docs/install/claude-desktop.md
  - docs/install/cursor.md
  - docs/install/launchd.md
  - templates/com.recovery-ledger.daily-sync.plist
affects:
  - README.md  # gains an Install link
tech-stack:
  added: []
  patterns:
    - "Hybrid install-doc layout (D-06): terse INSTALL.md root + per-client + topic files under docs/install/"
    - "D-10 convergent MCP wiring: identical mcpServers shape across 3 clients; only file location + reload semantics differ"
    - "D-15/D-16 launchd as static docs: zero auto-install, zero doctor probe; last_sync_recency is the after-the-fact signal"
key-files:
  created:
    - INSTALL.md
    - docs/install/whoop-app.md
    - docs/install/claude-code.md
    - docs/install/claude-desktop.md
    - docs/install/cursor.md
    - docs/install/launchd.md
    - templates/com.recovery-ledger.daily-sync.plist
  modified:
    - README.md
decisions:
  - "Factored the WHOOP dev-app checklist into its own docs/install/whoop-app.md (per D-06's 'shared across all clients' language) and kept INSTALL.md's section terse with a link, for length and findability."
  - "Documented `node dist/cli.mjs <cmd>` as the primary invocation form (no npm link required), with `recovery-ledger <cmd>` noted as the npm-link alternative — matches the verified bin name."
metrics:
  duration: ~15m
  completed: 2026-05-29
---

# Phase 5 Plan 08: Install Guide + launchd Template Summary

Shipped the DOC-04 install-guide tree (INSTALL.md + 5 docs under `docs/install/`) and the DOC-05 static launchd template, all passing the ADR-0005 tone gate (Gate A), with per-client MCP wiring reduced to a single divergent JSON snippet per D-10.

## What shipped

| File | Purpose |
|------|---------|
| `INSTALL.md` | Root install entry: prereqs, WHOOP setup link, quickstart, per-client links, troubleshooting/launchd/api-gap links, verify-your-install. 10 sections per RESEARCH §Finding 4.2. |
| `docs/install/whoop-app.md` | WHOOP developer-app checklist: scopes, redirect URI, credential retrieval, common mistakes. |
| `docs/install/claude-code.md` | Claude Code MCP wiring: `claude mcp add` one-liner + `.mcp.json` / `~/.claude.json` manual config. |
| `docs/install/claude-desktop.md` | Claude Desktop config at `~/Library/Application Support/Claude/claude_desktop_config.json` (GUI/JSON-only, no one-liner). |
| `docs/install/cursor.md` | Cursor config at `.cursor/mcp.json` (project) or `~/.cursor/mcp.json` (global). |
| `docs/install/launchd.md` | sed + launchctl load + verification dance; references the plist template. |
| `templates/com.recovery-ledger.daily-sync.plist` | Static launchd plist with `${HOME}` + `${RECOVERY_LEDGER_BIN}` placeholders. Valid XML (plutil OK). |
| `README.md` | Gains an `## Install` section linking to INSTALL.md. |

## CLI / bin verification (cross-checked against source)

Every command, subcommand, flag, and bin name documented was verified against the real source — no invented surface:

- **bin names** — `package.json` lines 6-9: `recovery-ledger` → `./dist/cli.mjs`, `recovery-ledger-mcp` → `./dist/mcp.mjs`. Docs use `node dist/cli.mjs` / `node dist/mcp.mjs` and the `recovery-ledger` PATH form.
- **`init`, `auth`, `sync`, `review daily`** — all registered in `src/cli/index.ts` (`.command('init')` L112, `.command('auth')` L129, `.command('sync')` L154, `reviewCmd.command('daily')` L188).
- **`sync --days 3`** (used by the plist) — `--days <n>` is a real flag (`src/cli/index.ts` L156, `parseDaysFlag`, default 30, max 365); `3` is valid.
- **`doctor`, `doctor --text`, `doctor --offline`, `doctor --stress`** — `src/cli/index.ts` L87-94. Exit codes `{pass:0, fail:1, warn:2}` per the `addHelpText` block L99-108 and documented in INSTALL.md/launchd.md.
- **doctor check names** referenced in docs — `token_freshness` and `last_sync_recency` are real `CHECK_NAMES` values (`src/services/doctor/checks/check-names.ts` L26, L38). The 14-check count claimed in the client docs matches the 14 entries in `CHECK_NAMES` (5 original + 9 Phase 5).
- **8 MCP tools** claimed in client docs — matches README MCP surface (8 tools) and the Gate H `tools.length === 8` target.

## Verification gates

| Gate | Result |
|------|--------|
| `bash scripts/ci-grep-gates.sh` (Gate A tone words + emoji + all 10 gates) | **PASS** — "All grep gates passed." exit 0 |
| `plutil -lint templates/com.recovery-ledger.daily-sync.plist` | **OK** — valid XML, exit 0 |
| All 7 install files exist + README links INSTALL.md | **PASS** |
| `troubleshooting.md` NOT created (Plan 05-09 owns it) | **PASS** — absent |
| JSON snippets in 3 client docs parse | **PASS** — all valid JSON |
| `npx tsc --noEmit` | **6 known baseline errors** (unchanged; docs-only) |
| Cross-link resolution | All targets exist except the intentional forward ref `docs/install/troubleshooting.md` (Plan 05-09) |

## Cross-links: status of every linked target

- Resolves now: `docs/install/whoop-app.md`, `claude-code.md`, `claude-desktop.md`, `cursor.md`, `launchd.md` (this plan); `docs/install/api-gap.md` (Plan 05-07, present); `agent_docs/decisions/0002-*.md`, `0007-*.md`; `INSTALL.md` (from client docs); `templates/com.recovery-ledger.daily-sync.plist` (from launchd.md).
- Forward reference (intentional, lands in same PR set): `docs/install/troubleshooting.md` — owned by Plan 05-09.

## Deviations from Plan

None affecting behavior. Notes:

- **Sibling-file form for the WHOOP checklist:** The plan's Task 2 `read_first` explicitly authorized either embedding the WHOOP checklist in INSTALL.md or factoring it to `docs/install/whoop-app.md`; chose the sibling-file form for length/findability, as the plan anticipated. Not a deviation — an authorized choice.
- **Parallel-agent files left untouched:** `git status` showed `package.json`, `vitest.config.ts`, `scripts/generate-api-gap-md.ts`, `scripts/generate-api-gap-md.test.ts`, `tests/contract/api-gap-md-parity.test.ts`, and `docs/install/api-gap.md` as modified/untracked. These belong to the concurrent Wave 2 docs agent (Plan 05-07) and were correctly left out of scope.

## Known Stubs

None. All docs are complete content; the only unresolved link is the documented forward reference to `docs/install/troubleshooting.md` (Plan 05-09).

## Handoff

- Files left **unstaged and uncommitted** per orchestrator instruction — the orchestrator commits after both parallel Wave 2 docs agents return.
- Plan 05-09 must create `docs/install/troubleshooting.md` with one `## <name>` H2 per `CHECK_NAMES` value (14 sections), which resolves the only outstanding forward link.

## Self-Check: PASSED

- All 7 created files verified present on disk (`test -f`).
- README.md verified to contain `INSTALL.md` link via surgical diff (only `## Install` section added).
- Gate A green; plist lint OK; tsc baseline unchanged at 6 errors.
- No commit hashes to verify — this plan leaves files uncommitted by design (orchestrator commits Wave 2).
