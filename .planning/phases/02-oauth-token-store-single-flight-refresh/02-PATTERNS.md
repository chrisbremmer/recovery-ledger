# Phase 2: OAuth, Token Store & Single-Flight Refresh — Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 23 new/modified
**Analogs found:** 19 / 23 (4 are net-new patterns with no in-repo analog — flagged below)

## Repo State Sanity Check (as of 2026-05-12)

Confirmed against the repo before writing patterns:

- `src/infrastructure/` exists with **only** `config/` (logger). **No `whoop/` subdirectory yet.** Phase 2 creates it.
- `src/cli/commands/` contains only `doctor.ts` and `doctor.test.ts`. `init.ts` / `auth.ts` do not exist.
- `src/services/doctor/checks/` contains: `native-modules.ts`, `mcp-stdout-purity.ts`, `check-names.ts`, `fixtures.ts`, plus tests. **No `auth.ts` / `token-freshness.ts` yet.**
- `src/mcp/sanitize.ts` **already covers** `code` (line 29) AND `client_secret` (line 21) in `SECRET_KEY_NAMES`. Tests at `sanitize.test.ts` lines 107–118 and 164–171 already exercise both. **CONTEXT D-19's "two new patterns" collapses to test-fixture additions only** — research already flagged this (RESEARCH.md lines 770–787, 53). The planner must NOT add new regex rules; it adds the D-20 "OAuth callback failed" cause-chain fixture to `sanitize.test.ts`.
- `tests/` exists with `tests/setup/` (no `integration/` yet — Phase 2 creates `tests/integration/auth-concurrency.test.ts`).
- `test/fixtures/` exists (referenced by Phase 1 mcp-stdout-purity tests). Phase 2 adds `test/fixtures/oauth/`.
- No `src/infrastructure/observability/redact.ts` exists. (RESEARCH/CONTEXT do not mention one; the sanitizer is the only redaction module.)
- Phase 1 also produced `src/services/doctor/checks/fixtures.ts` (vendored JSON-RPC frames) — useful precedent for `test/fixtures/oauth/*.json` decisions but a CLEARER analog for shared-fixture VENDORING (constants in TS) vs loose JSON files.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/infrastructure/config/paths.ts` | infrastructure (config) | pure (resolve) | `src/infrastructure/config/logger.ts` | role-match (env-driven config resolver) |
| `src/infrastructure/whoop/errors.ts` | infrastructure (types) | pure | *(none — net new discriminated-union module)* | partial: see "No Analog" + ARCHITECTURE.md §Error model |
| `src/infrastructure/whoop/token-store.ts` | infrastructure | file-I/O + request-response (refresh POST) + single-flight | *(none — net new; the load-bearing module of this phase)* | partial: see "No Analog" |
| `src/infrastructure/whoop/token-store.test.ts` | test (unit, MSW) | request-response | `src/services/doctor/checks/native-modules.test.ts` (probe import shape) + `src/mcp/sanitize.test.ts` (table-driven tests) | role-match |
| `src/infrastructure/whoop/oauth.ts` | infrastructure | request-response + transient HTTP server | *(none — net new)* | partial: see "No Analog" |
| `src/infrastructure/whoop/oauth.test.ts` | test (unit, MSW) | request-response | `src/services/doctor/checks/mcp-stdout-purity.test.ts` (subprocess-shape harness for HTTP server lifecycle) | role-match |
| `src/cli/commands/init.ts` | CLI shim | request-response (interactive) | `src/cli/commands/doctor.ts` | exact (CLI subcommand entry, ≤ ~60 LOC, Services consumer) |
| `src/cli/commands/init.test.ts` | test (unit) | request-response | `src/cli/commands/doctor.test.ts` | exact |
| `src/cli/commands/auth.ts` | CLI shim | request-response | `src/cli/commands/doctor.ts` | exact |
| `src/cli/commands/auth.test.ts` | test (unit) | request-response | `src/cli/commands/doctor.test.ts` | exact |
| `src/cli/index.ts` (MODIFY) | CLI router | pure | `src/cli/index.ts` (self — extend) | exact (in-place extension of existing file) |
| `src/services/doctor/checks/auth.ts` | service (probe) | file-I/O (read-only) | `src/services/doctor/checks/native-modules.ts` | exact (DoctorCheck producer) |
| `src/services/doctor/checks/auth.test.ts` | test (unit) | file-I/O | `src/services/doctor/checks/native-modules.test.ts` | exact |
| `src/services/doctor/checks/token-freshness.ts` | service (probe) | file-I/O (read-only) | `src/services/doctor/checks/native-modules.ts` | exact (DoctorCheck producer) |
| `src/services/doctor/checks/token-freshness.test.ts` | test (unit) | file-I/O | `src/services/doctor/checks/native-modules.test.ts` | exact |
| `src/services/doctor/checks/check-names.ts` (MODIFY) | service (constants) | pure | self — extend | exact |
| `src/services/doctor/index.ts` (MODIFY) | service (orchestration) | pure | self — extend `PROBE_NAMES` and `Promise.allSettled` call | exact |
| `src/services/doctor/index.test.ts` (MODIFY) | test (unit) | pure | self — extend | exact |
| `src/mcp/sanitize.test.ts` (MODIFY ONLY) | test (unit) | pure | self — extend with D-20 fixture | exact (D-19 needs **no** sanitize.ts code change — see Repo State Sanity Check) |
| `tests/integration/auth-concurrency.test.ts` | test (integration, cross-process) | event-driven (child_process.spawn) | `src/services/doctor/checks/mcp-stdout-purity.ts` (the spawn-with-stdio + finalise harness) | role-match (closest existing cross-process harness) |
| `test/fixtures/oauth/token-200.json`, `token-400-invalid-grant.json` | test fixture | data | `src/services/doctor/checks/fixtures.ts` (vendored TS-literal fixtures) | partial — see "Shared Patterns" note about vendor-as-TS-vs-JSON |
| `scripts/ci-grep-gates.sh` (MODIFY — Gate E) | CI gate | text-scan | self (Gate A/B/C/D already in repo per CONTEXT line 144) | exact |
| `.github/workflows/ci.yml` (MODIFY — ubuntu-latest row) | CI config | yaml | self — extend matrix | exact |

## Pattern Assignments

---

### `src/cli/commands/init.ts` and `src/cli/commands/auth.ts` (CLI shims, request-response)

**Analog:** `src/cli/commands/doctor.ts`

Mirror this command-shim shape verbatim. Three load-bearing things to copy:

**Imports + Services composition root** (lines 7–15):
```typescript
import { renderDoctor } from '../../formatters/doctor.txt.js';
// MR-32: route CLI invocations through the Services composition root so
// the lite-hexagonal "CLI and MCP both consume the same Services surface"
// pattern (CLAUDE.md §Architecture) is real instead of aspirational.
import { createServices, type DoctorResult } from '../../services/index.js';
```
Planner action: `init` reads/writes `config.json` directly (no service needed per RESEARCH "Architectural Responsibility Map" line 126); `auth` calls `services.runAuth()` (added to `Services` in `src/services/index.ts`).

**Exit-code map** (lines 23–27):
```typescript
export const DOCTOR_EXIT_CODES: Readonly<Record<DoctorResult['overall'], number>> = Object.freeze({
  pass: 0,
  warn: 2,
  fail: 1,
});
```
Planner action: define `AUTH_EXIT_CODES` with at minimum `success: 0`, `auth_missing|auth_state_mismatch|auth_timeout|refresh_failed: 1` mapping (precise discriminants come from `errors.ts`).

**Async write+exit pattern with callback (MR-05)** (lines 29–62):
```typescript
export async function runDoctorCommand(opts: { text?: boolean }): Promise<void> {
  try {
    const services = createServices();
    const result = await services.runDoctor();
    const body = opts.text ? renderDoctor(result) : JSON.stringify(result, null, 2);
    // MR-05: pass exit as the write callback so slow pipe consumers get
    // the full buffered output before the process exits.
    process.stdout.write(`${body}\n`, () => {
      process.exit(DOCTOR_EXIT_CODES[result.overall]);
    });
  } catch (err) {
    const message = String(err);
    const fallback = { checks: [], overall: 'fail' as const, error: message };
    const body = opts.text
      ? `[fail] cli — ${message}\noverall: fail`
      : JSON.stringify(fallback, null, 2);
    process.stdout.write(`${body}\n`, () => {
      process.exit(DOCTOR_EXIT_CODES.fail);
    });
  }
}
```
Planner notes:
- `process.stdout.write` is the **one Gate-C-exempt CLI output point** per Phase 1 D-11. Both `init.ts` and `auth.ts` MUST live under `src/cli/commands/` and they MAY use `process.stdout.write` (per the Gate-C exemption note at line 4 of `doctor.ts`). Confirm Phase 2 extends Gate C to include `init.ts`, `auth.ts` in its exemption list, or — cleaner — refactor Gate C to allow `src/cli/commands/**/*.ts` rather than name a single file.
- Write-then-exit-via-callback pattern is load-bearing for piped output. Copy it.
- Outer try/catch is required (MR-08). For `auth.ts`, `AuthError` cases need bespoke text remediation; the catch arm builds the same `{checks: [], overall: 'fail', error: message}` shape only if the command is going to emit JSON-shaped output.

---

### `src/cli/commands/init.test.ts` and `auth.test.ts`

**Analog:** `src/cli/commands/doctor.test.ts`

Copy three patterns:

**Mock process.exit + stdout via `vi.mock` + a sentinel throw** (lines 64–84):
```typescript
process.exit = ((code?: number) => {
  exitCode = code;
  throw new Error('__test_exit__');
}) as never;
process.stdout.write = ((
  chunk: string | Uint8Array,
  cbOrEncoding?: ((err?: Error | null) => void) | string,
  cb?: (err?: Error | null) => void,
) => {
  writtenBody += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
  const finished = typeof cbOrEncoding === 'function' ? cbOrEncoding : cb;
  if (finished) finished();
  return true;
}) as typeof process.stdout.write;
```

**`vi.doMock` + dynamic re-import for service stub** (lines 57–63, 108–113):
```typescript
vi.resetModules();
vi.doMock('../../services/doctor/index.js', () => ({
  runDoctor: async () => ({
    checks: [{ name: 'mock_check', status: 'pass' as const, detail: 'all good' }],
    overall: 'pass' as const,
  }),
}));
// ...later:
const { runDoctorCommand } = await import('./doctor.js');
```

**`afterEach` cleanup** (lines 46–54):
```typescript
afterEach(() => {
  process.exit = originalExit;
  process.stdout.write = originalWrite;
  vi.resetModules();
  vi.doUnmock('../../services/doctor/index.js');
});
```

Planner action for `init.test.ts`: stub the prompt layer (likely `inquirer` or whatever Commander prompt mechanism the planner picks; CONTEXT doesn't mandate a library). Assert (a) `config.json` written with mode 0600, (b) env-var precedence (D-06), (c) idempotency on re-run.

Planner action for `auth.test.ts`: stub `runOAuth()` and `tokenStore.write()`. Assert the three exit arms: success (0), state-mismatch (1), timeout (1).

---

### `src/cli/index.ts` (MODIFY)

**Analog:** self — `src/cli/index.ts` lines 13–41

**Existing pattern to mirror per new subcommand** (lines 22–39):
```typescript
program
  .command('doctor')
  .description('Run diagnostic checks')
  .option('--text', 'render plaintext instead of JSON')
  .addHelpText('after', [
    '',
    'Exit codes:',
    '  0  pass  — all checks healthy',
    '  1  fail  — one or more checks failed',
    '  2  warn  — one or more checks emitted a warning (POSIX convention)',
  ].join('\n'))
  .action(runDoctorCommand);
