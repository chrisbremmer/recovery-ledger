// selectActions — D-08 catalog-driven action selector. Pure function: no
// I/O, no logger, no clock.
//
// Selection algorithm (D-08 verbatim):
//   1. For each firing Anomaly, find every ACTION_CATALOG entry whose
//      `trigger.anomaly_metric === anomaly.metric` AND
//      `trigger.direction === anomaly.direction`.
//   2. Collect all matches across all anomalies.
//   3. Rank by `priority` ASC; tie-break by source order (the catalog is
//      `as const` + `Object.freeze`'d, so source order is stable).
//   4. Take the top 3 (D-08 cap).
//   5. Map each catalog entry to a `SuggestedAction` shape: `{ id, text,
//      metric, direction }` with metric + direction echoed from the
//      firing Anomaly.
//
// Returns `[]` when:
//   - `anomalies` is empty (ADR-0004 typed positive output — no anomaly
//     fired, no action needed).
//   - No catalog entry matches any firing anomaly (defensive; the catalog
//     covers every actionable D-06 direction so this branch should be
//     unreachable in production but stays correct if a future code path
//     constructs an Anomaly with metric + direction outside the catalog).

import type { Anomaly } from '../anomalies/types.js';
import type { SuggestedAction } from '../review/types.js';

import { ACTION_CATALOG, type ActionCatalogEntry } from './catalog.js';

const MAX_ACTIONS = 3;

interface RankedMatch {
  readonly entry: ActionCatalogEntry;
  readonly anomaly: Anomaly;
  readonly sourceIndex: number;
}

export function selectActions(anomalies: Anomaly[]): SuggestedAction[] {
  if (anomalies.length === 0) {
    return [];
  }

  const matches: RankedMatch[] = [];
  for (const anomaly of anomalies) {
    for (let i = 0; i < ACTION_CATALOG.length; i++) {
      const entry = ACTION_CATALOG[i];
      if (entry === undefined) {
        continue;
      }
      if (
        entry.trigger.anomaly_metric === anomaly.metric &&
        entry.trigger.direction === anomaly.direction
      ) {
        matches.push({ entry, anomaly, sourceIndex: i });
      }
    }
  }

  if (matches.length === 0) {
    return [];
  }

  // Rank by priority ASC; tie-break by source order ASC (Array.sort is not
  // guaranteed stable in older engines, but Node 22's V8 uses TimSort which
  // is stable — the explicit sourceIndex tie-break here keeps the contract
  // independent of engine sort stability).
  matches.sort((a, b) => {
    if (a.entry.priority !== b.entry.priority) {
      return a.entry.priority - b.entry.priority;
    }
    return a.sourceIndex - b.sourceIndex;
  });

  const top = matches.slice(0, MAX_ACTIONS);

  return top.map(({ entry, anomaly }) => ({
    id: entry.id,
    text: entry.text,
    metric: anomaly.metric,
    direction: anomaly.direction,
  }));
}
