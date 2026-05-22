// MCP prompt-message builder — Plan 04-10 Task 3 + D-27.
//
// D-27: every Phase 4 prompt returns exactly one user-role message with
// text-type content. The `as const` literals are load-bearing for TS
// narrowing — the SDK types `role` and `content.type` as literal unions,
// so a `string`-typed assignment would fail the structural check.
//
// Pure function — no I/O, no logger. Composes prompt-handler results
// uniformly across the 4 prompt files.

export function buildPromptMessage(text: string): {
  messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }>;
} {
  return {
    messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }],
  };
}
