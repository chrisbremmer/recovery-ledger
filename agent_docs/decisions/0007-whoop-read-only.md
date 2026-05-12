# 0007. Read-only with respect to WHOOP

- **Status:** Accepted
- **Date:** 2026-05-12
- **Decider(s):** CB

## Context

Recovery Ledger reads from the WHOOP API and writes only to a local
SQLite database. The temptation, as features grow, will be to write
back to WHOOP — annotate a workout, mark a cycle, push a tag, sync a
decision into a WHOOP journal entry, etc.

Three reasons that doesn't happen:

1. **Scope creep risk.** Writes turn a local tool into a third-party
   automation, with all the trust + reliability + permission surface
   that implies.
2. **Trust + reversibility.** A local SQLite database is fully under
   the user's control; a WHOOP write is permanent and visible in the
   user's own app. The risk asymmetry is too high for a personal tool.
3. **OAuth scope.** Asking for write scopes during `init` makes the
   consent screen scarier and the security surface larger.

The decision ledger is a Recovery Ledger concept — local rows in
SQLite, not entries pushed to WHOOP. The two ledgers stay separate.

## Decision

**Recovery Ledger never writes to WHOOP.** Specifically:

- No HTTP `POST` / `PUT` / `PATCH` / `DELETE` calls to any WHOOP
  endpoint. The HTTP client only exposes `GET`.
- OAuth scopes requested at `init` are limited to the read scopes
  required for sync (the exact set is pinned in
  [`.planning/research/STACK.md`](../../.planning/research/STACK.md)
  / a future ADR when the scope list is finalised).
- No "consumer" or "private" WHOOP endpoint scraping — only the
  public documented API.
- The decision ledger is local. It is **not** mirrored to WHOOP via
  any future "journal" or "annotation" endpoint, even if WHOOP ships
  one.

## Consequences

- The HTTP client is one-directional, which simplifies retry +
  idempotency thinking (every WHOOP request is safe to retry).
- A future "share a decision with someone" feature would have to be
  built on a separate substrate (local export, copy-paste); it does
  not piggy-back on WHOOP.
- Privacy story stays simple: WHOOP sees Recovery Ledger as a
  read-only data consumer.

## Alternatives considered

- **Read + journal-write hybrid.** Rejected: doubles the OAuth scope
  surface and locks Recovery Ledger to WHOOP's journal endpoint
  shape.
- **Read-only with an opt-in write path.** Rejected: opt-in still
  means the codebase has the call site, which means it can ship.
  Not having the code path is the strongest guarantee.

## Enforcement

- The WHOOP HTTP client (`src/infrastructure/whoop/client.ts`,
  lands with Phase 2) exposes only `get(path, query)`. There is no
  `post` / `put` / `patch` / `delete` method.
- Biome import-restriction rule forbids direct use of `fetch` for
  WHOOP-host URLs outside the client module (defence in depth).
- ADR cross-reference in any future scope-related ADR.

## Cross-references

- [`../../.planning/PROJECT.md`](../../.planning/PROJECT.md) — scope
  and out-of-scope list
- [`../../.planning/REQUIREMENTS.md`](../../.planning/REQUIREMENTS.md)
  — permanent out-of-scope items
- [`0002-single-flight-oauth-refresh.md`](./0002-single-flight-oauth-refresh.md)
  — token store is read-only too
