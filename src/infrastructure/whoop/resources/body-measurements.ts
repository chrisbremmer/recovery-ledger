// Body-measurements resource module — single-shot per A4 (no pagination,
// no since/until). D-17 + D-18 + ADR-0007. Endpoint path
// `/v2/user/measurement/body` verified against the WHOOP v2 docs + the
// Plan 03-07 MSW helper's BODY_MEASUREMENTS_URL constant.
//
// Returns BOTH the raw payload AND the normalized intermediate shape so
// the sync orchestrator (Plan 03-11) can pass `JSON.stringify(raw)` to
// the Plan 03-08 bodyMeasurementsRepo.upsertOnChange `rawJson` parameter
// without re-parsing. `WhoopRawBodyMeasurement` is a single-record Zod
// schema per Plan 03-03 + the verified WHOOP v2 measurement-body shape.

import type { z } from 'zod';
import {
  type NormalizedBodyMeasurement,
  normalizeBodyMeasurement,
} from '../../../domain/normalize/body-measurements.js';
import { WhoopRawBodyMeasurement } from '../../../domain/schemas/whoop-api.js';
import { httpGet } from '../client.js';

export interface GetBodyMeasurementResult {
  raw: z.infer<typeof WhoopRawBodyMeasurement>;
  entity: NormalizedBodyMeasurement;
}

export async function getBodyMeasurement(): Promise<GetBodyMeasurementResult> {
  const raw = await httpGet('/v2/user/measurement/body', {}, WhoopRawBodyMeasurement);
  const entity = normalizeBodyMeasurement(raw, { clock: new Date() });
  return { raw, entity };
}
