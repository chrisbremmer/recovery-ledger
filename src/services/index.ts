// Phase 1 Services barrel — stub. Plan 05 replaces createServices() with the
// real composition over native-module probes + the MCP stdout-purity self-test.
// The shape is locked here so Plan 03 (mcp/) and Plan 04 (sanitizer tests) can
// consume a stable contract while Plan 05's runDoctor() lands its implementation.

// DoctorCheck / DoctorResult are the view-layer shapes from CONTEXT.md D-06.
// MCP tools and the CLI `doctor` subcommand both render against these types.
export interface DoctorCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface DoctorResult {
  checks: DoctorCheck[];
  overall: 'pass' | 'warn' | 'fail';
}

export interface Services {
  runDoctor: () => Promise<DoctorResult>;
}

export function createServices(): Services {
  return {
    runDoctor: async (): Promise<DoctorResult> => ({ checks: [], overall: 'pass' }),
  };
}
