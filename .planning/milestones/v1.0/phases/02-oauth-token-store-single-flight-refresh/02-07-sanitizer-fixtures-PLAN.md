---
phase: 02-oauth-token-store-single-flight-refresh
plan: 07
type: execute
wave: 1
depends_on: []
files_modified:
  - src/mcp/sanitize.test.ts
autonomous: true
requirements:
  - AUTH-06
user_setup: []

must_haves:
  truths:
    - "D-19: Phase 2 owns adding OAuth-code (`\\bcode=([A-Za-z0-9._~-]{10,})`) and client_secret JSON-key patterns to src/mcp/sanitize.ts; Phase 1 already covered client_secret, so D-19 collapses to test-fixture additions only (F6/F7)."
    - "src/mcp/sanitize.test.ts F-block contains a D-20 verbatim fixture: OAuth callback failure with code=eyJ...signature123 + client_secret=hunter2 in a cause chain → both values redacted to `<redacted>`."
    - "Plus positive/negative cases per D-20: short `code=12` is NOT stripped (length guard prevents stripping the English word `code`)."
    - "Plus fixtures covering Bearer/JWT/refresh_token/access_token in URL, JSON, form-body, and bare-literal positions (per Validation Strategy Wave-0 sampling)."
    - "All sanitize.test.ts tests still pass — no regression in the existing 20 Phase 1 cases."
    - "Phase 2 makes NO src/mcp/sanitize.ts code changes — the existing SECRET_KEY_NAMES already covers `code` and `client_secret` per RESEARCH lines 768-787."
    - "D-18 satisfied: src/mcp/register.ts (Phase 1 wrapper that runs `sanitize(serializeError(err))` around every server.registerTool throw-path) is unchanged. The new error kinds added in Phase 2 (auth_port_in_use added in Plan 02-01; auth_expired surfaced via Plan 02-04's orchestrator) flow through unchanged sanitizer paths — verified by grep that `src/mcp/register.ts` is NOT modified by ANY plan in this phase, and the F7 cause-chain fixture exercises the unchanged walker behavior end-to-end."
  artifacts:
    - path: "src/mcp/sanitize.test.ts"
      provides: "Extended with D-20 OAuth-cause-chain fixture (F7) + Bearer/JWT/refresh_token/access_token positional fixtures."
      contains: "OAuth callback failed"
  key_links:
    - from: "src/mcp/sanitize.test.ts F7 fixture"
      to: "src/mcp/sanitize.ts SECRET_KEY_NAMES (Phase 1)"
      via: "fixture exercises the existing `code` (line 29) + `client_secret` (line 21) patterns; verifies they catch the OAuth-specific shapes from D-20"
      pattern: "code=<redacted>"
    - from: "src/mcp/sanitize.test.ts F7 fixture (cause-chain walking)"
      to: "src/mcp/register.ts (Phase 1, D-18)"
      via: "F7 exercises the same serializeError + sanitize pipeline that register.ts wraps around every tool throw-path; Phase 2 adds NO new MCP tools (D-17) and modifies register.ts ZERO times"
      pattern: "serializeError"
---

<objective>
Extend Phase 1's sanitize.test.ts with the D-20 OAuth callback failure fixture plus positional fixtures for Bearer/JWT/refresh_token/access_token in URL, JSON, form-body, and bare-literal positions. This is the load-bearing assertion that the existing Phase 1 sanitizer ALREADY covers the Phase 2 OAuth-specific leak shapes — no `sanitize.ts` regex changes are needed.

