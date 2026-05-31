# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - v1.1

### Breaking Changes

- **`recovery-ledger sync --since` now requires strict ISO 8601** (`YYYY-MM-DD` or full datetime like `2026-05-31T00:00:00Z`). Previously-accepted locale-dependent inputs (`03/01/2026`, `yesterday`) and calendar-invalid dates (`2026-02-30`, `2026-13-01`) now exit non-zero with a clear error pointing at the supported format. Migration: use `YYYY-MM-DD` (e.g., `2026-05-31`) or full ISO 8601 with time. ([#80])

### Fixed

- Sanitizer now redacts camelCase token keys in error output (`accessToken`, `refreshToken`, `clientSecret`, `clientId`, `idToken`, `apiKey`, `bearerToken`) across JSON, URL-query, form-body, and JS-literal shapes. A 112-row property-style fixture matrix locks the contract. ([#78])
- `decisionsRepo.findByPrefix` now returns `[]` for prefixes shorter than 4 characters (no SQL issued). The CLI caller's existing "no decision matched" UX is preserved. ([#95])

[#78]: https://github.com/chrisbremmer/recovery-ledger/issues/78
[#80]: https://github.com/chrisbremmer/recovery-ledger/issues/80
[#95]: https://github.com/chrisbremmer/recovery-ledger/issues/95
