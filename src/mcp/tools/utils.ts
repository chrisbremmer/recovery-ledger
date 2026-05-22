// Shared MCP-tool helpers (Review #45).
//
// Every Phase 4 tool used to define its own module-private
// `toStructuredContent` — same JSON.parse(JSON.stringify(...)) round-trip
// to turn the typed service result into the MCP-friendly
// `{ [k: string]: unknown }` shape. Centralizing the helper removes the 8
// near-identical copies and gives any future cross-cutting change (e.g.,
// switching to a structural deep-clone) a single edit site.

/**
 * Round-trip a service result through JSON to produce the
 * `structuredContent` shape the MCP SDK accepts. The deep-clone strips
 * non-JSON-serializable values (functions, undefined, symbols) so the
 * wire payload is well-formed regardless of how the service shaped its
 * return value.
 */
export function toStructuredContent<T>(r: T): { [k: string]: unknown } {
  return JSON.parse(JSON.stringify(r)) as { [k: string]: unknown };
}
