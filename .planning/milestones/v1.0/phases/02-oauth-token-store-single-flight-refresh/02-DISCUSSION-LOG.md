# Phase 2: OAuth, Token Store & Single-Flight Refresh - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-12
**Phase:** 02-oauth-token-store-single-flight-refresh
**Areas discussed:** init vs auth split, Token storage layout, Loopback OAuth UX, OAuth scopes

---

## init vs auth split

| Option | Description | Selected |
|--------|-------------|----------|
| Separate commands, no auto-chain | `init` writes config; `auth` runs OAuth; user runs both explicitly | ✓ |
| Auto-chain | `init` writes config then automatically runs `auth` | |
| Single `init` command | One command does both config and OAuth | |

**User's choice:** Delegated to Claude. Selected "Separate commands, no auto-chain".
**Notes:** Rationale — separates "rotate WHOOP app credentials" (rare, config-only) from "re-authorize this install" (state-changing OAuth event). Same separation `git init` vs `git remote set-url` enforce. Also lets `init` be re-run safely on credential rotation without triggering a fresh OAuth dance.

---

## Token storage layout

| Option | Description | Selected |
|--------|-------------|----------|
| `~/.recovery-ledger/` (top-level dotdir) | Matches ARCHITECTURE.md draft; most discoverable for single-user dev tool | ✓ |
| XDG (`~/.config/recovery-ledger/`) | XDG-compliant on Linux; non-standard on macOS | |
| `env-paths` cross-platform paths | Returns OS-appropriate paths but ugly suffixes (`-nodejs`) | |
| macOS-native (`~/Library/Application Support/recovery-ledger/`) | Conventional on macOS only; verbose on Linux | |

**User's choice:** Delegated. Selected `~/.recovery-ledger/` with `RECOVERY_LEDGER_HOME` override.
**Notes:** Keyring stores a single JSON blob (access_token + refresh_token + expires_at + scope + obtained_at) under service `recovery-ledger`, account `whoop`. File fallback at `~/.recovery-ledger/tokens.json` mode 0600 uses the same JSON shape. Lock file at `~/.recovery-ledger/tokens.json.lock` (always exists regardless of storage backend; just a coordination point). Config at `~/.recovery-ledger/config.json` mode 0600 (client_secret is sensitive).

---

## Loopback OAuth UX

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-open browser + minimal HTML success page + 5min timeout + CSRF state | Standard secure OAuth UX, low-friction | ✓ |
| Print URL only, no auto-open | Lowest deps; worse UX | |
| Auto-open + rich styled HTML pages | Extra polish, more surface area for bugs | |

**User's choice:** Delegated. Selected the standard secure path.
**Notes:** `open` package for cross-platform browser launch; graceful fallback to printed URL on failure (also reachable via `--no-browser` flag). Minimal HTML success/failure pages with no CSS / no JS / no external assets. 5-min timeout configurable via `--timeout`. CSRF state token (32 random bytes, base64url-encoded). PKCE used if WHOOP supports it (research item) — fall back to state-only protection if WHOOP doesn't support PKCE for confidential clients with client_secret.

---

## OAuth scopes

| Option | Description | Selected |
|--------|-------------|----------|
| Full read set up front | All scopes on the consent screen, single authorization | ✓ |
| Minimal + escalate | Request just `offline` + profile initially, ask for more later | |
| Per-resource on-demand | Re-prompt user when they first use a feature needing a new scope | |

**User's choice:** Delegated. Selected "full read set up front".
**Notes:** Request `offline read:recovery read:sleep read:workout read:cycles read:profile read:body_measurement`. Every Recovery Ledger feature needs the full set; there's no UX gain from least-privilege-now-escalate-later when WHOOP would re-prompt for consent on every scope change. `offline` is non-negotiable (required for refresh tokens). Exact scope-string vocabulary is a research item — names above are my best inference; researcher confirms against current WHOOP v2 docs.

---

## Claude's Discretion

The user delegated all four discussion areas at once: "Discuss them all amongst yourself, come to me if there isn't a clear winner." I worked through each and landed clear winners on all of them — no escalation. Additional implementation decisions also landed by discretion within the same pass:

- **Refresh trigger & retry policy** (D-14, D-15, D-16) — 5-minute pre-expiry buffer per ARCHITECTURE.md, single retry on 401, refresh-failure retry budget of 0 per STACK.md.
- **MCP integration scope** (D-17, D-18) — Phase 2 adds no new MCP tools; Phase 1's `register.ts` sanitizer wrapping covers all auth-derived errors that surface through `whoop_doctor`.
- **Sanitizer pattern extension** (D-19, D-20) — add `code=...` and (verify-vs-Phase-1) `client_secret` JSON-key patterns; positive + negative + cause-chain tests.
- **Doctor checks added in Phase 2** (D-21, D-22) — `auth` and `token-freshness` checks added; WHOOP roundtrip check deferred to Phase 5.
- **Concurrent-load test design** (D-23, D-24) — unit-level Promise.all([10]) MSW test for fast feedback + cross-process integration test (`pool: 'forks'`) as the load-bearing AUTH-05 / ROADMAP §Phase 2 success criterion #2 assertion.
- **Linux fallback-path test** (D-25) — owned this phase; CI matrix grows `ubuntu-latest` row gated on `RECOVERY_LEDGER_FORCE_FILE_STORE=1`.

## Deferred Ideas

- WHOOP roundtrip check in `doctor` — Phase 5 (offline-safe Phase 2 doctor)
- Multi-account support — keyring account `whoop:<user-id>` migration when v2
- Token rotation observability — refresh-counter in `doctor` for debugging
- `recovery-ledger reset auth` subcommand — Phase 5 if install-guide feedback shows manual `rm tokens.json` / Keychain Access.app steps are confusing
- AES-256-GCM passphrase-encrypted file fallback — STACK.md proposes it; v1 ships plaintext-`chmod 600` to honor AUTH-03 wording; hardening pass if needed
- `@modelcontextprotocol/inspector` CI smoke — still deferred from Phase 1
- Refresh-rate-limit detection (429 backoff on `/oauth/oauth2/token`) — revisit if observed
