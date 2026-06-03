# 0002. Single-flight OAuth refresh

- **Status:** Accepted
- **Date:** 2026-05-12
- **Decider(s):** CB

## Context

WHOOP OAuth issues short-lived access tokens (~1 hour) paired with
rotating refresh tokens. Each refresh call returns a *new* refresh token
and invalidates the old one. WHOOP treats reuse of a stale refresh token
as a security event: it revokes the entire token family, forcing the
user back through `init` with a browser-based authorization code grant.

Recovery Ledger runs as both a CLI (one-shot commands) and an MCP server
(long-lived, multi-tool). These can run concurrently — the CLI for a
manual `sync`, the MCP server already up serving Claude Code. If both
processes hit an expired access token at the same time, both will try
to refresh with the same refresh token. The first one succeeds; the
second presents a now-invalid token; WHOOP revokes the family.

## Decision

**Every refresh path goes through a three-layer single-flight gate:**

1. **In-process single-flight.** A module-level `Promise<Tokens> | null`
   serialises concurrent refresh attempts in the same process. The
   second caller awaits the first's result.
2. **Cross-process advisory lock** via `proper-lockfile` (the only
   primitive that works portably across macOS + Linux without depending
   on `flock(1)`, which macOS does not ship). The lock target is the
   token-store file (`<config-dir>/tokens.json.lock`) with
   `{ retries: { retries: 10, factor: 1.2, minTimeout: 50 }, stale: 60_000 }`.
   Held only across the refresh request, not for the whole token
   lifetime. `stale` is set to 60s — safely above the in-process
   `TOKEN_REQUEST_TIMEOUT_MS` (30s) cap on the WHOOP token-endpoint
   POST. The original 5s ceiling was unsafe: a slow POST could exceed
   5s under rate limiting or transient TLS latency, letting a sibling
   reclaim the lock as stale and POST the same refresh_token — WHOOP
   then revokes the entire token family (#31). The tradeoff (a
   crashed-mid-refresh process holds the lock 60s) is the cheaper
   failure: callers wait, not burn the family.
3. **Atomic temp-and-rename write.** Refreshed tokens are written to
   `tokens.json.tmp`, fsynced, then renamed over `tokens.json`. Readers
   see either the old or the new file, never a partial write.

No code path may bypass this — there is no "simpler" refresh path. The
token-store module exposes a single `getValidAccessToken()` function;
all callers go through it.

## Consequences

- A refresh in progress blocks other callers briefly. Acceptable
  because refreshes are rare (~hourly) and fast (< 1s).
- The token store is the only module that knows about refresh
  mechanics. Adapters and services receive a fresh access token and a
  cancellation handle; they do not handle 401s by refreshing
  themselves.
- A stuck lock (process killed mid-refresh) requires manual recovery —
  document the recovery path in `init` and surface a clear error.

## Alternatives considered

- **Process-only lock.** Rejected: CLI + MCP are different processes.
- **Database-stored token with `SELECT … FOR UPDATE`.** Rejected: adds
  a SQLite transaction round-trip to every API call; file lock is
  cheaper.
- **`flock(1)` shell-level lock.** Rejected: macOS does not ship `flock(1)`
  (only `flock(2)` syscall); cross-platform support requires a Node
  primitive. `proper-lockfile` is the chosen library.
- **Pessimistic "always refresh once per process start".** Rejected:
  burns refresh tokens unnecessarily and still races between
  concurrent processes.

## Enforcement

- Token-store module is the only consumer of the refresh endpoint;
  enforced by a Biome import-restriction rule (lands with Phase 2 when
  the token store is implemented).
- Contract test that spawns two concurrent calls to
  `getValidAccessToken()` and asserts the WHOOP refresh endpoint is hit
  exactly once.
- **ERRC-02 (#87) — refresh-write atomicity:** a refresh response whose
  HTTP succeeded but whose `writeUnderLock` failed (mkdir EACCES, EROFS,
  disk full, keyring `setPassword` threw, rename failure) MUST surface
  `AuthError({kind: 'refresh_failed'})` so the caller forces re-auth.
  Silently retrying with the stale on-disk refresh token after the
  rotated pair was already consumed by WHOOP burns the family on the
  next process invocation. Locked by
  `src/infrastructure/whoop/token-store.test.ts` R-01.
- **ARCH-02 (#85) — exactly one tokenStore per process for DB-coupled flows:**
  production code MUST construct `tokenStore` exactly once via
  `bootstrap()`. The historical
  `export const tokenStore = createTokenStore()` module-load singleton in
  `src/infrastructure/whoop/token-store.ts` is forbidden — bootstrap is
  the sanctioned construction site for DB-coupled flows, and consumers
  receive the instance through the `Bootstrapped` surface.
  The OAuth-login flow (`src/cli/commands/auth.ts`) is the sole documented exception:
  it constructs its own `createTokenStore()` instance because
  the login flow does not bootstrap (no DB needed; bootstrapping would
  slow login and surface migration errors during a DB-independent
  action). Tests construct fresh stores via `createTokenStore(...)`;
  nothing imports the (deleted) singleton. Enforced by three CI grep
  gates plus their text-form equivalents:
  - Gate L (`^export const (tokenStore|refreshOrchestrator|callWithAuth)`
    in `src/`): forbids the historical module-load singleton exports.
    Text form: `rg "^export const tokenStore" src` MUST return zero
    matches.
  - Gate N (`createTokenStore\(` call sites in non-test `src/`): forbids
    new call sites outside the two sanctioned files. Text form:
    `rg -n 'createTokenStore\(' src --type ts | rg -v '\.test\.ts:' | rg -v
    -E '(src/infrastructure/whoop/token-store\.ts|src/services/bootstrap\.ts|src/cli/commands/auth\.ts):'`
    MUST return zero matches. (`token-store.ts` is the definition
    itself; `bootstrap.ts` is the DB-coupled construction site;
    `auth.ts` is the OAuth-login exception.)
  - Gate M (`from '.../services/'` inside `src/infrastructure/`): forbids
    the cross-layer arrow ARCH-03 inverted.

  **For future contributors:** if you need a third sanctioned
  construction site, AMEND THIS ADR FIRST and update Gate N's
  whitelist. Do not copy the auth.ts pattern silently — Gate N will
  fire in CI.

## Cross-references

- [`../workflows/debugging.md`](../workflows/debugging.md) — "OAuth
  refresh failures" runbook entry
- [`../../.planning/research/ARCHITECTURE.md`](../../.planning/research/ARCHITECTURE.md)
  — token store module placement
