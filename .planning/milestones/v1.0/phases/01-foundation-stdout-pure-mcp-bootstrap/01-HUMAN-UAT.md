---
status: partial
phase: 01-foundation-stdout-pure-mcp-bootstrap
source: [01-VERIFICATION.md]
started: 2026-05-12T18:50:00Z
updated: 2026-05-12T18:50:00Z
---

## Current Test

[awaiting human verification]

## Tests

### 1. GitHub Actions CI run on macos-latest is green

expected: The `.github/workflows/ci.yml` workflow runs end-to-end on a real GitHub Actions macos-latest runner — `checkout → setup-node from .nvmrc → npm ci → npm run lint → npm run build → npm run test → bash scripts/ci-grep-gates.sh` — with conclusion `success`.
how to verify:
  1. `git push origin main`
  2. `gh run watch` (or `gh run list --limit 1 --json conclusion`)
  3. Confirm conclusion = `success` for the workflow named "CI"
rationale: The verifier ran the full pipeline locally (lint, tsc, build, test, grep-gates all green), but Phase 1's success criterion #5 requires CI itself to enforce the contract. A green local run does not certify the GitHub Actions environment (Node setup, action pinning, cache key, macos-latest binary compatibility).
result: [pending]

### 2. MCP Inspector handshake spot-check

expected: `npx @modelcontextprotocol/inspector node dist/mcp.mjs` opens the inspector UI, discovers the `whoop_doctor` tool, invokes it, and returns a structured `DoctorResult` with `overall: pass` and three `pass` checks. No console errors, no stdout pollution warnings.
how to verify:
  1. `npm run build`
  2. `npx @modelcontextprotocol/inspector node dist/mcp.mjs`
  3. In the Inspector UI: connect → list tools → invoke `whoop_doctor` with empty arguments → confirm response shape
rationale: The automated subprocess fixture in `test/integration/mcp-stdout-purity.test.ts` is the load-bearing contract. The Inspector handshake confirms the same plumbing works in the canonical client an end-user (Chris) will use day-to-day. Manual-only because Inspector is an interactive TTY tool.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

(none yet — pending human run of the two items above)
