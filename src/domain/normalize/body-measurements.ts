// Body-measurement normalizer — pure function (D-28 + Pattern C3 + D-35).
//
// Raw snake_case Zod-parsed `WhoopRawBodyMeasurement` → the input shape the
// Plan 03-08 `bodyMeasurementsRepo.upsertOnChange` accepts, plus a derived
// `capturedAt` field captured from the injected clock at sync time. The
// repository synthesizes the `id` at insert time (autoincrement per D-35)
// so the normalizer does not produce one.
//
// `raw.user_id` is `.optional()` in the Zod schema for forward-compat but
// the repository requires it; the normalizer throws when missing rather
// than producing an entity with a `null` user_id that would silently drop
// the row at insert time.

import type { z } from 'zod';
import type { WhoopRawBodyMeasurement } from '../schemas/whoop-api.js';

export interface NormalizeBodyMeasurementOpts {
  /** Sync-time clock — captured as `capturedAt` for the history timeline. */
  clock: Date;
}

export interface NormalizedBodyMeasurement {
  userId: number;
  heightMeter: number;
  weightKilogram: number;
  maxHeartRate: number;
  capturedAt: string;
}

export function normalizeBodyMeasurement(
  raw: z.infer<typeof WhoopRawBodyMeasurement>,
  opts: NormalizeBodyMeasurementOpts,
): NormalizedBodyMeasurement {
  if (raw.user_id === undefined) {
    throw new Error('normalizeBodyMeasurement: raw.user_id is required but missing');
  }
  return {
    userId: raw.user_id,
    heightMeter: raw.height_meter,
    weightKilogram: raw.weight_kilogram,
    maxHeartRate: raw.max_heart_rate,
    capturedAt: opts.clock.toISOString(),
  };
}
