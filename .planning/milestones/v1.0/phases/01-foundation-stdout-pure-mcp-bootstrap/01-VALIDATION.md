---
phase: 1
slug: foundation-stdout-pure-mcp-bootstrap
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-12
audited: 2026-05-14
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x (`pool: 'forks'`) |
| **Config file** | `vitest.config.ts` (installed in Wave 0) |
| **Quick run command** | `npm run test -- --reporter=dot` |
| **Full suite command** | `npm run test` |
| **Estimated runtime** | < 60 seconds local (CLAUDE.md §Testing budget) |

---

## Sampling Rate

- **After every task commit:** Run `npm run lint && npm run test -- --reporter=dot`
- **After every plan wave:** Run `npm run lint && npm run build && npm run test` plus both CI grep gates
- **Before `/gsd-verify-work`:** Full suite must be green AND `dist/` smoke subprocess test passes
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

> The planner will refine this table when concrete `<task_id>` slugs land in PLAN.md files. The rows below are anchored on the seven Phase 1 requirements (FND-01..FND-07) so coverage can be verified before plans are even written.

| Task Anchor | Plan (anticipated) | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|--------------------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| bootstrap-pkg | 01 | 1 | FND-01 | — | npm-managed Node 22 LTS project boots via `npm ci` on macOS-latest | integration | `npm ci && npm run build` | ✅ | ✅ green |
| bin-shebangs | 01 | 2 | FND-02 | — | `npx recovery-ledger` and `npx recovery-ledger-mcp` launch from compiled `dist/` with shebang intact | integration | `node -e "process.exit(require('node:fs').readFileSync('dist/cli.mjs','utf8').startsWith('#!/usr/bin/env node') ? 0 : 1)"` and same for `dist/mcp.mjs` | ✅ | ✅ green |
| version-banner | 01 | 2 | FND-03 | — | CLI prints version to stdout; MCP `initialize` returns serverInfo with name+version via JSON-RPC | integration | `node dist/cli.mjs --version` exits 0 with semver; subprocess fixture asserts MCP `initialize` reply has `serverInfo.version` | ✅ | ✅ green |
| stdout-purity-unit | 02 | 1 | FND-04 | T-MCP-STDOUT-01 | Pino destination is fd 2 in both dev and prod logger configs | unit | `npm run test -- src/infrastructure/config/logger.test.ts` | ✅ | ✅ green |
| stdout-purity-subprocess | 02 | 2 | FND-04, FND-07 | T-MCP-STDOUT-01 | Built `dist/mcp.mjs` emits only valid JSON-RPC frames on stdout during full init→tools/list→tools/call→shutdown sequence | integration | `npm run build && npm run test -- tests/integration/mcp-stdout-purity.test.ts` | ✅ | ✅ green |
| no-console-lint | 03 | 1 | FND-05 | T-MCP-STDOUT-01 | Biome `noConsole` rule fails build on any bare `console.*` call outside `src/cli/**`; tests exempt | unit | `npm run lint` exits 0 on clean tree; fixture commit with `console.log` in `src/services/foo.ts` exits non-zero | ✅ | ✅ green |
| ci-grep-gates | 03 | 2 | FND-05, FND-06 | T-MCP-STDOUT-01 | Three grep gates fail the build on (a) `biome-ignore.*noConsole`, (b) `server.registerTool` outside `src/mcp/register.ts`, (c) `process.stdout` outside `src/cli/` | integration | `bash scripts/ci-grep-gates.sh` exits 0 on clean tree; planted violations exit 1 | ✅ | ✅ green |
| sanitizer-unit | 04 | 1 | FND-06 | T-MCP-SANITIZE-01 | Sanitizer strips `Authorization: Bearer …`, JWT shape, bare `Bearer …`, and JSON token-key values from `Error.message` + cause chain | unit | `npm run test -- src/mcp/sanitize.test.ts` | ✅ | ✅ green |
| sanitizer-integration | 04 | 2 | FND-06 | T-MCP-SANITIZE-01 | `whoop_doctor` tool call response in the subprocess fixture contains no `Bearer`, no `Authorization`, and no JWT-shaped substring even when the underlying error carries them | integration | subprocess fixture asserts response.content[0].text matches none of the leak patterns | ✅ | ✅ green |
| native-load-probe | 05 | 1 | FND-07 | — | `better-sqlite3` and `@napi-rs/keyring` load and bind on the runtime platform without throwing | unit | `npm run test -- src/services/doctor/checks/native-modules.test.ts` (uses `new Database(':memory:').close()` + `new Entry(...)` constructor) | ✅ | ✅ green |
| doctor-output-shape | 05 | 2 | FND-07 | — | `recovery-ledger doctor` emits `{checks: [...], overall: 'pass'|'warn'|'fail'}` JSON to stdout; `--text` flag renders compact plaintext fallback | integration | `node dist/cli.mjs doctor` stdout parses as JSON with required shape; `node dist/cli.mjs doctor --text` exit 0 and matches plaintext fixture | ✅ | ✅ green |
| ci-green-required | 06 | 3 | FND-01..FND-07 | — | GitHub Actions workflow on macOS-latest runs `npm ci → lint → build → test → grep gates` and is green on `main` | integration | `gh run list --limit 1 --json conclusion --jq '.[0].conclusion'` returns `"success"` after merge | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `package.json` — npm-managed, ESM, `bin` entries for `recovery-ledger` + `recovery-ledger-mcp`, `engines.node: ">=22"`, scripts per CLAUDE.md §Bash
- [x] `tsconfig.json` — `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `module: NodeNext`, ESM
- [x] `tsup.config.ts` — shebang banner, `external: ['better-sqlite3', '@napi-rs/keyring']`, two entries (`src/cli/index.ts`, `src/mcp/index.ts`), output to `dist/` *(Phase 2 added a third entry: `src/infrastructure/whoop/token-store.ts` per Plan 02-08 BUILD-DEP)*
- [x] `vitest.config.ts` — `pool: 'forks'`, no watch by default, fixture path resolution *(Phase 2 extended include glob with `tests/**/*.test.ts` per Plan 02-08)*
- [x] `biome.json` — `noConsole` enabled globally with `src/cli/**/*.ts` override and `**/*.test.ts` exempt; `biome-ignore` for `noConsole` banned (enforced by CI grep gate, not Biome)
- [x] `tests/fixtures/mcp/initialize.json`, `tools-list.json`, `whoop-doctor-call.json` — committed NDJSON-RPC payloads for subprocess round-trip. (No `shutdown.json` — the subprocess test uses `child.stdin.end()` for graceful close; no fixture needed.)
- [x] `scripts/ci-grep-gates.sh` — grep gates with explicit exit codes (`if grep -qrn …; then exit 1; fi`) *(Phase 2 extended from 3 to 5 gates: Gate C broadened to `src/cli/commands/**/*.ts`; Gate E enforces ADR-0002 single-consumer of `oauth/oauth2/token`)*
- [x] `.github/workflows/ci.yml` — Node 22, single job, `npm ci → lint → build → test → grep-gates` *(Phase 2 expanded matrix to `[macos-latest, ubuntu-latest]` with ubuntu setting `RECOVERY_LEDGER_FORCE_FILE_STORE=1` per Plan 02-08)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `npx -y recovery-ledger-mcp` works from a fresh machine via the published bin | FND-02 | Requires npm publish + clean machine | Out of scope for Phase 1 CI; documented as Phase 5 follow-up. CI proves the bin entry and shebang are correct against `dist/`, which is the verifiable surrogate. |
| Manual MCP Inspector smoke (`npx @modelcontextprotocol/inspector node dist/mcp.mjs`) | FND-03, FND-04 | Inspector is an interactive TTY tool | Documented in CLAUDE.md §Bash; CI subprocess fixture provides equivalent automated coverage. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (the seven Wave 0 files above — `shutdown.json` removed)
- [x] No watch-mode flags (vitest runs in `run` mode in CI)
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-05-12

---

## Validation Audit 2026-05-14

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |
| Test files (full suite) | 20 |
| Tests passing | 266 / 266 |
| Lint | clean (49 files) |
| Build | success (3 entries: cli, mcp, token-store) |
| CI grep gates | all pass (5 gates) |
| Last CI run on `main` | success (2026-05-13) |

**Evidence captured during audit:**
- `npm run lint` → clean (49 files, 32ms)
- `npm run test` → 266 / 266 across 20 files (5.86s)
- `npm run build` → ESM build success (3 entries emitted, 119ms)
- `bash scripts/ci-grep-gates.sh` → `All grep gates passed.` (exit 0)
- `node dist/cli.mjs --version` → `0.1.0` (FND-03 stdout version banner)
- `node dist/cli.mjs doctor` → emits valid JSON `{checks, overall}` (FND-07 doctor-output-shape; `--text` flag wired)
- `head -1 dist/cli.mjs` and `head -1 dist/mcp.mjs` → `#!/usr/bin/env node` shebang intact on both bins (FND-02)
- `gh run list --limit 5` → 5 / 5 most recent CI runs `success` including `main` at 2026-05-13T01:15:26Z

**Notes:**
- Status column flipped ⬜ pending → ✅ green for all 12 anchor rows; phase complete since 2026-05-12 (Plan 01-06 SUMMARY).
- Path drift fixed: `test/integration/...` → `tests/integration/...` per directory consolidation in commit `f987690` (chore/consolidate-test-dirs).
- Wave 0 boxes ticked; annotations added where Phase 2 extended a Wave 0 artifact (tsup entries, vitest glob, CI grep gates, CI matrix).
- All 7 FND requirements (FND-01..FND-07) are CI-enforced. No manual-only rows added.
</content>
</invoke>
