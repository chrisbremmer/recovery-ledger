# WHOOP Developer App Setup

## Why you need this

Recovery Ledger uses your own WHOOP developer app to read the v2 API on your behalf. There is no shared relay — your tokens stay local (see [`agent_docs/decisions/0002-single-flight-oauth-refresh.md`](../../agent_docs/decisions/0002-single-flight-oauth-refresh.md)).

## Step-by-step

1. Sign in at https://developer.whoop.com/dashboard/applications
2. Click "Create New Application." Name it whatever you want (for example, `Recovery Ledger - <your name>`).
3. Set the redirect URI to `http://127.0.0.1:4321/callback` (or whatever port you plan to give `init`; the default is 4321 and `recovery-ledger init` will prompt).
4. Select these scopes (all read-only — see [`agent_docs/decisions/0007-whoop-read-only.md`](../../agent_docs/decisions/0007-whoop-read-only.md)):
   - `read:profile`
   - `read:cycles`
   - `read:recovery`
   - `read:sleep`
   - `read:workout`
   - `read:body_measurement`
   - `offline` (required for token refresh)
5. Save. Copy the `client_id` and `client_secret` — you will paste them when you run `recovery-ledger init`.

## What WHOOP shows you next

The dashboard shows usage stats, recent API errors, and a button to rotate secrets. Recovery Ledger does not require any further setup on the WHOOP side.

## Common mistakes

- Wrong redirect URI: it must match exactly, including the trailing path (`/callback`).
- Forgetting the `offline` scope: token refresh will fail, and the `token_freshness` check from `recovery-ledger doctor` surfaces this.
- Pasting `client_secret` into a public chat or a commit: rotate it immediately via the WHOOP dashboard if this happens.
