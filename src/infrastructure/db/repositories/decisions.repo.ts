// Decisions repository. Phase 3 shipped the minimal write surface (insert /
// byId / listOpen) per Open Question 2; Phase 4 extends with 4 additional
// methods that anchor DEC-02 + D-20 + D-22:
//
//   updateOutcome — DEC-02 outcome write (status + notes), wrapped in
//                   `db.transaction({behavior: 'immediate'})` per Pitfall 13.
//   countSince    — D-22 weekly-prompt gating; SQLite lexicographic compares
//                   on ISO-8601 strings give correct chronology.
//   findByPrefix  — D-20 short-prefix lookup for `decision update <id>`; CLI
//                   normalizes user input to upper-case before LIKE-scan
//                   because the ULID alphabet is upper-case Crockford Base32.
//   listAll       — D-20 `--all` flag; returns every row regardless of status,
//                   newest first.
//
// The `decisions` table is irreplaceable user data per Pitfall 7. Every write
// here goes through the ORM's prepared statements (T-04-S2 mitigation) — no
// hand-built SQL strings, no concatenation with user input.

import { desc, eq, gte, sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Decision } from '../../../domain/types/entities.js';
import { decisions as decisionsTable } from '../schema.js';

export interface DecisionsRepo {
  /** Insert a new decision. Throws on PK collision — ULID generation is
   *  the caller's responsibility and is collision-resistant in practice. */
  insert(d: {
    id: string;
    createdAt: string;
    category: string;
    decision: string;
    rationale: string | null;
    confidence: 'low' | 'medium' | 'high' | null;
    expectedEffect: string | null;
    followUpDate: string | null;
  }): void;
  /** Point lookup; null when the id is absent. */
  byId(id: string): Decision | null;
  /** Open-status decisions, newest first. Phase 5 doctor surfaces the
   *  count as a data-quality signal. */
  listOpen(): Decision[];
  /** DEC-02 outcome write. Idempotent: writing the same status + notes
   *  twice is a no-op. A non-existent id silently no-ops (0 rows changed);
   *  the caller verifies via `byId(id)` if surfacing an error is desired. */
  updateOutcome(id: string, status: 'open' | 'followed_up' | 'abandoned', notes: string | null): void;
  /** D-22 weekly-prompt gating. Returns the count of rows whose
   *  `created_at >= date`. `date` is any ISO-8601 string (yyyy-mm-dd or
   *  full timestamp) — SQLite lexicographic comparison gives correct
   *  chronological ordering on the canonical ISO format. */
  countSince(date: string): number;
  /** D-20 short-prefix lookup for `decision update <id-or-prefix>`. The
   *  input is normalized to upper-case before LIKE-scan; case-insensitive
   *  from the caller's perspective. Returns every row whose `id` starts
   *  with `prefix.toUpperCase()`. The caller decides what to do with
   *  zero / one / many matches (ambiguity check). */
  findByPrefix(prefix: string): Decision[];
  /** D-20 `--all` flag for `decision review`. Returns every row regardless
   *  of status, newest first (`created_at DESC`). */
  listAll(): Decision[];
}

type DecisionRow = typeof decisionsTable.$inferSelect;

export function createDecisionsRepo(db: ReturnType<typeof drizzle>): DecisionsRepo {
  return {
    insert(d): void {
      db.transaction(
        (tx) => {
          tx.insert(decisionsTable)
            .values({
              id: d.id,
              created_at: d.createdAt,
              category: d.category,
              decision: d.decision,
              rationale: d.rationale,
              confidence: d.confidence,
              expected_effect: d.expectedEffect,
              follow_up_date: d.followUpDate,
              // status defaults to 'open' at the schema layer; outcome_notes
              // stays null until the updateOutcome flow lands a value.
            })
            .run();
        },
        { behavior: 'immediate' },
      );
    },

    byId(id: string): Decision | null {
      const row = db.select().from(decisionsTable).where(eq(decisionsTable.id, id)).get();
      return row ? rowToDecision(row) : null;
    },

    listOpen(): Decision[] {
      const rows = db
        .select()
        .from(decisionsTable)
        .where(eq(decisionsTable.status, 'open'))
        .orderBy(desc(decisionsTable.created_at))
        .all();
      return rows.map(rowToDecision);
    },

    updateOutcome(id, status, notes): void {
      // Pitfall 13: explicit `behavior: 'immediate'` so the BEGIN locks
      // the database up front. A deferred BEGIN can upgrade mid-flight
      // and defeat the per-connection busy_timeout.
      db.transaction(
        (tx) => {
          tx.update(decisionsTable)
            .set({ status, outcome_notes: notes })
            .where(eq(decisionsTable.id, id))
            .run();
        },
        { behavior: 'immediate' },
      );
    },

    countSince(date): number {
      const row = db
        .select({ n: sql<number>`COUNT(*)` })
        .from(decisionsTable)
        .where(gte(decisionsTable.created_at, date))
        .get();
      return row?.n ?? 0;
    },

    findByPrefix(prefix): Decision[] {
      const normalized = `${prefix.toUpperCase()}%`;
      const rows = db
        .select()
        .from(decisionsTable)
        .where(sql`${decisionsTable.id} LIKE ${normalized}`)
        .all();
      return rows.map(rowToDecision);
    },

    listAll(): Decision[] {
      const rows = db
        .select()
        .from(decisionsTable)
        .orderBy(desc(decisionsTable.created_at))
        .all();
      return rows.map(rowToDecision);
    },
  };
}

function rowToDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    createdAt: row.created_at,
    category: row.category,
    decision: row.decision,
    rationale: row.rationale,
    confidence: row.confidence,
    expectedEffect: row.expected_effect,
    followUpDate: row.follow_up_date,
    status: row.status,
    outcomeNotes: row.outcome_notes,
  };
}
