---
phase: 01-foundation-stdout-pure-mcp-bootstrap
reviewed: 2026-05-12T00:00:00Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - src/cli/index.ts
  - src/cli/commands/doctor.ts
  - src/formatters/doctor.txt.ts
  - src/formatters/doctor.txt.test.ts
  - src/infrastructure/config/logger.ts
  - src/infrastructure/config/logger.test.ts
  - src/mcp/index.ts
  - src/mcp/register.ts
  - src/mcp/sanitize.ts
  - src/mcp/sanitize.test.ts
  - src/mcp/tools/whoop-doctor.ts
  - src/services/index.ts
  - src/services/doctor/index.ts
  - src/services/doctor/index.test.ts
  - src/services/doctor/checks/mcp-stdout-purity.ts
  - src/services/doctor/checks/native-modules.ts
  - src/services/doctor/checks/native-modules.test.ts
  - test/integration/mcp-stdout-purity.test.ts
  - test/fixtures/mcp/initialize.json
  - test/fixtures/mcp/initialized.json
  - test/fixtures/mcp/tools-list.json
  - test/fixtures/mcp/whoop-doctor-call.json
  - scripts/ci-grep-gates.sh
  - .github/workflows/ci.yml
  - package.json
  - tsconfig.json
  - tsup.config.ts
  - vitest.config.ts
findings:
  critical: 5
  warning: 7
  info: 5
  total: 17
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-05-12
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

Phase 1 lays down the cross-cutting stdout-purity nets, the MCP error sanitizer, and a stub `doctor` command. The MCP server's stdout is in fact clean on the happy path, the sanitizer redacts the four documented leak shapes, and the lint + grep gates compose correctly for the simple case.

However, the review surfaces five blocker-class defects and seven warnings. The two highest-impact findings:

1. **The `mcp_stdout_purity` doctor check (and the integration test that hangs off the same code path) spawns the MCP server, which in its `whoop_doctor` handler invokes `runDoctor()` → which invokes `probeMcpStdoutPurity()` again — recursive subprocess invocation.** Empirically (verified with `node dist/cli.mjs doctor`) the check returns `pass` with `"JSON-RPC stream valid (2 frames)"` — i.e., it never sees the `tools/call` response at all. Each invocation also leaves a transient orphan subprocess. The check is theater: it passes whether or not the `whoop_doctor` response is well-formed and whether or not it leaks tokens.

2. **The `recovery-ledger doctor` binary cannot run outside the source repo root.** `probeMcpStdoutPurity` reads `test/fixtures/mcp/*.json` relative to `process.cwd()` and spawns `dist/mcp.mjs` relative to `process.cwd()`. From `/tmp`, the doctor exits with `overall: fail` and `detail: "failed to load JSON-RPC fixtures from test/fixtures/mcp: ENOENT"`. Since FND-02 specifies `npx recovery-ledger`, this is the expected install vector — and it never works.

Other notable issues: the sanitizer is case-sensitive on the bare-`Bearer` pattern, leaves OAuth-2.0 form-encoded refresh bodies (`grant_type=refresh_token&refresh_token=…`) and URL query tokens (`?access_token=…`) untouched, and Gate A's `--exclude-dir=tests` typo silently scans the real `test/` directory (currently harmless, future trap). The dev-path logger is never exercised by the unit suite — a regression that dropped `destination: 2` from the `pino-pretty` options would not be caught.

## Critical Issues

### CR-01: `whoop_doctor` MCP tool recursively re-invokes the stdout-purity subprocess check; the check passes on incomplete evidence

**File:** `src/services/doctor/checks/mcp-stdout-purity.ts:50-160` (in conjunction with `src/mcp/tools/whoop-doctor.ts:11-17` and `src/services/doctor/index.ts:32-35`)
**Issue:** `runDoctor()` runs `probeMcpStdoutPurity()` which spawns `dist/mcp.mjs` and sends the `whoop-doctor-call.json` fixture. The child MCP server's `whoop_doctor` handler calls `services.runDoctor()` — which runs `probeMcpStdoutPurity()` again, spawning a grandchild `dist/mcp.mjs`. The chain only terminates because the parent's 1.1s settle/drain budget expires and it SIGTERMs the immediate child. SIGTERM does not propagate to grandchildren (no `detached`/process-group kill), so transient orphan processes leak.

