# Installing Recovery Ledger

Recovery Ledger is a local-first TypeScript CLI + MCP stdio server. Not affiliated with WHOOP. BYO OAuth.

## Prerequisites

- Node 22 LTS or newer (verify with `node --version`).
- macOS 14+ or Linux. On Linux, install `libsecret` for keychain-backed token storage; without it, tokens fall back to a `chmod 600` file (see [`agent_docs/decisions/0002-single-flight-oauth-refresh.md`](agent_docs/decisions/0002-single-flight-oauth-refresh.md) for the file-fallback posture).
- A WHOOP developer app — see [`docs/install/whoop-app.md`](docs/install/whoop-app.md) for the step-by-step.

## WHOOP developer-app setup

The full checklist (scopes, redirect URI, where to copy your credentials) lives in [`docs/install/whoop-app.md`](docs/install/whoop-app.md). In short: sign in at developer.whoop.com/dashboard/applications, create an app, register the redirect URI `http://127.0.0.1:4321/callback` (`init` prompts for the port; 4321 is the default), and select the read-only scopes listed in [`docs/install/whoop-app.md`](docs/install/whoop-app.md).

## Quickstart

```sh
git clone https://github.com/<owner>/recovery-ledger.git
cd recovery-ledger
npm install
npm run build
node dist/cli.mjs init           # paste client_id + client_secret
node dist/cli.mjs auth           # opens the OAuth browser flow
node dist/cli.mjs sync           # pulls 30 days of WHOOP data
node dist/cli.mjs review daily   # your first brief
```

The `<owner>` placeholder stays generic until the repository URL is finalized.

## Connect to your AI client

- [Claude Code](docs/install/claude-code.md)
- [Claude Desktop](docs/install/claude-desktop.md)
- [Cursor](docs/install/cursor.md)

## Troubleshooting

If `recovery-ledger doctor` reports a check failure, see [`docs/install/troubleshooting.md`](docs/install/troubleshooting.md) — one section per check name from `recovery-ledger doctor`.

## Scheduled daily sync (macOS)

See [`docs/install/launchd.md`](docs/install/launchd.md).

## What's available via the WHOOP API (and what isn't)

See [`docs/install/api-gap.md`](docs/install/api-gap.md).

## Verifying your install

Run `node dist/cli.mjs doctor` (or `recovery-ledger doctor` if you ran `npm link`). All checks should show `pass` or a documented warning. The exit code is `0` for pass, `1` for fail, and `2` for warn.