```
Planner action: add `.command('init')` (no flags expected; CONTEXT D-01 says interactive prompts) and `.command('auth')` with `--no-browser` (D-08) and `--timeout <seconds>` (D-10) flags. Each gets an `addHelpText('after', ...)` block describing the exit-code map (MR-22 convention).

---

### `src/services/doctor/checks/auth.ts` and `token-freshness.ts`

**Analog:** `src/services/doctor/checks/native-modules.ts`

**Verbatim DoctorCheck producer shape** (lines 13–33):
```typescript
import type { DoctorCheck } from '../index.js';
import { CHECK_NAMES } from './check-names.js';

export async function probeBetterSqlite3(): Promise<DoctorCheck> {
  try {
    const mod = await import('better-sqlite3');
    const db = new mod.default(':memory:');
    db.close();
    return {
      name: CHECK_NAMES.BETTER_SQLITE3_LOAD,
      status: 'pass',
      detail: 'native binding loaded',
    };
  } catch (err) {
    return {
      name: CHECK_NAMES.BETTER_SQLITE3_LOAD,
      status: 'fail',
      detail: `failed to load: ${err instanceof Error ? err.message : String(err)} — try \`npm rebuild better-sqlite3\``,
    };
  }
}
```

Planner action:
- `probeAuth()` returns `pass` (detail: `auth: keychain` or `auth: file (mode 0600)`), `fail` (detail: `no tokens — run \`recovery-ledger auth\``). Per D-21 / D-22, this check is **offline-safe** — it MUST NOT call the WHOOP refresh endpoint. Read `storage-mode` cache file + verify token presence without exchange.
- `probeTokenFreshness()` returns `pass` if `expires_at > now + 5min`, `warn` if within 5min, `fail` if expired or absent. Detail strings: `expires in 12m`, `expired 2h ago`, `no tokens`.
- Both probes accept a small options object (mirroring `ProbeOptions` from `mcp-stdout-purity.ts`) so a future test seam can inject paths.

