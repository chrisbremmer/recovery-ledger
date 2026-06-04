// API-gap catalog — D-28 in-source `ApiGapEntry[]` constant. Documents the
// WHOOP consumer-app features that are NOT exposed via the public v2 API,
// each with the closest v2-API substitute (`alternative_via_v2`) when one
// exists. The v1 catalog covers the six features named in REQUIREMENTS
// §Out of Scope; Phase 5 (DOC-03/04) generates the API-gap markdown from
// this same module.
//
// Phase 10 ARCH-08 (#86): this catalog was previously at
// `src/services/api-gap/data.ts`, and the `ApiGapEntry` interface was at
// `src/services/api-gap/types.ts`. Both moved here because the catalog is
// pure data with zero I/O — per the lite-hexagonal layering rule (domain
// has no upward arrows), pure data belongs in the domain tier. The
// services-layer accessor (`getApiGap()`) now imports the catalog from
// here through `src/services/api-gap.ts`.
//
// Object.freeze on the array gives runtime immutability matched to the
// `readonly ApiGapEntry[]` type. The literal `available_via_v2_api: false`
// is enforced by the type — adding a `true` arm requires extending the
// type first.
//
// Every string field passes the ADR-0005 / D-26 banned-tone-word lint at
// module load — the contract test in `src/services/api-gap.test.ts` runs
// `containsBannedToneToken` over each entry × each field.
//
// No imports: pure TypeScript built-ins only. Domain modules have no
// upward arrows; the only allowed dependencies are other domain modules,
// and this file deliberately depends on none.

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

export const API_GAP_ENTRIES: readonly ApiGapEntry[] = Object.freeze<ApiGapEntry[]>([
  {
    feature: 'Healthspan',
    whoop_consumer_path: 'WHOOP app → Health Monitor → Healthspan',
    available_via_v2_api: false,
    alternative_via_v2: 'closest proxy: long-run trends in recovery_score',
    notes:
      'WHOOP-only composite score combining recovery, strain, sleep, and other inputs. Not exposed on the public v2 API.',
  },
  {
    feature: 'ECG (electrocardiogram)',
    whoop_consumer_path: 'WHOOP app → Heart → ECG',
    available_via_v2_api: false,
    alternative_via_v2: null,
    notes:
      'Single-lead ECG capture for atrial-fibrillation detection. Raw waveforms are not exposed on the v2 API.',
  },
  {
    feature: 'Blood Pressure',
    whoop_consumer_path: 'WHOOP app → Heart → Blood Pressure',
    available_via_v2_api: false,
    alternative_via_v2: null,
    notes: 'Cuffless blood-pressure estimation. Not exposed on the v2 API.',
  },
  {
    feature: 'Journal',
    whoop_consumer_path: 'WHOOP app → Journal',
    available_via_v2_api: false,
    alternative_via_v2: null,
    notes: 'Daily lifestyle-factor logging (alcohol, caffeine, etc.). Not exposed on the v2 API.',
  },
  {
    feature: 'Continuous Heart Rate',
    whoop_consumer_path: 'WHOOP app → Heart → Continuous HR',
    available_via_v2_api: false,
    alternative_via_v2: 'closest proxy: cycle.day_strain reflects HR-derived load over the day',
    notes:
      'Second-by-second heart-rate stream. The v2 API exposes summary fields per cycle but not the raw stream.',
  },
  {
    feature: 'Hormonal Insights',
    whoop_consumer_path: 'WHOOP app → Health Monitor → Hormonal Insights',
    available_via_v2_api: false,
    alternative_via_v2: null,
    notes:
      'Menstrual-cycle phase tracking with strain/recovery overlays. Not exposed on the v2 API.',
  },
]);
