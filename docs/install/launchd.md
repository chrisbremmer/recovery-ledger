# Scheduled Daily Sync via launchd (macOS)

## What this gives you

A scheduled daily sync at 6:30 AM local time so your morning review has fresh data. This is macOS-native through launchd — no third-party scheduler.

## Prerequisites

- macOS (Phase 5 is macOS-only; Linux users use cron, and systemd timers are tracked as V2-03).
- `recovery-ledger` on PATH (run `npm link` from the repo root), or note the absolute path to `dist/cli.mjs`.
- `recovery-ledger init` and `recovery-ledger auth` complete.

## Installation

1. Resolve the recovery-ledger bin path:
   ```sh
   RECOVERY_LEDGER_BIN=$(which recovery-ledger)
   # Or, if you did not run npm link:
   # RECOVERY_LEDGER_BIN=$(realpath dist/cli.mjs)
   ```
2. Substitute the placeholders and copy the result to LaunchAgents:
   ```sh
   sed -e "s|\${RECOVERY_LEDGER_BIN}|$RECOVERY_LEDGER_BIN|g" \
       -e "s|\${HOME}|$HOME|g" \
       templates/com.recovery-ledger.daily-sync.plist \
     > ~/Library/LaunchAgents/com.recovery-ledger.daily-sync.plist
   ```
   The literal `${RECOVERY_LEDGER_BIN}` and `${HOME}` placeholders are substituted by `sed` before load. launchd does not shell-expand them at load time, so this substitution step is required.
3. Load the agent:
   ```sh
   launchctl load ~/Library/LaunchAgents/com.recovery-ledger.daily-sync.plist
   ```
4. Verify it is loaded:
   ```sh
   launchctl list | grep com.recovery-ledger
   # Should show: <PID-or-dash> <exit-code> com.recovery-ledger.daily-sync
   ```

## Verifying the schedule fires

The agent fires at 6:30 AM by default. The morning after install, run:

```sh
recovery-ledger doctor
```

The `last_sync_recency` check should report "last sync <H>h ago" within the threshold. Logs are written to `~/.recovery-ledger/launchd.log`.

## Customizing the schedule

Edit the `StartCalendarInterval` keys in `~/Library/LaunchAgents/com.recovery-ledger.daily-sync.plist`. Reload after editing:

```sh
launchctl unload ~/Library/LaunchAgents/com.recovery-ledger.daily-sync.plist
launchctl load ~/Library/LaunchAgents/com.recovery-ledger.daily-sync.plist
```

## Uninstalling

```sh
launchctl unload ~/Library/LaunchAgents/com.recovery-ledger.daily-sync.plist
rm ~/Library/LaunchAgents/com.recovery-ledger.daily-sync.plist
```

## Troubleshooting

- If `launchctl list` does not show the agent: re-check the load step's exit code. macOS may reject the plist if the XML is malformed; `plutil -lint ~/Library/LaunchAgents/com.recovery-ledger.daily-sync.plist` validates it.
- If the morning sync did not fire: the laptop must be awake at the scheduled time. macOS does not run launchd agents on a sleeping machine; the next wake fires the job once.
- If `last_sync_recency` shows the sync did not run: check `~/.recovery-ledger/launchd.log` for errors. A common cause is a stale OAuth token — `recovery-ledger doctor` surfaces this as `token_freshness: warn`, and running `recovery-ledger auth` to re-authorize fixes it.

Reference: `man launchd.plist`, `man launchctl`.
