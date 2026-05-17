// Profile repository — single-row variant of the canonical repository shape.
// WHOOP v2 profile is keyed by user_id (int64); the response carries no
// `updated_at` field (A4), so there is no cursor() method. Sync flow fetches
// once per run via getProfile() and writes through upsert(); current-state
// semantics rather than append history.
//
// Reads return the camelCase Profile entity per D-28; the raw_json payload
// is hidden from the entity shape and accessed via the diagnostic
// getRawJson(userId) seam per D-29.

import { eq, sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/better-sqlite3';
import type { Profile } from '../../../domain/types/entities.js';
import { profile as profileTable } from '../schema.js';

export interface ProfileRepo {
  /** Returns the single Profile row or null if the table is empty. */
  getCurrent(): Profile | null;
  /** Replace-on-write semantics — ON CONFLICT(user_id) DO UPDATE per D-11.
   *  Wrapped in BEGIN IMMEDIATE per D-31. `fetchedAt` is the sync-time ISO
   *  string; `rawJson` is the WHOOP wire payload preserved for D-29. */
  upsert(
    input: {
      userId: number;
      email: string;
      firstName: string;
      lastName: string;
      rawJson: string;
    },
    opts: { clock: Date },
  ): void;
  /** D-29 diagnostic seam — returns the raw WHOOP profile JSON or null. */
  getRawJson(userId: number): string | null;
}

type ProfileRow = typeof profileTable.$inferSelect;

export function createProfileRepo(db: ReturnType<typeof drizzle>): ProfileRepo {
  return {
    getCurrent(): Profile | null {
      const row = db.select().from(profileTable).get();
      return row ? rowToProfile(row) : null;
    },

    upsert(input, opts): void {
      const fetchedAt = opts.clock.toISOString();
      db.transaction(
        (tx) => {
          tx.insert(profileTable)
            .values({
              user_id: input.userId,
              email: input.email,
              first_name: input.firstName,
              last_name: input.lastName,
              raw_json: input.rawJson,
              fetched_at: fetchedAt,
            })
            .onConflictDoUpdate({
              target: profileTable.user_id,
              set: {
                email: sql`excluded.email`,
                first_name: sql`excluded.first_name`,
                last_name: sql`excluded.last_name`,
                raw_json: sql`excluded.raw_json`,
                fetched_at: sql`excluded.fetched_at`,
              },
            })
            .run();
        },
        { behavior: 'immediate' },
      );
    },

    getRawJson(userId: number): string | null {
      const row = db
        .select({ raw_json: profileTable.raw_json })
        .from(profileTable)
        .where(eq(profileTable.user_id, userId))
        .get();
      return row?.raw_json ?? null;
    },
  };
}

function rowToProfile(row: ProfileRow): Profile {
  return {
    userId: row.user_id,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
    fetchedAt: row.fetched_at,
  };
}
