// Native-module load probes (D-05 / FND-07).
//
// Each probe proves the underlying `.node` binary loaded against the current
// Node ABI without touching the filesystem (better-sqlite3 :memory:) or the
// system keychain (keyring Entry constructor only). This is the Phase 1
// contract; Phase 2 will replace the keyring probe with a real round-trip
// once the token store lands. See PITFALLS.md Pitfall 2 for the ABI-mismatch
// failure mode this probe catches.

import type { DoctorCheck } from '../index.js';

export async function probeBetterSqlite3(): Promise<DoctorCheck> {
  try {
    const mod = await import('better-sqlite3');
    // Cheapest binding-touched assertion: open an in-memory DB and immediately
    // close. `:memory:` never touches disk; this only proves the .node binary
    // loaded under the current ABI.
    const db = new mod.default(':memory:');
    db.close();
    return { name: 'better_sqlite3_load', status: 'pass', detail: 'native binding loaded' };
  } catch (err) {
    return {
      name: 'better_sqlite3_load',
      status: 'fail',
      detail: `failed to load: ${err instanceof Error ? err.message : String(err)} — try \`npm rebuild better-sqlite3\``,
    };
  }
}

export async function probeKeyring(): Promise<DoctorCheck> {
  try {
    const mod = await import('@napi-rs/keyring');
    // Construct an Entry without any read/write — proves the napi binding
    // loaded. The constructor does not issue keychain syscalls; those happen
    // only on `.setPassword()` / `.getPassword()`.
    new mod.Entry('recovery-ledger', 'doctor-probe');
    return { name: 'napi_keyring_load', status: 'pass', detail: 'native binding loaded' };
  } catch (err) {
    return {
      name: 'napi_keyring_load',
      status: 'fail',
      detail: `failed to load: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
