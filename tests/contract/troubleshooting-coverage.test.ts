// Coverage contract — DOC-02 / D-09. The committed
// docs/install/troubleshooting.md MUST carry exactly one `## <check_name>`
// H2 section per CHECK_NAMES value, in the same order, with no extras.
//
// Forcing function: a developer who adds a check to CHECK_NAMES (or renames
// one) without updating troubleshooting.md loses this test in CI. The failure
// message points straight at the missing/extra section name so the fix is
// obvious — add (or remove) the `## <name>` H2 per the D-08 template.
//
// This is the load-bearing test for DOC-02's "structured exit codes that map
// to documented troubleshooting steps" clause: the doctor JSON `checks[].name`
// field is the key, and the troubleshooting H2 is the lookup target. The 1:1
// mapping is the convention this test pins.
//
// Zero-dep by design (RESEARCH §Specifics): H2 anchors are extracted with a
// plain /^## (\S+)$/gm regex — no markdown parser dependency. Deterministic
// and offline, so it runs in the default `npm test` suite (vitest.config.ts
// include glob covers tests/**/*.test.ts).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { CHECK_NAMES } from '../../src/services/doctor/checks/check-names.js';

describe('troubleshooting.md coverage', () => {
  // __dirname is tests/contract/; up two levels reaches the repo root.
  const md = readFileSync(
    resolve(__dirname, '..', '..', 'docs', 'install', 'troubleshooting.md'),
    'utf8',
  );
  // `m[1]` is the mandatory capture group, always present on a match; the
  // `filter(Boolean)` narrows the type from `(string | undefined)[]` to
  // `string[]` under noUncheckedIndexedAccess without changing runtime values.
  const h2s = [...md.matchAll(/^## (\S+)$/gm)]
    .map((m) => m[1])
    .filter((h): h is string => h !== undefined);
  const expected = Object.values(CHECK_NAMES);

  test('every CHECK_NAMES value has a matching ## H2 in troubleshooting.md', () => {
    for (const name of expected) {
      expect(
        h2s,
        `missing troubleshooting section: ## ${name} — add a section to docs/install/troubleshooting.md per the D-08 template`,
      ).toContain(name);
    }
  });

  test('H2 anchors appear in the same order as Object.values(CHECK_NAMES)', () => {
    // Filter h2s to only those that match a CHECK_NAMES value, ignoring any
    // other single-token H2 (the file's H1 is `# Troubleshooting ...`, not an
    // H2, so it never matches the /^## / regex anyway).
    const filtered = h2s.filter((h) => (expected as readonly string[]).includes(h));
    expect(
      filtered,
      'troubleshooting.md H2 order does not match CHECK_NAMES declaration order',
    ).toEqual(expected);
  });

  test('no EXTRA H2 anchors beyond CHECK_NAMES', () => {
    // Identify H2s that look like check names (lowercase + underscores + digits)
    // but are not in CHECK_NAMES — the stale-section case where a developer
    // renamed a CHECK_NAMES value and left the old H2 orphaned.
    const checkLike = h2s.filter((h) => /^[a-z0-9_]+$/.test(h));
    const extras = checkLike.filter((h) => !(expected as readonly string[]).includes(h));
    expect(
      extras,
      `unexpected troubleshooting H2s (not in CHECK_NAMES): ${extras.join(', ')}`,
    ).toEqual([]);
  });
});