**Error-detail contract** — every fail detail ends with a remediation phrase ("`try ...`" or "`run ...`"). Match the existing style verbatim.

---

### `src/services/doctor/checks/auth.test.ts` and `token-freshness.test.ts`

**Analog:** `src/services/doctor/checks/native-modules.test.ts`

**Minimal happy-path probe test shape** (lines 14–22):
```typescript
describe('probeBetterSqlite3', () => {
  test('returns status=pass when the native binding loads', async () => {
    const check = await probeBetterSqlite3();
    expect(check.name).toBe('better_sqlite3_load');
    expect(check.status).toBe('pass');
    expect(check.detail).toBe('native binding loaded');
  });
});
```

Planner action: copy shape. Both new probe tests need:
- A happy path (tokens fresh).
- A fail path (no `storage-mode` file → `auth_missing`).
- For `token-freshness`: a warn path (`expires_at = now + 4min`).
Use a temp `RECOVERY_LEDGER_HOME` per test (via `mkdtemp(tmpdir() + '/rl-')`) so the probes are deterministic — pattern is set in `mcp-stdout-purity.test.ts` lines 16–18:
```typescript
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
```

---

### `src/services/doctor/checks/check-names.ts` (MODIFY)

**Analog:** self — extend the frozen const (lines 17–21):
```typescript
export const CHECK_NAMES = {
  BETTER_SQLITE3_LOAD: 'better_sqlite3_load',
  NAPI_KEYRING_LOAD: 'napi_keyring_load',
  MCP_STDOUT_PURITY: 'mcp_stdout_purity',
} as const;
```
Planner action: add `AUTH: 'auth'` and `TOKEN_FRESHNESS: 'token_freshness'`. Underscore-snake_case names. The `CheckName` type derives automatically.

---

### `src/services/doctor/index.ts` (MODIFY)

**Analog:** self — extend `PROBE_NAMES` and the `Promise.allSettled` call (lines 100–133):
```typescript
const PROBE_NAMES = [
  CHECK_NAMES.BETTER_SQLITE3_LOAD,
  CHECK_NAMES.NAPI_KEYRING_LOAD,
  CHECK_NAMES.MCP_STDOUT_PURITY,
] as const;

export async function runDoctor(opts: RunDoctorOptions = {}): Promise<DoctorResult> {
  const skipSubprocess = opts.skipSubprocessChecks === true;
  const settled = await Promise.allSettled([
    probeBetterSqlite3(),
    probeKeyring(),
    probeMcpStdoutPurity({ skipSubprocess }),
  ]);
  // ... synthesized fail-on-throw branch
}
```
Planner action: add `CHECK_NAMES.AUTH` and `CHECK_NAMES.TOKEN_FRESHNESS` to `PROBE_NAMES` (preserving positional alignment with the `Promise.allSettled` array), import `probeAuth` and `probeTokenFreshness`, and append them to the array.

Two ordering rules to honor:
- `PROBE_NAMES` array order MUST match `Promise.allSettled` array order (MR-36 comment lines 97–99).
- Both new probes are offline-safe — they do NOT need the `skipSubprocess` gate.

---

### `src/services/doctor/index.test.ts` (MODIFY)

**Analog:** self

**MR-36 canonical-name assertion** (lines 151–162) is the load-bearing piece to extend:
```typescript
test('MR-36 — runDoctor() result includes all three canonical CHECK_NAMES', async () => {
  const result = await runDoctor({ skipSubprocessChecks: true });
  const names = result.checks.map((c) => c.name);
  expect(names).toContain(CHECK_NAMES.BETTER_SQLITE3_LOAD);
  expect(names).toContain(CHECK_NAMES.NAPI_KEYRING_LOAD);
  expect(names).toContain(CHECK_NAMES.MCP_STDOUT_PURITY);
  // ... canonical-set check
});
```
Planner action: extend to assert `CHECK_NAMES.AUTH` and `CHECK_NAMES.TOKEN_FRESHNESS` appear. Update the test name from "three" to "five" and grow the canonical-set check.

---

### `src/mcp/sanitize.test.ts` (MODIFY ONLY — NO sanitize.ts code change)

**Analog:** self — `sanitize.test.ts` lines 162–171 + 408–469 (the D-10 fixture block)

**D-10 fixture pattern to copy** (lines 446–459):
```typescript
test('F5 redacts grant_type=refresh_token form body in an undici-shaped error', () => {
  const err = new Error(
    'UND_ERR_CONNECT_TIMEOUT — request body: grant_type=refresh_token&refresh_token=rt_secret&client_secret=cs_secret',
  );
  const out = sanitize(serializeError(err));
  expect(out).not.toContain('rt_secret');
  expect(out).not.toContain('cs_secret');
  expect(out).toContain('refresh_token=<redacted>');
  expect(out).toContain('client_secret=<redacted>');
  expect(out).toContain('grant_type=refresh_token');
});
```

Planner action (D-20 — exact fixture per CONTEXT):
```typescript
// D-20 — OAuth callback failure cause-chain with both code= and
// client_secret= in flight. Verifies Phase 1's sanitizer covers the
// Phase 2 OAuth surface end-to-end without any regex changes.
test('OAuth callback failed cause chain redacts both code= and client_secret=', () => {
  const err = new Error('OAuth callback failed', {
    cause: new Error(
      'redirect ?code=eyJabc.eyJdef.signature123 with client_secret=hunter2',
    ),
  });
  const out = sanitize(serializeError(err));
  expect(out).not.toContain('eyJabc.eyJdef.signature123');
  expect(out).not.toContain('hunter2');
  expect(out).toContain('code=<redacted>');
  expect(out).toContain('client_secret=<redacted>');
});
```
Place in the `D-10 fixtures (errors that historically leak)` describe block (line 408) as `F7` to keep with the numbered convention.