Empirically: `node dist/cli.mjs doctor` returns `mcp_stdout_purity: pass — "JSON-RPC stream valid (2 frames)"`. Two frames means only `initialize` (id=1) and `tools/list` (id=2) were observed — the actual `tools/call:whoop_doctor` response (id=3) never arrived before SIGTERM. The check therefore reports `pass` without ever validating the response it was designed to validate, including the D-10 token-leak surface (the sanitizer's only run-through is in the OUTER subprocess, which the integration test exercises directly — this check adds zero coverage).

Additionally, sampling `ps` during the run confirms two `mcp.mjs` processes alive simultaneously (PID 94172 + 94203 in the verification run). On a slower CI host or in parallel test execution, the chain could pile deeper.

**Fix:** The `whoop_doctor` MCP tool must not invoke the subprocess check from inside the MCP server. Two options:

```ts
// Option A (preferred): exclude the subprocess check when running from within MCP.
// Pass a context flag through services so MCP-side runDoctor skips the recursive probe.
export interface RunDoctorOptions { skipSubprocessChecks?: boolean }
export async function runDoctor(opts: RunDoctorOptions = {}): Promise<DoctorResult> {
  const checks = await Promise.all([
    probeBetterSqlite3(),
    probeKeyring(),
    opts.skipSubprocessChecks
      ? Promise.resolve({ name: 'mcp_stdout_purity', status: 'pass' as const,
          detail: 'skipped (running inside MCP transport)' })
      : probeMcpStdoutPurity(),
  ]);
  return { checks, overall: deriveOverall(checks) };
}
// src/mcp/tools/whoop-doctor.ts:
const result = await services.runDoctor({ skipSubprocessChecks: true });

// Option B: make the integration test (D-02b) the sole authority for the subprocess check
// and drop probeMcpStdoutPurity from the runtime doctor entirely. The CLI's doctor still
// reports native-module checks; the MCP-purity assertion is build-time only via vitest.
```

Either fix also needs an explicit unit assertion that `runDoctor()` invoked from inside `whoop_doctor` does not spawn `dist/mcp.mjs` (regression guard).

---

### CR-02: `recovery-ledger doctor` cannot run outside the repo root — fixture and binary paths are cwd-relative

**File:** `src/services/doctor/checks/mcp-stdout-purity.ts:19,27,55,72`
**Issue:** `FIXTURE_DIR = 'test/fixtures/mcp'`, `MCP_ENTRY = 'dist/mcp.mjs'`, and `spawn(process.execPath, [MCP_ENTRY], { ... /* no cwd */ })` all rely on `process.cwd()`. Verified: running `cd /tmp && node <repo>/dist/cli.mjs doctor` yields:

```json
{
  "checks": [{ "name": "mcp_stdout_purity", "status": "fail",
    "detail": "failed to load JSON-RPC fixtures from test/fixtures/mcp:
               ENOENT: no such file or directory, open 'test/fixtures/mcp/initialize.json'" }],
  "overall": "fail"
}
```

Since FND-02 commits to `npx recovery-ledger`, every real install (and every user-facing invocation outside the source tree) reports `overall: fail`. Compounding the issue: `tsup.config.ts` does not include fixtures in the `dist/` output, so even resolving paths relative to `import.meta.url` would not help unless fixtures are packaged.

**Fix:**
```ts
// 1. Move fixtures into src/ so tsup can include them, or copy them via a build step:
//    package.json:  "build": "tsup && cp -R test/fixtures/mcp dist/fixtures/mcp"
//    Better: vendor the fixtures as TS constants in src/services/doctor/checks/fixtures.ts.

// 2. Resolve paths relative to the running script, not cwd:
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, '../../../fixtures/mcp'); // post-build dist/fixtures/mcp
const MCP_ENTRY = resolve(HERE, '../mcp.mjs');              // post-build dist/mcp.mjs
```

Vendoring the four small fixtures as TS literal constants in a separate `fixtures.ts` is the simplest fix and eliminates the read-file failure mode entirely.

---

### CR-03: Sanitizer leaks OAuth refresh-grant bodies and access-token URL parameters

**File:** `src/mcp/sanitize.ts:12-42`
**Issue:** The pattern catalog covers four shapes (Authorization header / JSON `access_token` etc. / JWT shape / bare `Bearer`). It does NOT cover two shapes that WHOOP refresh requests will produce in Phase 2:

1. **Form-encoded refresh body.** WHOOP's OAuth token endpoint accepts `application/x-www-form-urlencoded`:
   ```
   grant_type=refresh_token&refresh_token=abc123&client_secret=xyz
   ```
   If `undici`/native fetch surfaces the request body in an error message (it does on connection errors), every value leaks verbatim. The current regex requires JSON quote-delimited values; form bodies use `=value&` framing.

2. **Access-token in URL query.** `?access_token=abc123xyz` and `?refresh_token=…` appear in OAuth callback URLs (and any logged fetch URL or redirect). Verified: `sanitize('error fetching https://api.whoop.com/v2?access_token=abc123xyz')` returns the input unchanged.

These are documented WHOOP wire shapes, and the FND-06/AUTH-06 contract is "no token material in MCP errors." The catalog must cover them before Phase 2 ships.

**Fix:** Add two patterns to `PATTERNS` (order: more-specific first, place them between current rules 2 and 3):

```ts
// 2a. URL query parameters: `?...&access_token=VALUE` / `&refresh_token=VALUE` / `&code=VALUE`
{
  pattern: /([?&](?:access_token|refresh_token|code|client_secret)=)[^&\s"']+/gi,
  replacement: '$1<redacted>',
},
// 2b. Form-encoded body fields (same key list, but `key=value` framing without `?`/`&` prefix)
{
  pattern: /\b(access_token|refresh_token|client_secret)=([^&\s"']+)/gi,
  replacement: '$1=<redacted>',
},
```

Add corresponding test cases in `sanitize.test.ts` (D-10 fixture block) for `grant_type=refresh_token&refresh_token=…` and `?access_token=…`.

---

### CR-04: Bare `Bearer` redaction is case-sensitive — `bearer …` / `BEARER …` leak

**File:** `src/mcp/sanitize.ts:38-41`
**Issue:** Pattern 4 (`/Bearer\s+[A-Za-z0-9._-]{10,}/g`) lacks the `i` flag. Verified:
```
sanitize('bearer abcdefghijk') → 'bearer abcdefghijk'   (NOT redacted)
sanitize('BEARER abcdefghijk') → 'BEARER abcdefghijk'   (NOT redacted)
sanitize('Bearer abcdefghijk') → 'Bearer <redacted>'    (redacted)
```

Pattern 1 (Authorization-header form) has `gi`, which is why the test `'authorization: bearer abc.def.ghi'` passes — pattern 1 matches first and pre-empts pattern 4. But errors that lack the `Authorization:` prefix (e.g., undici's `UND_ERR_*` body excerpts, hand-written log lines, third-party libraries) hit pattern 4 only. The casing of HTTP token output is not normalized; many servers/log-formatters lowercase header names and values together.

**Fix:**
```ts
{
  pattern: /Bearer\s+[A-Za-z0-9._-]{10,}/gi,  // add 'i'
  replacement: 'Bearer <redacted>',
},
```

Add a P4 lowercase test: `expect(sanitize('bearer abcdefghijk')).toBe('Bearer <redacted>')` (or update the replacement to `'<redacted Bearer token>'` if you'd rather not introduce case-canonicalization). Also extend the F4 fixture to cover lower/upper-case Bearer.

---

### CR-05: Subprocess-check returns `pass` based on whatever frames arrived, not on the frames it was supposed to receive

**File:** `src/services/doctor/checks/mcp-stdout-purity.ts:124-151`
**Issue:** The success arm runs:
```ts
const lines = stdoutBuf.split('\n').filter((l) => l.length > 0);
for (const line of lines) { /* assert JSON-RPC */ }
finalise({ status: 'pass', detail: `JSON-RPC stream valid (${lines.length} frames)` });
```

It (a) does not require any frames at all on the happy path — if the child died before emitting any output, `lines.length === 0`, the for-loop is skipped, and the check reports `pass` with `"(0 frames)"`. (b) Does not verify that the response to `tools/call` (id=3) actually arrived. Combined with CR-01, this is how the empirical run reports `pass` after observing only 2 of the 3 expected response frames.

The same code is the basis for the integration test (`test/integration/mcp-stdout-purity.test.ts`), but the test ALSO asserts `expect(lines.length).toBeGreaterThan(0)` and `expect(toolCallResponse).toHaveProperty('result')`. The check module — used by the doctor binary — has neither assertion.

**Fix:**
```ts
const lines = stdoutBuf.split('\n').filter((l) => l.length > 0);
if (lines.length === 0) {
  finalise({ name: 'mcp_stdout_purity', status: 'fail',
    detail: 'subprocess emitted no stdout frames before drain elapsed' });
  return;
}
const parsedFrames: Array<Record<string, unknown>> = [];
for (const line of lines) {
  // ...existing parse + isJsonRpcMessage checks, push parsed object to parsedFrames...
}
// New: require the tools/call (id=3) response, mirroring the integration test.
const toolCallResp = parsedFrames.find((f) => f.id === 3);
if (!toolCallResp || !('result' in toolCallResp)) {
  finalise({ name: 'mcp_stdout_purity', status: 'fail',
    detail: 'tools/call response (id=3) missing or errored' });
  return;
}
finalise({ status: 'pass', detail: `JSON-RPC stream valid (${lines.length} frames)` });
```

This change combined with CR-01 (skip the recursive probe from inside the MCP server) ensures the check has real teeth instead of a false-positive shape.

---

## Warnings

### WR-01: Dev-path logger is never exercised by the unit suite — a regression that dropped `destination: 2` from pino-pretty options would silently corrupt MCP stdout

**File:** `src/infrastructure/config/logger.ts:26-34`, `src/infrastructure/config/logger.test.ts:10-39`
**Issue:** The test imports `{ logger }` from `./logger.js`. The branch chosen by `logger.ts` is determined at module-load by `process.env.NODE_ENV === 'development'`. Vitest does NOT set `NODE_ENV=development`; under `vitest run` it's typically unset or `'test'`. So both tests verify ONLY the production path. The dev path (which routes through `pino-pretty`'s worker thread with `destination: 2`) is never asserted.

`pino-pretty`'s default `outputStream` is `process.stdout`. If a future edit drops `options: { destination: 2 }` (or renames it, or a new pretty option overrides it), `npm run dev:mcp` would write log lines onto the MCP JSON-RPC stream — the exact failure mode FND-04/05 exist to prevent.

**Fix:** Restructure `logger.ts` to expose a factory that the test can drive with explicit env, then assert both arms:
```ts
// logger.ts — make the factory testable
export function createLogger(env: { NODE_ENV?: string; LOG_LEVEL?: string }) {
  const isDev = env.NODE_ENV === 'development';
  return isDev
    ? pino({ level: env.LOG_LEVEL ?? 'debug',
             transport: { target: 'pino-pretty', options: { destination: 2 } } })
    : pino({ level: env.LOG_LEVEL ?? 'info' },
            pino.destination({ dest: 2, sync: false }));
}
export const logger = createLogger(process.env);

// logger.test.ts — dev arm
test('dev logger transport options bind destination to fd 2', () => {
  // Inspect the constructed transport options without spawning a worker, e.g.,
  // by also exporting the resolved options shape, OR fall back to a subprocess
  // test (cheapest: spawn `tsx -e "require('./src/infrastructure/config/logger').logger.info('x')"`
  // with NODE_ENV=development and assert stdout is empty + stderr has the line).
});
```

If a subprocess test is too heavy, at minimum expose the resolved transport-options object as a named export and assert `options.destination === 2`.

---

### WR-02: Gate A's `--exclude-dir=tests` typo silently scans the real `test/` directory

**File:** `scripts/ci-grep-gates.sh:36`
**Issue:** The exclusion list contains `--exclude-dir=tests` (plural). The repo's test directory is `test/` (singular). Verified by `ls -d */`: only `dist`, `node_modules` are excluded; `test/` is scanned. Currently passes because no Phase 1 test file contains banned words, but the gate is one well-named test fixture (`unlock-flow.test.ts`, `journey.fixtures.ts`) away from a false-positive CI failure that has nothing to do with user-facing tone.

**Fix:**
```sh
REPO_EXCLUDES=(
  --exclude-dir=.git
  --exclude-dir=.planning
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=coverage
  --exclude-dir=.worktrees
  --exclude-dir=test                 # was: tests
  --exclude-dir=tests                # keep, for forward-compat with any later 'tests/' dir
  --exclude=CLAUDE.md
  --exclude=ci-grep-gates.sh
)
```

Note: if you DO want test files scanned for tone words (some teams do, since fixture text can leak into user-facing snapshot comparisons), the right move is to remove the exclusion entirely and audit current files; either way the current state is "neither documented intent" — silently scanning is the worst outcome.

---

### WR-03: Integration-test final drain budget (1500 ms) is tight against macOS-latest CI cold-start spawn latency

**File:** `test/integration/mcp-stdout-purity.test.ts:31-38`
**Issue:** After the outer test writes `tools/call:whoop_doctor` (id=3) it waits `FINAL_DRAIN_MS = 1500ms` for the response. The handler in the OUTER MCP server calls `services.runDoctor()` which runs `probeMcpStdoutPurity()` — that probe spawns its OWN `dist/mcp.mjs` and waits 4×200ms + 300ms = 1100ms before resolving. So the outer response arrives ~1100ms after id=3 was sent. On a warm dev machine this lands inside 1500ms; on a cold macOS-latest CI runner where the inner `spawn` can cost 200–400ms additional latency (Node start + module resolution), the outer response can arrive past the drain window, leaving id=3 absent from `frames` and triggering `expect(toolCallResponse, …).toBeDefined()` to fail intermittently.

This is also dependent on CR-01 — once the recursive subprocess is removed, the timing budget shrinks dramatically, and 1500ms is generous. Until then, the test is fragile.

**Fix:** After applying CR-01 (so the inner subprocess no longer runs from inside the tool call), reduce `FINAL_DRAIN_MS` to 500ms. Until then, lift to 3000ms with an explanatory comment, OR replace the timer-based drain with response-driven waiting:
```ts
// Replace the fixed setTimeout with: read until id=3 response appears or 5s elapses
const idsSeen = new Set<unknown>();
await new Promise<void>((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('tools/call (id=3) timeout 5s')), 5000);
  child.stdout.on('data', (b: Buffer) => {
    stdoutChunks.push(b);
    const text = Buffer.concat(stdoutChunks).toString('utf8');
    for (const line of text.split('\n').filter(Boolean)) {
      try { idsSeen.add((JSON.parse(line) as { id?: unknown }).id); } catch {}
    }
    if (idsSeen.has(3)) { clearTimeout(t); resolve(); }
  });
});
```

Response-driven is faster on hot CI and more robust to slow runners.

---

### WR-04: Subprocess-check writes to a closed/broken stdin without catching the EPIPE / write-after-end error

**File:** `src/services/doctor/checks/mcp-stdout-purity.ts:114-122`
**Issue:**
```ts
for (const frame of frames) {
  if (settled) return;
  if (!child.stdin.writable) break;
  child.stdin.write(frame);
  await new Promise((r) => setTimeout(r, FRAME_SETTLE_MS));
}
```
`child.stdin.writable` is checked before write, but stdin can become non-writable mid-loop (child exits between two writes). `child.stdin.write(frame)` will then either return `false` (drain backpressure — benign) or emit an `'error'` event that, without a listener, becomes an unhandled stream error and surfaces as an unhandled `Promise` rejection in the IIFE.

The IIFE's outer `try/catch` catches `throw` but does not catch async `'error'` events on streams. Same hazard at line 83 `child.stdin.end()` if stdin is already closed.

**Fix:**
```ts
child.stdin.on('error', () => { /* swallow EPIPE; child may have exited */ });
// And/or guard write() with a writable check that's atomic with the write:
for (const frame of frames) {
  if (settled || !child.stdin.writable) break;
  try {
    child.stdin.write(frame);
  } catch (err) {
    finalise({ name: 'mcp_stdout_purity', status: 'fail',
      detail: `stdin write failed: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  await new Promise((r) => setTimeout(r, FRAME_SETTLE_MS));
}
```

---

### WR-05: `services.runDoctor()` invocation in `whoop-doctor.ts` casts `DoctorResult` through `unknown` to satisfy MCP `structuredContent`; the cast hides shape drift

**File:** `src/mcp/tools/whoop-doctor.ts:15`
**Issue:** `structuredContent: result as unknown as Record<string, unknown>`. The double-cast (`as unknown as`) is the canonical TypeScript escape hatch for "I know this is not assignable; please trust me." It's a smell because:

1. If a future `DoctorResult` change adds a non-serializable field (e.g., a `Date` not auto-converted by JSON, a function, a Map), MCP serialization fails at runtime with no type-system signal.
2. The MCP spec restricts `structuredContent` to JSON-serializable values; the cast bypasses any structural check.

**Fix:** Define a `JsonValue` recursive type and constrain `DoctorResult` to be assignable to `Record<string, JsonValue>`:
```ts
type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue };
// Then in DoctorResult, every field is a JsonValue → the cast becomes a no-op:
structuredContent: result,  // no cast needed
```
The added type discipline pays off in Phase 4 when each tool result needs the same shape contract.

---

### WR-06: `process.exit(result.overall === 'fail' ? 1 : 0)` discards `warn` and conflates a partial-failure with success

**File:** `src/cli/commands/doctor.ts:14`
**Issue:** D-06 specifies three statuses (`pass`/`warn`/`fail`) and DOC-02 ("doctor emits structured exit codes that map to documented troubleshooting steps"). Phase 1's stub conflates `warn` and `pass` into exit 0. Scripted users (cron, launchd, CI wrappers) that consume the exit code lose the warn signal — they'd treat `warn: stale-frame` identically to `pass`. DOC-02 is a Phase 5 requirement, but the contract Phase 1 ships becomes the precedent every wrapper script binds against.

**Fix:** Reserve exit codes now, even if only the trivial mapping is implemented:
```ts
const exitCode = { pass: 0, warn: 2, fail: 1 }[result.overall];
process.exit(exitCode);
```
Document the mapping in a comment so Phase 5 can extend it. Exit 2 is the conventional "warning" code on POSIX.

---

### WR-07: `logger.test.ts` symbol-introspection test's catch block is unreachable

**File:** `src/infrastructure/config/logger.test.ts:28-37`
**Issue:** The test wraps:
```ts
try {
  const stream = (logger as ...)[streamSym] as { fd?: number } | undefined;
  expect(stream?.fd).toBe(2);
} catch (err) {
  expect.fail(`pino.symbols.streamSym no longer exposes destination — fall back to Test 1 + …`);
}
```
The only operations inside the try are a property access (returns `undefined` if symbol missing — does NOT throw) and an `expect().toBe(2)` (when target is `undefined`, throws a `vitest` assertion error). The catch fires only on assertion failure, replacing vitest's clear diff output with a less-informative `expect.fail` message that still references the same root cause. Net effect: the catch makes diagnosis HARDER, not easier.

**Fix:** Drop the try/catch and let vitest's native diff explain the failure:
```ts
test('exported logger is bound to fd 2 via pino.symbols.streamSym', () => {
  const streamSym = pino.symbols.streamSym;
  const stream = (logger as unknown as Record<symbol, unknown>)[streamSym] as
    | { fd?: number } | undefined;
  expect(stream, 'pino.symbols.streamSym no longer resolves on the logger instance').toBeDefined();
  expect(stream?.fd).toBe(2);
});
```

---

## Info

### IN-01: Sanitizer pattern 2 (`access_token`/`refresh_token`/`client_secret` JSON values) does not match re-escaped JSON

**File:** `src/mcp/sanitize.ts:23-26`
**Issue:** When a nested error embeds a JSON string into another JSON value, the inner quotes are escaped: `{\"access_token\":\"abc\"}` (often produced by `JSON.stringify` of an error body, or by `inspect()` on a parsed object). Pattern 2 expects `"key"`, not `\"key\"`. Verified: `sanitize('Error: {\\"access_token\\":\\"abc\\"}')` returns the input unchanged.

This is an edge case for now (Phase 1 has no real error producers), but Phase 2's error chain from `fetch` + JSON-body parsing is likely to hit it. Worth catching before AUTH-01.

**Fix:** Extend pattern 2 to tolerate either `"` or `\"` around the key and value:
```ts
{
  pattern: /(\\?"(?:access_token|refresh_token|client_secret)\\?"\s*:\s*\\?")[^"\\]+/g,
  replacement: '$1<redacted>',
},
```
And add a unit case for the re-escaped form.

---

### IN-02: `mcp_stdout_purity` check fails CLOSED on missing fixtures (good) but the error message says "from test/fixtures/mcp" without absolute-path context

**File:** `src/services/doctor/checks/mcp-stdout-purity.ts:65-68`
**Issue:** Once CR-02 is fixed, `FIXTURE_DIR` becomes a resolved absolute path. The error string already templates the dir — keep it, but note that today the user sees `failed to load JSON-RPC fixtures from test/fixtures/mcp` and has no clue what cwd was used. Confusing on bug reports.

**Fix:** Include `process.cwd()` (or, after CR-02, the resolved absolute path) in the detail:
```ts
detail: `failed to load JSON-RPC fixtures from ${path.resolve(FIXTURE_DIR)}: ${msg}`,
```

---

### IN-03: `register.ts` wrapper does not sanitize handler-returned `isError: true` payloads — only thrown errors

**File:** `src/mcp/register.ts:34-46`
**Issue:** D-09 says "wraps every handler in try/catch/sanitize." Today the wrapper only sanitizes the `catch` branch. A handler that builds an error response by hand (`return { content: [...], isError: true }`) bypasses the sanitizer entirely. Phase 1's only tool is `whoop_doctor` and its handler never builds isError manually, so no live leak. But the contract documented in D-09 is broader than what's enforced; flag it so Phase 4 tool authors are aware.

**Fix:** Either (a) document explicitly that the sanitizer covers thrown errors only, and tools that return `isError: true` payloads are responsible for sanitizing their own content; or (b) post-process the handler return value when `isError: true`:
```ts
const out = await handler(...args);
if (out.isError === true && Array.isArray(out.content)) {
  return {
    ...out,
    content: out.content.map((c) =>
      c.type === 'text' ? { ...c, text: sanitize(c.text) } : c),
  };
}
return out;
```

---

### IN-04: `runDoctor()`'s `Promise.all` swallows individual check timing — no per-check duration is captured

**File:** `src/services/doctor/index.ts:32-35`
**Issue:** Each check runs in parallel and returns a `DoctorCheck` with `name`/`status`/`detail`. There is no field for elapsed time. DOC-02 (Phase 5) will want per-check duration for the troubleshooting map; locking the shape now without it means a Phase 5 schema break.

**Fix:** Add an optional `durationMs?: number` field on `DoctorCheck` and have each probe wrap itself in `performance.now()` start/end:
```ts
export interface DoctorCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  durationMs?: number;
}
```
Optional now, populated later — no Phase 1 work needed beyond reserving the slot.

---

### IN-05: `tsup.config.ts` does not emit type declarations; future package consumers (decision ledger CLI scripts, etc.) cannot import types

**File:** `tsup.config.ts:1-15`
**Issue:** `dts` is not set, so dist/ contains only `.mjs` and `.mjs.map`. Phase 1 is a private package (`"private": true`), so this is fine today. Flagging it so Phase 5 (Diagnostics & Setup) doesn't trip over the absence when documenting the CLI surface.

**Fix (deferred until needed):** Add `dts: true` when an external consumer of types is identified.

---

_Reviewed: 2026-05-12_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
