// Types for the press harness's route-probe writer (Q94), so guards in src/test
// can import it under `tsc -b --noEmit`.
export type ProbeRow = { route: string; status: string; failed?: number };
export declare function screenOf(url: string): string;
export declare function routeProbePasses(results: readonly ProbeRow[]): string[];
export type ProbeFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }>;
export declare function recordRouteProbePasses(
  routes: readonly string[],
  runRef: string,
  opts?: { fetchImpl?: ProbeFetch; readEnvFile?: () => string },
): Promise<{ ok: boolean; recorded: number; why?: string }>;