Also add positive + negative cases per D-20 — note the negative case is **already covered** by `P4-` (Bearer < 10 chars) and `P2b-` (key without =value) precedents. The planner can add an explicit `code=` short-string negative if the F-block coverage is felt to be soft.

**Critical constraint:** `SECRET_KEY_NAMES` already contains `code` (line 29) and `client_secret` (line 21). The planner MUST NOT add either as a "new pattern" — that would cause two-row alternation duplication. Confirm via the existing tests at lines 65–69, 107–112, 114–118, 164–171 which already pin both.

---

### `src/infrastructure/whoop/oauth.ts` (NEW — no strong analog)

**Closest in-repo analog:** `src/services/doctor/checks/mcp-stdout-purity.ts` for the **HTTP/subprocess lifecycle pattern** (`finalise()` discipline, AbortController-style cleanup, SIGTERM-then-SIGKILL escalation, write-then-callback idiom). It is the only Phase 1 file that owns a transient external process with a settle/drain timeline — that maps onto the loopback HTTP server (D-09/D-10).

**Lifecycle harness pattern to mirror** (lines 134–168):
```typescript
let stdoutBuf = '';
let settled = false;
let killTimer: NodeJS.Timeout | null = null;
child.on('exit', () => {
  if (killTimer) { clearTimeout(killTimer); killTimer = null; }
});
const finalise = (result: DoctorCheck): void => {
  if (settled) return;
  settled = true;
  try { child.stdin.end(); } catch { /* may already be closed */ }
  if (!child.killed) {
    child.kill('SIGTERM');
    killTimer = setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, 2000);
    killTimer.unref();
  }
  resolve(result);
};
```

Translation for `oauth.ts` `listenForCallback`:
- Replace `child.kill` with `server.close()`.
- Replace `settled` guard with a one-shot resolve/reject Promise (RESEARCH lines 738–762 already sketches this; lift the lifecycle hardening from `mcp-stdout-purity.ts`).
- Add an `AbortController` for the 5-minute D-10 timeout, mirroring how `setTimeout(..., 2000).unref()` is used to escalate.
- Defense-in-depth `error` listener on the server for cleanup parity with `child.stdin.on('error', ...)` (lines 186–193).

**Imports + module-doc comment shape** (lines 1–18):
```typescript
// MCP stdout-purity subprocess check (D-05).
//
// Spawns the built `dist/mcp.mjs` server, drives the four JSON-RPC fixtures
// over stdin (initialize → notifications/initialized → tools/list →
// tools/call:whoop_doctor), captures stdout, and asserts every non-empty line
// parses as JSON-RPC 2.0.
// ...
// CR-02: fixtures are vendored as TS constants ...
```
Copy this voice. Module-leading comment cites the load-bearing CONTEXT decisions (D-08/09/10/11/12) and ADR-0002 / ADR-0007 by name.

**Validation-at-boundaries** — Zod parse callback query params and token-endpoint response (RESEARCH lines 671–714). Token-response schema is `.passthrough()` per RESEARCH Pitfall J.

**No `console.*`; no `process.stdout.write` from inside `oauth.ts`** — per ADR-0001 + CLAUDE.md §Critical Rules row 1. Logging goes through `logger` from `src/infrastructure/config/logger.ts` (stderr-only). The HTTP success/failure HTML pages are written to the SERVER response (not the process stdout) — that is fine.

---

### `src/infrastructure/whoop/token-store.ts` (NEW — load-bearing module, no in-repo analog)

**No close analog exists.** This module owns three patterns simultaneously that no existing file owns even one of:
1. In-process module-level `Promise<Tokens> | null` single-flight gate (ADR-0002 layer 1).
2. Cross-process `proper-lockfile.lock(...)` with `{retries: {retries: 10, factor: 1.2, minTimeout: 50}, stale: 5000}` (ADR-0002 layer 2).
3. Atomic temp-and-rename file write via `open(tmp, 'w', 0o600) → fd.writeFile → fd.sync → rename(tmp, final)` (ADR-0002 layer 3, RESEARCH Pattern 2).

**Reference sources (not in-repo, but cited verbatim by the planner):**
- ADR-0002 §Decision (lines 22–43) — the three-layer gate
- ADR-0002 §Enforcement (lines 68–75) — "Token-store module is the only consumer of the refresh endpoint"
- RESEARCH Pattern 1 (lines 345–395) — the canonical sketch
- RESEARCH Pattern 2 (lines 402–424) — `open(tmp, 'w', 0o600)` not `writeFile(...{mode: 0o600})`; same-dir rename rule (Pitfall D)
- CONTEXT D-04/D-05/D-07/D-14/D-15/D-16

**Module conventions to copy from existing infrastructure code** (`src/infrastructure/config/logger.ts`):

Comment header style + named exports + factory + singleton:
```typescript
// Default import: pino is a CJS module published with `export = pino`, so the
// `.destination` and `.symbols` accessors only attach to the default callable —
// ...
// MCP stdio servers speak JSON-RPC on stdout. Anything else on stdout corrupts
// the protocol. This module binds Pino to fd 2 (stderr) under every NODE_ENV;
// ...
export interface LoggerEnv { /* ... */ }
export type ResolvedLoggerOptions = /* ... */;
export function resolveLoggerOptions(env: LoggerEnv): ResolvedLoggerOptions { /* ... */ }
export function createLogger(env: LoggerEnv): Logger { /* ... */ }
export const logger = createLogger(process.env);
```
Translation: token-store exports a `createTokenStore(opts)` factory taking the resolved path + a `Date.now`/`fetch` injectable surface (test seam, per `mcp-stdout-purity.ts` `ProbeOptions.mcpEntry` MR-06 pattern, lines 86–108), plus a default singleton `tokenStore = createTokenStore(defaultOptions)`. Minimum exported surface per RESEARCH:
- `getValidAccessToken(): Promise<string>`
- `read(): Promise<Tokens | null>`
- `write(tokens: Tokens): Promise<void>`
- `clear(): Promise<void>`
- `readStorageMode(): Promise<'keychain' | 'file' | null>` (consumed by `probeAuth`)
- `REFRESH_BUFFER_MS` constant (D-14)