Per checker WARNING D-COV-17-18 fix: this plan also explicitly attests to D-18 (any error path that bubbles through MCP goes through `src/mcp/register.ts`'s wrapper, hence through the sanitizer). The plan reads register.ts to verify it is unchanged and adds a must_haves truth pinning that property.

Purpose: AUTH-06 (token-leak prevention covered by FND-06). RESEARCH confirms (lines 768-787) that `code` and `client_secret` are already in Phase 1's SECRET_KEY_NAMES; this plan's job is to add the fixtures that exercise those patterns against OAuth-specific error shapes from D-20.

Output: One file modified — `src/mcp/sanitize.test.ts` gains ~8 new tests in the F-block (errors-that-historically-leak) and corresponding positive/negative coverage in the P-blocks. No production-code changes. NO modification to register.ts (verified at acceptance time).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md
@.planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md
@CLAUDE.md
@agent_docs/conventions.md
@agent_docs/decisions/0001-mcp-stdout-purity.md
@src/mcp/sanitize.ts
@src/mcp/sanitize.test.ts
@src/mcp/register.ts

<interfaces>
<!-- The existing sanitize.ts surface — Phase 2 adds tests, not code. register.ts is also unchanged (D-18). -->

From Phase 1 src/mcp/sanitize.ts (read on 2026-05-12; per RESEARCH lines 768-787):
- `SECRET_KEY_NAMES` const array on line 18-30 ALREADY contains `'code'` (line 29) and `'client_secret'` (line 21). Plus `'access_token'`, `'refresh_token'`, `'id_token'`, `'session_token'`, `'api_key'`, `'api_token'`, `'secret'`, `'password'`, `'private_key'`.
- `PATTERNS` array (lines 38-146) covers: P1 Bearer-with-length-guard, P2/P2b URL query / form-body / JSON key forms for SECRET_KEY_NAMES, P3 JWT shape, P4 Authorization header — all chained via the cause-walker (D-08 from Phase 1).
- `serializeError(err)` walks the Error.cause chain (depth-capped) and applies sanitize() to every leaf.

From Phase 1 src/mcp/register.ts (D-18 attestation):
- The Phase 1 wrapper that runs `sanitize(serializeError(err))` around every `server.registerTool` throw-path AND success-path string leaves.
- Phase 2 modifies register.ts ZERO times. The Phase 1 `whoop_doctor` tool (the only MCP-surfaced tool in Phase 2) is wired through this wrapper already. New AuthErrorKinds added in Phase 2 (`auth_port_in_use` from Plan 02-01; `auth_expired` surfaced via Plan 02-04's orchestrator) flow through unchanged.

D-20 fixture (per CONTEXT lines 64-65 + PATTERNS lines 332-348):
```typescript
test('F7 — OAuth callback failed cause chain redacts both code= and client_secret=', () => {
  const err = new Error('OAuth callback failed', {
    cause: new Error('redirect ?code=eyJabc.eyJdef.signature123 with client_secret=hunter2'),
  });
  const out = sanitize(serializeError(err));
  expect(out).not.toContain('eyJabc.eyJdef.signature123');
  expect(out).not.toContain('hunter2');
  expect(out).toContain('code=<redacted>');
  expect(out).toContain('client_secret=<redacted>');
});
```

Positional fixtures required by Validation Strategy line 55 ("Bearer/JWT/refresh_token/access_token fixtures"):
1. Bearer in `Authorization` HTTP header literal (existing P1 should cover; add an explicit assertion if not present).
2. JWT shape standalone (no `Bearer` prefix) — `eyJabc.eyJdef.sig` in a bare error message. (Existing P3 covers; verify.)
3. `refresh_token` in URL query: `?refresh_token=rt_secret&grant_type=...`.
4. `refresh_token` in JSON body: `{"refresh_token": "rt_secret"}`.
5. `refresh_token` in form body: `grant_type=refresh_token&refresh_token=rt_secret&client_id=c`.
6. `access_token` in JSON body: `{"access_token": "at_secret"}`.
7. `access_token` in URL query: `?access_token=at_secret`.
8. `access_token` as bare literal value: `Bearer at_secret_looks_jwt_like_too` — Bearer pattern catches.

Negative cases (must NOT redact):
- N-01: `code=12` short value (< 10 chars) — existing length guard prevents stripping. Asserts `out.toContain('code=12')`.
- N-02: English word "code" alone — `out.toContain('code')` (no `<redacted>` insertion).

Existing sanitize.test.ts structure (per PATTERNS line 315-354):
- Has P-blocks at lines 24-315 (positive cases per pattern).
- Has F-block at lines 408-469 (errors-that-historically-leak fixtures).
- D-10 fixtures F1-F5 already present from Phase 1.
- Phase 2 appends F6 (Bearer/JWT/refresh_token/access_token positional matrix) and F7 (OAuth callback failed cause chain).

No production-code changes — `src/mcp/sanitize.ts` is touched zero times. `src/mcp/register.ts` is touched zero times (D-18 attestation).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Append D-20 + positional fixtures to sanitize.test.ts (and verify register.ts is unchanged for D-18 attestation)</name>
  <files>
    src/mcp/sanitize.test.ts
  </files>
  <read_first>
    - src/mcp/sanitize.test.ts (Phase 1 file — read current structure including the F-block at lines 408-469 and the existing P-blocks)
    - src/mcp/sanitize.ts (Phase 1 — confirm SECRET_KEY_NAMES contents AND the PATTERNS array; verify `code` line 29 and `client_secret` line 21 are present; do NOT modify this file)
    - src/mcp/register.ts (Phase 1 — read to confirm it is the unmodified wrapper that runs sanitize(serializeError(err)). Phase 2 does NOT modify this file. The D-18 attestation in must_haves.truths depends on this.)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-CONTEXT.md (D-17, D-18, D-19, D-20)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-RESEARCH.md (lines 768-787 — Phase 1 already covers `code` and `client_secret`; Phase 2 owes test fixtures only; lines 873-877 — Open Question 4 recommends inline string literal for the fixture, NOT a JSON file)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md (lines 315-354 — D-20 fixture sketch; F7 placement; length-guard negative case already covered by P4- precedent)
    - .planning/phases/02-oauth-token-store-single-flight-refresh/02-VALIDATION.md (line 55 — Bearer/JWT/refresh_token/access_token fixtures required at Wave-0)
  </read_first>
  <behavior>
    F6 — Bearer/JWT/refresh_token/access_token positional matrix (one describe block):
    - F6.01 Bearer in Authorization header literal: input `Authorization: Bearer eyJ...long.string.value` → output contains `Bearer <redacted>` (or whatever the Phase 1 P1 substitution renders); does NOT contain the JWT body.
    - F6.02 JWT shape standalone (no Bearer prefix): input `error: eyJabc.eyJdef.signature123` → output does NOT contain `eyJabc.eyJdef.signature123`; output contains `<redacted>` (or whatever Phase 1's P3 renders).
    - F6.03 refresh_token in URL query: input `https://api.prod.whoop.com/oauth/oauth2/token?refresh_token=rt_secret_long_value&grant_type=refresh_token` → output does NOT contain `rt_secret_long_value`; output contains `refresh_token=<redacted>` AND retains the literal `grant_type=refresh_token` (so the OAuth grant TYPE is preserved as a debugging signal even when the token VALUE is redacted — this is the existing Phase 1 behavior per P2/P2b).
    - F6.04 refresh_token in JSON body: input `{"refresh_token": "rt_json_secret"}` → output does NOT contain `rt_json_secret`; contains `"refresh_token":"<redacted>"` (or whatever P2b renders).
    - F6.05 refresh_token in form body: input `grant_type=refresh_token&refresh_token=rt_form_secret&client_id=c` → output does NOT contain `rt_form_secret`; retains `grant_type=refresh_token`.
    - F6.06 access_token in JSON body: input `{"access_token": "at_json_secret"}` → output does NOT contain `at_json_secret`.
    - F6.07 access_token in URL query: input `?access_token=at_query_secret&user=me` → output does NOT contain `at_query_secret`; retains `user=me`.
    - F6.08 access_token as Bearer-prefixed value: input `Bearer at_secret_long_enough_to_match` → output does NOT contain `at_secret_long_enough_to_match`.

    F7 — D-20 verbatim fixture:
    - F7.01: exactly the fixture from CONTEXT D-20 / PATTERNS line 337-348. Inline `new Error('OAuth callback failed', { cause: new Error('redirect ?code=eyJabc.eyJdef.signature123 with client_secret=hunter2') })`. Asserts: out does NOT contain `'eyJabc.eyJdef.signature123'`, does NOT contain `'hunter2'`, DOES contain `code=<redacted>`, DOES contain `client_secret=<redacted>`. Verifies sanitizer walks the cause chain (Phase 1 D-08 cause walker) AND catches both leak shapes.

    Negative cases:
    - N-01: `sanitize('code=12')` returns `'code=12'` (length guard prevents stripping short value — P4- precedent in existing tests).
    - N-02: `sanitize('Please add code here')` returns the same string with `code` intact (no false-positive replacement of the English word).
    - N-03 (defense against false positives on long English words near 'code'): `sanitize('decoded')` returns `'decoded'` (substring `code` inside `decoded` is NOT touched — the `\b` boundary in P2 prevents partial-word stripping; if the existing sanitize.ts does NOT use `\b`, the test still passes because the surrounding context `de...d` doesn't fit the `code=` URL/form/JSON shape).

    No regression:
    - All existing 20 Phase 1 sanitize tests still pass.
  </behavior>
  <action>
    Open `src/mcp/sanitize.test.ts`. Confirm the file structure:
    - Existing imports at the top (sanitize, serializeError, SECRET_KEY_NAMES).
    - P-blocks (P1, P2/P2b, P3, P4) covering individual patterns.
    - F-block at lines ~408-469 covering "errors that historically leak" with F1-F5 already present.

    Append two new `describe` blocks to the F-block section (after F5, before any closing `});`):

    1. `describe('F6 — Bearer/JWT/refresh_token/access_token positional matrix')` — contains 8 tests F6.01..F6.08 per <behavior>. Each test follows the existing F-block pattern:
       ```typescript
       test('F6.NN — <name>', () => {
         const out = sanitize('<input>');
         expect(out).not.toContain('<secret value>');
         expect(out).toContain('<expected redaction shape>');
       });
       ```
       For tests that exercise cause-chain walking (rare in this block — most F6 cases are flat strings), use `serializeError(new Error(input))` to walk through Phase 1's D-08 cause walker; for plain strings, call sanitize directly.

    2. `describe('F7 — D-20 OAuth callback failure cause chain')` — contains 1 test F7.01 per <behavior>. The exact fixture from PATTERNS line 337-348:
       ```typescript
       test('F7.01 — OAuth callback failed cause chain redacts both code= and client_secret=', () => {
         const err = new Error('OAuth callback failed', {
           cause: new Error('redirect ?code=eyJabc.eyJdef.signature123 with client_secret=hunter2'),
         });
         const out = sanitize(serializeError(err));
         expect(out).not.toContain('eyJabc.eyJdef.signature123');
         expect(out).not.toContain('hunter2');
         expect(out).toContain('code=<redacted>');
         expect(out).toContain('client_secret=<redacted>');
       });
       ```

    3. Append 3 negative-case tests N-01..N-03 to either the F-block or an existing P-block (whichever fits style — recommend extending the P4- block since the precedent length-guard tests live there per PATTERNS line 352).

    Do NOT modify `src/mcp/sanitize.ts`. Do NOT modify `src/mcp/register.ts` (D-18 attestation: the Phase 1 wrapper that runs `sanitize(serializeError(err))` around every tool throw-path is unchanged; new error kinds from Phase 2 flow through unchanged sanitizer paths). The plan is test-only.

    If a fixture fails to produce the expected redaction (the Phase 1 sanitizer does NOT cover the case), STOP and document the failure — that would be a Phase 2 RESEARCH-vs-actual delta requiring escalation to the planner. Do NOT add new patterns to sanitize.ts as a workaround; that violates D-19 + RESEARCH-confirmed scope.
  </action>
  <verify>
    <automated>npm run test -- --run src/mcp/sanitize.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `src/mcp/sanitize.test.ts` is the only file modified by this plan.
    - `src/mcp/sanitize.ts` is NOT modified: `git diff --name-only` (run after the task) does NOT include `src/mcp/sanitize.ts`.
    - `src/mcp/register.ts` is NOT modified (D-18 attestation): `git diff --name-only` does NOT include `src/mcp/register.ts`.
    - `src/mcp/sanitize.test.ts` contains a `describe('F6'...)` block: `grep -nE "describe\\('F6" src/mcp/sanitize.test.ts` returns >= 1 match.
    - `src/mcp/sanitize.test.ts` contains a `describe('F7'...)` block: `grep -nE "describe\\('F7" src/mcp/sanitize.test.ts` returns >= 1 match.
    - The F7 fixture contains the verbatim strings `eyJabc.eyJdef.signature123` and `hunter2` (as the input fixture being asserted-not-present after sanitization): `grep -nE 'eyJabc\.eyJdef\.signature123' src/mcp/sanitize.test.ts` returns >= 1 match; `grep -nE 'hunter2' src/mcp/sanitize.test.ts` returns >= 1 match.
    - The F-block now contains at least 14 test cases total (5 from Phase 1 + 8 new F6 + 1 new F7): `grep -nE "test\\('F[1-7]\\." src/mcp/sanitize.test.ts | wc -l` returns >= 14.
    - At least 3 negative-case tests have been added: `grep -nE "test\\('N[0-9]" src/mcp/sanitize.test.ts | wc -l` returns >= 3 (assuming the planner uses an N-prefix; if a different naming convention exists from Phase 1, match that — but ensure at least 3 negative cases are added).
    - `npm run test -- --run src/mcp/sanitize.test.ts` exits 0 with a count that includes the existing 20 Phase 1 tests + the new tests (total ~32+).
    - `npm run lint` exits 0.
  </acceptance_criteria>
  <done>
    sanitize.test.ts gains the D-20 verbatim fixture (F7) + the 8-case Bearer/JWT/refresh_token/access_token positional matrix (F6) + 3 negative cases. No production-code changes. register.ts is unchanged (D-18 attestation). All existing Phase 1 tests still pass. Phase 1 sanitizer is verified to cover Phase 2's OAuth-specific leak shapes without modification.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| sanitizer input → output | sanitize() is a pure function; the boundary it protects is "any error string that reaches a user-visible surface (stdout, stderr, MCP error return, log file) MUST go through this function first" |
| test fixture inputs | static literals in the test file; not derived from any external source |
| register.ts wrapper (D-18) | every MCP tool throw-path crosses this boundary; the wrapper applies sanitize(serializeError(err)) — Phase 2 modifies this file ZERO times |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02.07-01 | Information Disclosure | OAuth code= leaks via error message | mitigate | F7.01 fixture verifies Phase 1's existing `code` SECRET_KEY_NAMES entry (line 29 of sanitize.ts) catches the D-20 specific shape (cause-chain Error with `?code=eyJ...` interpolated). ASVS V7. |
| T-02.07-02 | Information Disclosure | client_secret leaks via error message | mitigate | F7.01 fixture verifies Phase 1's `client_secret` SECRET_KEY_NAMES entry (line 21 of sanitize.ts) catches the OAuth-specific shape. ASVS V8. |
| T-02.07-03 | Information Disclosure | Bearer / JWT-shape access_token in error | mitigate | F6.01, F6.02, F6.06, F6.07, F6.08 — positional matrix covering URL, JSON, form, header, bare-literal positions. Phase 1's P1 (Bearer), P3 (JWT shape), P2/P2b (key-value) cover these; F6 verifies coverage. ASVS V7. |
| T-02.07-04 | Information Disclosure | refresh_token leaks via OAuth POST body in error | mitigate | F6.03, F6.04, F6.05 — URL query, JSON body, form body positions all redacted. The `grant_type=refresh_token` literal is RETAINED as a debugging signal (this is Phase 1's intentional behavior — see PATTERNS line 322-330 + the existing P2 anchor: only KEY names from SECRET_KEY_NAMES followed by `=value` or `: value` get the value-portion stripped). ASVS V7. |
| T-02.07-05 | Tampering | false-positive redaction of English text | mitigate | N-01..N-03 negative cases pin Phase 1's length-guard and word-boundary behavior so a future regex change doesn't silently start stripping legitimate words. ASVS V5. |
| T-02.07-06 | Tampering | future change to sanitize.ts breaks Phase 2 coverage | mitigate | The F6+F7 fixture set is now part of the CI test suite. Any future modification to sanitize.ts that regresses OAuth-shape coverage fails CI. ASVS V11. |
| T-02.07-07 | Information Disclosure | new Phase 2 AuthError kinds bypass register.ts sanitizer (D-18) | mitigate | register.ts is unchanged in Phase 2 (verified by `git diff` acceptance criterion). The wrapper runs sanitize(serializeError(err)) over EVERY tool throw — kind-agnostic. New kinds (auth_port_in_use, auth_expired) flow through the same pipeline. F7 fixture exercises the cause-chain path end-to-end. ASVS V7. |
</threat_model>

<verification>
- `src/mcp/sanitize.test.ts` modified; `src/mcp/sanitize.ts` unmodified; `src/mcp/register.ts` unmodified (D-18 attestation).
- F6 and F7 describe blocks present in sanitize.test.ts.
- D-20 verbatim fixture (F7) shipped with assertions on both `code=` and `client_secret=` redaction.
- 8 positional fixtures (F6.01..F6.08) cover Bearer/JWT/refresh_token/access_token in URL/JSON/form/header positions.
- 3 negative cases pin the length-guard and word-boundary behavior.
- `npm run test -- --run src/mcp/sanitize.test.ts` exits 0 with ~32+ tests.
- `bash scripts/ci-grep-gates.sh` exits 0 (no production-code changes to grep).
- `npm run lint` exits 0.
</verification>

<success_criteria>
- AUTH-06 verified: Phase 1's sanitizer is now CI-enforced to cover all Phase 2 OAuth-specific leak shapes.
- D-20 fixture lands inline per Research Open Question 4 recommendation.
- Bearer/JWT/refresh_token/access_token positional matrix verifies coverage in all four positions (URL/JSON/form/header).
- Phase 2 makes ZERO production-code changes to sanitize.ts — confirms the RESEARCH finding (lines 768-787) that Phase 1's SECRET_KEY_NAMES already covers `code` and `client_secret`.
- D-18 satisfied: register.ts is unchanged; new Phase 2 AuthError kinds (auth_port_in_use, auth_expired) flow through the unchanged sanitizer wrapper. Truth pinned in must_haves.truths.
- Plan 08's `grep -v Bearer` end-to-end assertion will be satisfied because the underlying sanitizer is now provably covering every leak shape.
</success_criteria>

<output>
After completion, create `.planning/phases/02-oauth-token-store-single-flight-refresh/02-07-SUMMARY.md`.
</output>
