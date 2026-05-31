# Phase 6 Research

Milestone-level research has already been done at `.planning/research-v1.1/` and covers all Phase 6 issues. This file is a pointer + delta.

## Pointer

- **Stack additions:** none. `z.iso.date()` is already on the pinned `zod@^4.4.3`. See `.planning/research-v1.1/STACK.md` § #80.
- **Feature category:** Secret hygiene (#78, #79) + CLI input validation (#80). See `.planning/research-v1.1/FEATURES.md` § Categories.
- **Architectural impact:** none for Phase 6 — sanitize.ts stays in `infrastructure/observability/`. Moving it to `domain/` is ARCH-01 in Phase 10. See `.planning/research-v1.1/ARCHITECTURE.md`.
- **Pitfalls:** #80 user-visible breaking change; sanitize fixture-matrix sprawl; MCP stdout purity collision (ADR-0001). See `.planning/research-v1.1/PITFALLS.md`.

## Phase 6 delta

No new research required. The milestone-level research already enumerates:
- The exact files to change (`infrastructure/observability/sanitize.ts`, `services/doctor/checks/whoop-roundtrip.ts`, `cli/commands/doctor.ts`, `cli/commands/init.ts`, `infrastructure/whoop/token-store.ts`, `mcp/index.ts`).
- The exact Zod API to use (`z.iso.date()`).
- The success criteria (sanitizer covers ≥ 50 key shapes; doctor CLI/MCP emit identical sanitized text; `--since` rejects locale dates).

## Out-of-scope research

Anything not in scope for Phase 6 — see CONTEXT.md § Out of Scope.