**Discriminated-union error type:** Imports from `errors.ts`. Throw `AuthError({kind: 'refresh_failed', cause: ...})`, never raw `Error`. See `errors.ts` section below.

**`logger` import — exclusively from `../config/logger.js`.** Single Pino logger (ADR-0001 §Consequences line 35).

---

### `src/infrastructure/whoop/errors.ts` (NEW — discriminated union)

**No in-repo analog (no error-type files yet).** The closest precedent is the **closed-status union** in `src/services/doctor/index.ts` lines 26–50:
```typescript
export interface DoctorCheck {
  name: string;
  /**
   * Three-status union. INTENTIONALLY CLOSED (MR-21): a future sub-status
   * (e.g., `skipped`, `unknown`, `degraded`) must be added to this type
   * AND to `DOCTOR_EXIT_CODES` in src/cli/commands/doctor.ts so the
   * shell-level contract stays in sync.
   */
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}
```
Copy the **MR-21 "INTENTIONALLY CLOSED + cross-reference + forcing function" doc-comment voice** for the new `AuthError` union:
```typescript
// Discriminated-union error type for the OAuth + token-store surface.
//
// INTENTIONALLY CLOSED (MR-21 pattern): each kind below must be mirrored
// in cli/commands/auth.ts's exit-code map (AUTH_EXIT_CODES) AND in the
// doctor.txt formatter's remediation strings. Adding a kind without
// updating both call sites is a compile error via the exhaustive switch
// in formatAuthError(). That compile error is the forcing function.
export type AuthError =
  | { kind: 'auth_missing'; detail?: string }
  | { kind: 'auth_expired'; detail?: string }
  | { kind: 'auth_state_mismatch'; detail?: string }
  | { kind: 'auth_timeout'; detail?: string }
  | { kind: 'refresh_failed'; detail?: string; cause?: unknown };
```
The kinds enumerated come directly from CONTEXT lines 142–143 + RESEARCH "Phase Requirements → Test Map" + D-10 + D-11 + D-15. Planner picks the carrier shape (plain object vs Error subclass with discriminator field) — the RESEARCH sketches treat them as constructed Error subclasses (`throw new AuthError({kind:'auth_timeout'})`) which is consistent with the "thrown errors flow through Phase 1 sanitizer" path (D-18). An Error subclass with a `kind` field is the cleaner pick because it inherits stack traces and works through `serializeError` (sanitize.ts lines 170–199) without special handling.

---

### `src/infrastructure/config/paths.ts` (NEW)

**Analog:** `src/infrastructure/config/logger.ts` (sibling — same dir, same module style)

**Function-with-env-arg test-seam pattern to copy** (lines 56–74):
```typescript
export function resolveLoggerOptions(env: LoggerEnv): ResolvedLoggerOptions {
  const isDev = env.NODE_ENV === 'development';
  if (isDev) {
    return {
      kind: 'dev',
      level: env.LOG_LEVEL ?? 'debug',
      transport: { target: 'pino-pretty', options: { destination: 2 } },
    };
  }
  return {
    kind: 'prod',
    level: env.LOG_LEVEL ?? 'info',
    destination: { dest: 2, sync: false },
  };
}
```
Translation for `paths.ts`:
```typescript
export interface PathsEnv {
  RECOVERY_LEDGER_HOME?: string;
  HOME?: string;
}

export interface ResolvedPaths {
  configDir: string;        // ~/.recovery-ledger/
  configFile: string;       // configDir + 'config.json'
  tokensFile: string;       // configDir + 'tokens.json'
  tokensLockFile: string;   // configDir + 'tokens.json.lock'
  storageModeFile: string;  // configDir + 'storage-mode'
}

export function resolvePaths(env: PathsEnv): ResolvedPaths { /* ... */ }

export const paths = resolvePaths(process.env);
```
The factory-with-env-arg shape is the key test seam (see `logger.test.ts` references in the doc comment lines 80–86). It lets unit tests pass `{RECOVERY_LEDGER_HOME: tmpdir}` without setting/unsetting real env vars.

---

### `tests/integration/auth-concurrency.test.ts` (NEW)

**Analog:** `src/services/doctor/checks/mcp-stdout-purity.test.ts` and the probe itself (`mcp-stdout-purity.ts` lines 126–168)

This is the only file in the codebase that drives **two-process** test scenarios. Copy these patterns:

**`mkdtemp` test-isolation pattern** (lines 16–18):
```typescript
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
```

**Stub-script-on-disk + spawn pattern** (lines 32–60 of `mcp-stdout-purity.test.ts`):
```typescript
const SILENT_STUB = `
process.stdin.on('data', () => {});
process.stdin.on('end', () => process.exit(0));
`;
// ... write to disk, then probe with mcpEntry pointing at the stub
```
Translation: write two tiny stub processes (e.g., `child-cli-stub.mjs`, `child-mcp-stub.mjs`) each of which imports `tokenStore` and calls `getValidAccessToken()` against a `WHOOP_TOKEN_URL_OVERRIDE` env var (RESEARCH Open Question 3 line 871). Parent test owns a `http.createServer()` mock counter (RESEARCH Open Question 3 recommendation — use a real loopback HTTP server in the parent, NOT MSW, for the cross-process layer).

**Spawn-with-stdio + finalise harness** (lines 126–168 of `mcp-stdout-purity.ts`):
```typescript
const child = spawn(process.execPath, [mcpEntry], {
  env: { ...process.env, NODE_ENV: 'production', RL_INSIDE_MCP: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
```
Translation: spawn two children in parallel, both passing through `WHOOP_TOKEN_URL_OVERRIDE=http://127.0.0.1:<parent-port>` and `RECOVERY_LEDGER_HOME=<tmp-dir>` (shared between both children so the lockfile coordinates).

**Assertion:** parent's HTTP counter shows exactly one hit on `/oauth/oauth2/token` after both children settle. AUTH-05 load-bearing per D-24.

---

### `src/infrastructure/whoop/token-store.test.ts` and `oauth.test.ts`

**Analog:** the **table-driven describe/test pattern** from `src/mcp/sanitize.test.ts` (lines 38–315) and the **import + happy-path-first** pattern from `src/services/doctor/checks/native-modules.test.ts` (lines 11–30).

