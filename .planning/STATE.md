# State: Recovery Ledger

**Last updated:** 2026-05-11
**Mode:** yolo
**Granularity:** standard

## Project Reference

- **Core Value:** Turn WHOOP data into a daily and weekly review loop that ends in 3 concrete decisions and a record of whether they helped — useful enough that Chris keeps using it.
- **Current Focus:** Foundation — bootstrap the TypeScript repo, lock stdout purity and the MCP error-sanitizer contract, and verify native-module load before any application code is written.

## Current Position

- **Milestone:** v1
- **Phase:** 1 — Foundation & Stdout-Pure MCP Bootstrap
- **Plan:** (none yet — run `/gsd-plan-phase 1` to derive plans)
- **Status:** Not started
- **Progress:** Roadmap defined; 49/49 v1 requirements mapped across 5 phases.

```
[░░░░░░░░░░░░░░░░░░░░] 0 / 5 phases complete
```

## Performance Metrics

| Metric | Value |
|--------|-------|
| Phases planned | 5 |
| Phases complete | 0 |
| v1 requirements mapped | 49 / 49 |
| v1 requirements complete | 0 / 49 |
| Plans drafted | 0 |
| Plans complete | 0 |

## Accumulated Context

### Decisions

- **TypeScript over Python (PROJECT.md Key Decision #1)** — retention beats library breadth for a personal tool.
- **Done bar = working loop, not retention numerics (PROJECT.md Key Decision #2)** — habit metrics tracked post-v1.
- **Firm scope guardrail (PROJECT.md Key Decision #3)** — Dashboard / BLE / hosted / cross-source integrations stay out until 12 daily reviews + 3 weekly reviews + 8 decisions + stable tests + non-fragile setup.
- **Read-only + BYO OAuth + no consumer-endpoint scraping (PROJECT.md Key Decision #4)** — durability over convenience.
- **MCP stdio + structured JSON with text fallback (PROJECT.md Key Decision #5)** — matches supported client matrix.
- **Lite-hexagonal architecture (research/ARCHITECTURE.md)** — pure-TS application core, two driving adapters (CLI, MCP), three driven adapters (WHOOP HTTP, Drizzle/SQLite, filesystem/keychain).
- **5-phase roadmap (research/SUMMARY.md, honored 1:1)** — Foundation → Auth → Data+Sync → Reviews+Decisions+MCP → Doctor+Setup.

### Open Todos

- Run `/gsd-plan-phase 1` to derive plans for Phase 1.
- Confirm whether to deepen research before Phase 2 planning (cross-process file-lock semantics + replay-on-401 contract are research-flagged).
- Confirm whether to deepen research before Phase 4 planning (confidence-tier thresholds, MAD scaling for small samples, FDR q-value defaults; Zod→JSON-Schema fidelity at the pinned SDK × Zod combination).

### Blockers

None.

### Notes

- Research is complete and HIGH-confidence (`research/SUMMARY.md`, `research/STACK.md`, `research/FEATURES.md`, `research/ARCHITECTURE.md`, `research/PITFALLS.md`).
- Cross-cutting concerns are explicitly mapped to the phase where they originate; tests live permanently in CI from that phase forward (see ROADMAP.md "Cross-Cutting Concerns" table).
- Project is a CLI + MCP stdio server — zero frontend. No UI phase applies.

## Session Continuity

### Last Session Summary

Initial roadmap created. 49 v1 requirements derived from PROJECT.md and grouped into 5 categories (Foundation, Authentication, Data Model & DB, Sync, Review, Decision Ledger, MCP Surface, Diagnostics & Setup). Research suggested a 5-phase structure (Foundation → Auth → Data+Sync → Reviews+Decisions+MCP → Doctor+Setup); roadmap honors that mapping 1:1 with 100% coverage. Cross-cutting concerns (stdout purity, single-flight refresh, score_state discipline, MAD+FDR+"no reliable pattern detected", banned-word lint, <20-minute setup) are anchored to their originating phase as test-enforced success criteria.

### Next Session

Run `/gsd-plan-phase 1` to decompose Phase 1 (Foundation & Stdout-Pure MCP Bootstrap) into executable plans. Phase 1 has no upstream dependencies and the patterns are standard — research/SUMMARY.md flags Phase 1 as "boring-and-correct" with no need for a deeper research pass.

---
*State initialized: 2026-05-11*
