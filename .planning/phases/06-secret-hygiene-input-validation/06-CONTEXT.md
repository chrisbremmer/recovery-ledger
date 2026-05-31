# Phase 6 Context: Secret Hygiene & Input Validation

**Milestone:** v1.1 quality hardening
**Source roadmap:** `.planning/ROADMAP.md` § Phase 6
**Source research:** `.planning/research-v1.1/SUMMARY.md` (and STACK / FEATURES / ARCHITECTURE / PITFALLS)
**GitHub issues:** #78 (HIGH), #79 (HIGH), #80 (HIGH), plus selected #95 backlog items
**REQ-IDs:** SECH-01, SECH-02, INPV-01

## Goal

Land defensive fixes for #78, #79, #80 (and the #95 init.ts outer-catch + token-store `mkdir 0o700` + Pino-fatal sanitize items) so no live token material reaches stderr/stdout and `--since` rejects locale-dependent dates with a clear error.

Ships as **3 sub-PRs** off `main`:
- **Sub-PR A — SECH-01**: sanitizer camelCase keys + property tests (`#78`)
- **Sub-PR B — SECH-02**: doctor-path sanitize wraps + #95 init/Pino-fatal hygiene (`#79`, plus #95 init.ts:111-117, token-store.ts:222/239/313, mcp/index.ts:64)
- **Sub-PR C — INPV-01**: `--since` strict ISO via `z.iso.date()` (`#80`)

## In Scope

### Sub-PR A — SECH-01 (#78)

- File: `src/infrastructure/observability/sanitize.ts`
- Extend redaction key list with camelCase variants: `accessToken`, `refreshToken`, `clientSecret`, `clientId`, `idToken`, `apiKey`, `bearerToken` (plus their snake_case equivalents already covered).
- Add property-test-style fixtures (≥ 50 token-key shapes) verifying every input matches → output redacted.
- File: `src/infrastructure/observability/sanitize.test.ts` — extend existing test file.

### Sub-PR B — SECH-02 (#79 + #95 fold-ins)

- File: `src/services/doctor/checks/whoop-roundtrip.ts` — wrap `err.message` emission in `sanitize()` before returning the probe `detail` string.
- File: `src/cli/commands/doctor.ts` — outer catch must wrap `String(err)` with `sanitize()` (currently bypassed).
- File: `src/cli/commands/init.ts:111-117` — outer catch echoes raw `String(err)`; wrap with `sanitize()` to match `auth.ts`/`sync.ts`.
- File: `src/infrastructure/whoop/token-store.ts:222,239,313` — add `mode: 0o700` parameter to every `mkdir` call (consistent with `init.ts:102`).
- File: `src/mcp/index.ts:64` — Pino `fatal` does not sanitize `serializeError` output; wrap with `sanitize()` or expose `serializeAndSanitize` helper.
- Tests: extend `sanitize.test.ts` matrix with fixtures from `init.ts`/MCP fatal/token-store-mkdir error shapes.

### Sub-PR C — INPV-01 (#80 + #95 findByPrefix fold-in if scope allows)

- File: `src/cli/commands/sync.ts` (or wherever `--since` is parsed) — replace ad-hoc `Date(str)` parse with `z.iso.date()` validator from Zod v4.
- File: `src/infrastructure/db/repositories/decisions.repo.ts:131-143` — add `findByPrefix` min-length guard rejecting `prefix.length < 4` (optional fold-in if test surface allows).
- Reject inputs: `03/01/2026`, `yesterday`, `2026-13-01`, `2026-02-30`. Accept: `YYYY-MM-DD` and full ISO 8601 with time.
- CHANGELOG: explicit v1.1 breaking-change note pointing users at the supported format.

## Out of Scope

- All other v1.1 items (Phases 7-12).
- Adding any new dependency. The fix uses existing `sanitize.ts`, existing Pino, existing Zod v4.
- Refactoring sanitize.ts to live in `domain/` — that is ARCH-01 in Phase 10.
- Hardening Gate F regex — that is TSTC-02 in Phase 11.

## Dependencies

- v1.0 is complete (all touched files exist).
- No phase prerequisites; Phase 6 is the first v1.1 phase.

## Critical Rules Touched

- **ADR-0001 MCP stdout purity** — sanitize() outputs flow only to stderr / `serverError()` payloads. Pino fatal in mcp/index.ts:64 writes to stderr only.
- **ADR-0006 fixture-only tests** — property-style sanitize tests stay offline.

No other ADRs brushed.

## Success Criteria (from ROADMAP.md § Phase 6)

1. A grep of stderr capture + log dir after inducing every error path that walks a stored-tokens blob (WHOOP 401/500, `init` failure, `doctor` roundtrip failure, MCP transport fatal) yields zero matches for `Bearer`, JWT shape, `accessToken`, `refreshToken`, or `clientSecret` — verified by a property-test-style fixture matrix covering ≥ 50 token-key shapes.
2. `recovery-ledger doctor` (CLI) and `whoop_doctor` (MCP) emit identically-sanitized error text on `whoop_roundtrip` failure; the CLI doctor's outer catch wraps `sanitize()` consistently with `auth.ts`/`sync.ts`/`init.ts`.
3. `recovery-ledger sync --since 2026-02-30` and `--since 03/01/2026` and `--since yesterday` exit non-zero with a clear error pointing at `YYYY-MM-DD` ISO format; previously-valid `--since 2026-05-31` and `--since 2026-05-31T00:00:00Z` still succeed.
4. CHANGELOG entry calls out #80 as the only user-visible breaking change in v1.1.

## Test Plan

- `npm run lint` passes (Biome)
- `npm run test` passes (Vitest fixture-only, no live WHOOP)
- New tests added in: `src/infrastructure/observability/sanitize.test.ts`, `src/cli/commands/sync.test.ts` (--since validation), `src/services/doctor/checks/whoop-roundtrip.test.ts` (sanitized detail)

## Risks (from PITFALLS.md)

- **#80 user-visible breaking change** — `--since "yesterday"` was previously accepted. Surface in CHANGELOG; don't silently coerce.
- **Sanitize property-test sprawl** — keep the fixture matrix declarative (table-driven), not 50 individual test cases.
- **MCP stdout purity collision** — every new sanitize call site must verify it doesn't escape `console.log` accidentally. Use the existing stdout-purity test as a regression gate.

## References

- `.planning/research-v1.1/SUMMARY.md` § Pitfalls #80 + §6 Phase 6 outline
- `agent_docs/decisions/0001-mcp-stdout-purity.md`
- `agent_docs/decisions/0005-banned-tone-words.md` (no emoji in sanitize output)
- GitHub: #78, #79, #80, #95 (relevant items)