**MSW handler pattern (already sketched in RESEARCH lines 962–994):**
```typescript
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

let refreshHitCount = 0;
const handlers = [
  http.post('https://api.prod.whoop.com/oauth/oauth2/token', () => {
    refreshHitCount += 1;
    return HttpResponse.json({
      access_token: `fresh-${refreshHitCount}`,
      refresh_token: `next-${refreshHitCount}`,
      expires_in: 3600,
      scope: 'offline read:recovery',
      token_type: 'bearer',
    });
  }),
];
const server = setupServer(...handlers);

beforeAll(() => server.listen());
afterAll(() => server.close());
beforeEach(() => { refreshHitCount = 0; });
```

Planner action: `token-store.test.ts` is the load-bearing AUTH-05 unit half (10 parallel `Promise.all`, assert exactly one refresh hit). `oauth.test.ts` covers AUTH-01 (URL build) + AUTH-02 (loopback round-trip with state-mismatch + timeout arms).

For test isolation (no shared module-level `inFlightRefresh`), use `vi.resetModules()` + dynamic import pattern from `doctor.test.ts` (lines 64, 86–87) so each test gets a fresh token-store instance.

---

### `test/fixtures/oauth/*.json` (NEW)

**Analog:** `src/services/doctor/checks/fixtures.ts` (Phase 1 vendored-as-TS pattern)

Phase 1 picked vendored-as-TS for the JSON-RPC fixtures (lines 1–13 explain why: works under any cwd, no disk read, no fragile path resolution). RESEARCH's recommended project structure (lines 322–330) opts for **JSON files on disk** for OAuth — `tests/fixtures/whoop/<resource>/<scenario>.json` is the documented Phase 1 convention per `agent_docs/conventions.md` lines 64–66:

> Fixtures live under `tests/fixtures/whoop/<resource>/<scenario>.json`, committed. No `<scenario>` is "default" — name what it represents (`scored-only.json`, `mixed-states.json`, `429-burst.json`).

The Phase 1 vendored-as-TS pattern was the **exception** because it's invoked from a runtime probe in production (`mcp-stdout-purity.ts`). The Phase 2 OAuth fixtures are TEST-ONLY — keep them as JSON files on disk per conventions. Planner action: live under `test/fixtures/oauth/` with `token-200.json`, `token-400-invalid-grant.json`, `authorize-callback-state-mismatch.html` (D-23).

(Open question for the planner: `test/fixtures/` vs `tests/fixtures/`. Repo currently has BOTH `test/fixtures/` (Phase 1) AND `tests/setup/`. The conventions doc says `tests/fixtures/whoop/<resource>/`. RESEARCH uses `test/fixtures/oauth/`. Phase 2 should pick one and resolve the inconsistency — flagging as a planner decision, not a pattern question.)

---

### `scripts/ci-grep-gates.sh` (MODIFY — Gate E)

**Analog:** self — Phase 1 already wrote Gates A–D (per CONTEXT line 144)

**Gate E rule (CONTEXT line 144):**
```sh
grep -rn "oauth/oauth2/token" src/ | grep -v token-store.ts && exit 1
```
This enforces ADR-0002 §Enforcement line 70 ("Token-store module is the only consumer of the refresh endpoint"). Planner action: add this gate inline at the bottom of the existing script with a leading comment citing ADR-0002.

Note: ADR-0002 §Enforcement also mentions a Biome `noRestrictedImports` rule. RESEARCH Pattern 4 (lines 488–515) clarifies that Biome's `noRestrictedImports` is on import paths, not raw URL strings, so it doesn't naturally cover this — the grep gate is the load-bearing enforcement.

---

## Shared Patterns

### A. ADR-0001 stdout purity (applies to: every Phase 2 file except `src/cli/commands/*.ts`)

**Source:** `agent_docs/decisions/0001-mcp-stdout-purity.md` §Decision (lines 22–31) + enforcement at line 53.

**Concrete pattern from `src/infrastructure/config/logger.ts`** (lines 1–11):
```typescript
import pino, { type Logger } from 'pino';

// MCP stdio servers speak JSON-RPC on stdout. Anything else on stdout corrupts
// the protocol. This module binds Pino to fd 2 (stderr) under every NODE_ENV;
// there is no path in this codebase that logs to stdout.
```

**Applies to:** `oauth.ts`, `token-store.ts`, `errors.ts`, `paths.ts`, all doctor checks, all service code, all mcp code. The ONLY exception is `src/cli/commands/doctor.ts`, `init.ts`, `auth.ts` per Phase 1 D-11.

**Concretely:** every new module starts with `import { logger } from '../config/logger.js';` (path relative to that module) and uses `logger.debug/info/warn/error(...)` — never `console.*` and never `process.stdout.write`. The CI grep gate (Gate A from Phase 1 D-04) refuses Edit/Write operations that introduce `console.*` into MCP-reachable paths.

### B. Named exports only (applies to: every new file)

**Source:** `agent_docs/conventions.md` line 14.

**Concrete pattern from every Phase 1 file** — e.g., `src/services/doctor/index.ts` exports `runDoctor`, `deriveOverall`, `type DoctorCheck`, `type DoctorResult`, `type RunDoctorOptions` (all named). Zero `export default` anywhere in `src/`.

**Verify:** `rg "^export default" /Users/chris.bremmer/recovery-ledger/src/` returns nothing in Phase 1 — Phase 2 keeps that invariant.

### C. Validation at boundaries only (applies to: `oauth.ts`, `token-store.ts`, `init.ts`)

**Source:** `agent_docs/conventions.md` lines 33–34.

> Zod-parse WHOOP responses, CLI flags, and MCP tool inputs. Inside domain code, trust the types.

**Concrete pattern from RESEARCH** (lines 671–678):
```typescript
const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().int().positive(),
  scope: z.string(),
  token_type: z.literal('bearer'),
}).passthrough();
```

**Applies to:**
- `oauth.ts`: parse WHOOP token endpoint response (refresh + code-exchange) with `TokenResponseSchema.parse(...)`. Parse loopback callback query params (`code`, `state`, `error`). Use `.passthrough()` per Pitfall J (lines 622–628).
- `token-store.ts`: parse on-disk `tokens.json` body on read (same schema). The keyring path goes through the same parse arm.
- `init.ts`: Zod schema for the inquirer/Commander-prompt outputs (`client_id`, `client_secret`, `redirect_port: z.coerce.number().int().positive()`).

