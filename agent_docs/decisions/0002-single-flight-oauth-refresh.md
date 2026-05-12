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
2. **Cross-process advisory lock.** A `flock`-style file lock on the
   token store (path: `<config-dir>/tokens.lock`) serialises refreshes
   across CLI + MCP processes. The lock is held only across the refresh
   request, not for the whole token lifetime.
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

## Cross-references

- [`../workflows/debugging.md`](../workflows/debugging.md) — "OAuth
  refresh failures" runbook entry
- [`../../.planning/research/ARCHITECTURE.md`](../../.planning/research/ARCHITECTURE.md)
  — token store module placement
