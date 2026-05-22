// `whoop_api_gap` type contracts — D-28 (in-source `ApiGapEntry[]`
// constant in Phase 4). Pure type file; no imports, no runtime
// behavior. The actual catalog (the load-bearing `ApiGapEntry[]`
// constant + the documented unavailable-via-API features) ships in
// Plan 04-10's `src/services/api-gap/data.ts`.
//
// Why a fixed literal type for `available_via_v2_api: false`:
// every entry in the Phase 4 v1 catalog is by definition unavailable
// via the v2 API — that's what makes it an "API gap." Locking the
// literal at the type level documents the contract at the type
// system: adding an entry with `available_via_v2_api: true` is a
// compile error. Phase 5 may extend with a `true` literal arm if the
// catalog grows to include "available but not surfaced" entries; v1
// keeps the surface narrow.

/**
 * One API-gap catalog entry per D-28. Documents a WHOOP consumer-app
 * feature that is NOT exposed via the public v2 API, plus any v2-API
 * alternative the user can substitute.
 *
 * - `feature` — human-readable consumer-app feature name
 *   (e.g., "Journal", "ECG", "Healthspan").
 * - `whoop_consumer_path` — where the feature lives in the WHOOP
 *   consumer app (UI navigation breadcrumb).
 * - `available_via_v2_api: false` — literal `false`; locks the
 *   contract at the type level (see file header).
 * - `alternative_via_v2` — the closest v2-API surface the user can
 *   substitute, or `null` if no alternative exists.
 * - `notes` — free-form explanation (why this isn't in the v2 API,
 *   what data shape would be needed if WHOOP added it, etc.). Must
 *   pass the ADR-0005 banned-word lint (Plan 04-09 contract test
 *   `formatter-tone.test.ts` runs the catalog through the lint).
 */
export interface ApiGapEntry {
  feature: string;
  whoop_consumer_path: string;
  available_via_v2_api: false;
  alternative_via_v2: string | null;
  notes: string;
}

/**
 * `whoop_api_gap` result shape. Single field — the catalog array.
 * Plan 04-10 `services.getApiGap()` returns the in-source constant
 * verbatim; no filtering, no pagination, no I/O.
 */
export interface ApiGapResult {
  // Review #33: `readonly` so the cast in getApiGap() drops out — the
  // backing `API_GAP_ENTRIES` is a frozen `as const` tuple and exposing
  // it as a mutable array was a lie.
  entries: readonly ApiGapEntry[];
}