**Anti-pattern:** No Zod parsing inside `token-store.ts`'s refresh logic AFTER the initial parse — internal `Tokens` type is trusted.

### D. Error sanitization (applies to: every error path that reaches MCP)

**Source:** `src/mcp/register.ts` lines 33–82 (the try/catch/sanitize wrapper) + `src/mcp/sanitize.ts` lines 148–199 (the `sanitize` + `serializeError` pair).

**Concrete pattern in use** (`register.ts` lines 66–82):
```typescript
const wrapped = (async (...args: Parameters<ToolCallback<I>>): Promise<CallToolResult> => {
  try {
    const result = await (handler as WrappedHandler<I>)(...args);
    return sanitizeResult(result) satisfies CallToolResult;
  } catch (err) {
    return {
      content: [{ type: 'text', text: sanitize(serializeError(err)) }],
      isError: true,
    } satisfies CallToolResult;
  }
}) as ToolCallback<I>;
```

**Applies to:** `auth.ts` and `token-store.ts` MUST throw discriminated-union `AuthError` instances (or subclasses). Those errors flow through Phase 1's `register.ts` wrapper automatically (per D-18) because Phase 2 adds no new MCP tools — the only MCP tool surface is still `whoop_doctor`, which already wraps via `register()`.

**Defense-in-depth:** ANY string passed to `logger.info/debug/warn/error` from `oauth.ts` or `token-store.ts` should be run through `sanitize()` first (per RESEARCH Anti-Patterns line 525). The sanitizer is a pure function and re-entrant.

### E. File-as-test-seam factory pattern (applies to: `paths.ts`, `token-store.ts`)

**Source:** `src/infrastructure/config/logger.ts` lines 56–92.

The pattern: a module exposes BOTH a pure `resolve(env)` / `create(opts)` factory AND a singleton bound to `process.env` at module load. Tests construct fresh instances via the factory; production reads the singleton. This is the test seam that makes module-level singletons (like `inFlightRefresh`) testable without `vi.resetModules()`.

**Concrete shape:**
```typescript
export function createX(opts: XOptions): X { /* pure */ }
export const x = createX(defaultOptions);
```

### F. Frozen-const + autocomplete-typed names (applies to: `check-names.ts` extension, and `errors.ts` kind discriminants)

**Source:** `src/services/doctor/checks/check-names.ts` lines 17–23.

```typescript
export const CHECK_NAMES = {
  BETTER_SQLITE3_LOAD: 'better_sqlite3_load',
  NAPI_KEYRING_LOAD: 'napi_keyring_load',
  MCP_STDOUT_PURITY: 'mcp_stdout_purity',
} as const;

export type CheckName = (typeof CHECK_NAMES)[keyof typeof CHECK_NAMES];
```

Phase 2 extends this with `AUTH` and `TOKEN_FRESHNESS`. The `as const` + derived-type pattern means every consumer gets autocomplete + rename support automatically.

### G. Vitest `pool: 'forks'` + `vi.resetModules` per test (applies to: every test that touches module-level state)

**Source:** `agent_docs/conventions.md` lines 41–44 + `src/cli/commands/doctor.test.ts` lines 119, 145, 159.

> `pool: 'forks'` is mandatory — `better-sqlite3` native handles do not cross worker threads cleanly.

Phase 2 ALSO needs `pool: 'forks'` because (a) the cross-process integration test spawns real child processes; (b) the unit tests need clean module-level singletons (`inFlightRefresh = null` between tests) via `vi.resetModules()`.

The doctor.test.ts pattern of `vi.resetModules() → vi.doMock(...) → const { x } = await import('...')` per test is the way to handle this; planner action mirrors it for `token-store.test.ts`.

---

## No Analog Found

Files with no close in-repo match (planner should use RESEARCH.md / ADR-0002 patterns instead):

| File | Role | Data Flow | Reason | Reference to use |
|------|------|-----------|--------|------------------|
| `src/infrastructure/whoop/errors.ts` | type union | pure | No existing discriminated-union error module in the repo. Closest precedent is `DoctorCheck.status` closed-union doc comment style (`doctor/index.ts` lines 26–50). | `agent_docs/conventions.md` line 14 + `DoctorCheck.status` MR-21 voice |
| `src/infrastructure/whoop/token-store.ts` | infrastructure (storage + single-flight + refresh) | file-I/O + request-response + module-singleton state | The three-layer single-flight gate is genuinely net-new. Closest stylistic precedent is `logger.ts` for factory+singleton; closest pattern is ADR-0002 itself. | ADR-0002 §Decision lines 22–43 + RESEARCH Patterns 1+2 (lines 345–424) |
| `src/infrastructure/whoop/oauth.ts` | infrastructure (loopback HTTP + OAuth state machine) | request-response + transient HTTP server | Loopback HTTP server is the only transient-server pattern in the codebase; closest analog is the subprocess harness in `mcp-stdout-purity.ts`. | RESEARCH Pattern 3 (lines 431–484) + Patterns from `mcp-stdout-purity.ts` lifecycle harness |
| `test/fixtures/oauth/*.json` | fixtures | static data | No `tests/fixtures/whoop/<resource>/` directory exists yet — Phase 1's only fixture was vendored-as-TS in `src/services/doctor/checks/fixtures.ts`. Phase 2 establishes the on-disk JSON-fixtures convention. | `agent_docs/conventions.md` lines 64–66 (the documented convention) |

---

## Cross-Cutting Constraints (apply to ALL Phase 2 files)

Planner: every plan action's "Acceptance criteria" should restate the relevant subset of:

1. **TypeScript strict + ESM** (`agent_docs/conventions.md` line 13). No `any`. No `as unknown as`. Single-step `as` casts only when justified (`register.ts` lines 67–81 show the only sanctioned cast pattern).
2. **No default exports** (`conventions.md` line 14). All exports named.
3. **No `console.*` outside `src/cli/`** (ADR-0001). Logger via `import { logger } from '../config/logger.js'`.
4. **`process.stdout.write` only in `src/cli/commands/*.ts`** (Phase 1 D-11 + ci-grep-gates.sh Gate C). If Gate C is currently file-scoped to `doctor.ts` only, Phase 2 either extends the exemption to `init.ts` + `auth.ts` OR (cleaner) refactors Gate C to glob `src/cli/commands/**/*.ts`.
5. **Zod at boundaries** (`conventions.md` line 33). Inside domain code, trust types.
6. **Tests next to source as `<name>.test.ts`** (`conventions.md` line 62). Integration tests under `tests/integration/`. Fixtures under `tests/fixtures/whoop/<resource>/` (or `test/fixtures/oauth/` if Phase 2 inherits the Phase 1 path — see open question above).
7. **MSW intercepts `fetch`** (`conventions.md` line 45). No live WHOOP per ADR-0006.
8. **Banned tone words + no emoji** (ADR-0005, referenced from CLAUDE.md row 5). Applies to OAuth HTML pages (D-09 text strings) and to CLI help text.
9. **Single-flight refresh is non-negotiable** (ADR-0002 §Decision line 40: "No code path may bypass this — there is no 'simpler' refresh path"). The token-store module is the ONLY consumer of the refresh endpoint — enforced via Gate E.
10. **WHOOP read-only** (ADR-0007 §Decision line 30). The HTTP client (Phase 3) exposes only `get(path, query)`. Phase 2 does NOT add other verbs; the OAuth token-endpoint POSTs are isolated to `oauth.ts` per ADR-0007 §Enforcement line 64 + RESEARCH line 105.

---

## Metadata

**Analog search scope:**
- `/Users/chris.bremmer/recovery-ledger/src/**` (full Phase 1 tree)
- `/Users/chris.bremmer/recovery-ledger/agent_docs/decisions/0001-*, 0002-*, 0007-*`
- `/Users/chris.bremmer/recovery-ledger/agent_docs/conventions.md`
- `/Users/chris.bremmer/recovery-ledger/.planning/phases/02-*/02-CONTEXT.md`
- `/Users/chris.bremmer/recovery-ledger/.planning/phases/02-*/02-RESEARCH.md` (lines 1–957)

**Files scanned (read in full or in non-overlapping sections):** 17

**Phase 1 source files cited with line numbers:**
- `src/mcp/sanitize.ts` (lines 18–30 SECRET_KEY_NAMES; lines 38–146 PATTERNS; lines 148–199 sanitize + serializeError)
- `src/mcp/sanitize.test.ts` (lines 24–36, 107–118, 164–171, 408–469)
- `src/mcp/register.ts` (lines 33–82, 90–121)
- `src/services/doctor/index.ts` (lines 26–50, 69–148)
- `src/services/doctor/checks/check-names.ts` (lines 17–23)
- `src/services/doctor/checks/native-modules.ts` (lines 13–54)
- `src/services/doctor/checks/native-modules.test.ts` (lines 14–30)
- `src/services/doctor/checks/mcp-stdout-purity.ts` (lines 1–18, 126–168, 186–193)
- `src/services/doctor/checks/mcp-stdout-purity.test.ts` (lines 1–60)
- `src/services/doctor/checks/fixtures.ts` (lines 1–51)
- `src/services/doctor/index.test.ts` (lines 1–47, 56–110, 151–162)
- `src/cli/commands/doctor.ts` (lines 1–62)
- `src/cli/commands/doctor.test.ts` (lines 40–238)
- `src/cli/index.ts` (lines 13–41)
- `src/infrastructure/config/logger.ts` (lines 1–11, 56–92)
- `src/services/index.ts` (lines 1–18)
- `src/formatters/doctor.txt.ts` (lines 12–16)

**Pattern extraction date:** 2026-05-12

## PATTERN MAPPING COMPLETE

- **Phase 1 analog files cited (concrete excerpts in PATTERNS.md):** `src/cli/commands/doctor.ts` + `doctor.test.ts` (exact analog for `init`/`auth` CLI shims and tests — write+callback+exit pattern, vi.doMock dynamic-import test seam); `src/services/doctor/checks/native-modules.ts` + `native-modules.test.ts` (exact analog for `auth.ts`/`token-freshness.ts` probes — DoctorCheck producer shape, remediation-suffixed fail detail); `src/services/doctor/index.ts` + `check-names.ts` (exact analog for the orchestrator extension — PROBE_NAMES ordering rule, frozen-const+derived-type pattern); `src/mcp/sanitize.ts` + `sanitize.test.ts` (D-19 collapses to test-fixture additions only — `code` and `client_secret` are already in SECRET_KEY_NAMES at lines 21 and 29; D-20 F-block fixture pattern in lines 408–469); `src/services/doctor/checks/mcp-stdout-purity.ts` (closest harness for `oauth.ts` loopback-server lifecycle and for `tests/integration/auth-concurrency.test.ts` cross-process spawn pattern).
- **Sanity-check corrections to assumed file list:** (a) D-19 is **test-fixture-only** — no `sanitize.ts` regex changes needed (research already flagged this; confirmed against current `sanitize.ts`); (b) `src/services/doctor/checks/check-names.ts` is named that way in the repo (CONTEXT line 137 names it `check-names.ts`, not `services/doctor/check-names.ts`); (c) `src/infrastructure/whoop/` directory does not yet exist — Phase 2 creates it; (d) `tests/integration/` does not yet exist — Phase 2 creates it; (e) `src/services/doctor/checks/fixtures.ts` from Phase 1 is a vendored-as-TS pattern that does NOT apply to Phase 2's OAuth fixtures (those go on disk per `conventions.md`); (f) the `test/fixtures/` vs `tests/fixtures/` directory split is a real inconsistency the planner must resolve.
- **Net-new patterns with no in-repo analog:** `errors.ts` (discriminated-union — copy MR-21 closed-union voice from `doctor/index.ts`), `token-store.ts` (three-layer single-flight gate — copy from ADR-0002 + RESEARCH Patterns 1+2), `oauth.ts` (loopback OAuth + transient HTTP server — copy lifecycle harness from `mcp-stdout-purity.ts`). All three are flagged in "No Analog Found" with the right reference docs.
- **Shared cross-cutting patterns identified (7):** ADR-0001 stdout purity, named-exports-only, Zod-at-boundaries, error sanitization via `register.ts` wrapper (Phase 2 needs no new MCP wiring per D-17/D-18), factory+singleton test seam from `logger.ts`, frozen-const+derived-type from `check-names.ts`, `pool: 'forks'` + `vi.resetModules` per test from `doctor.test.ts`.
- **Output file written:** `/Users/chris.bremmer/recovery-ledger/.planning/phases/02-oauth-token-store-single-flight-refresh/02-PATTERNS.md`.
