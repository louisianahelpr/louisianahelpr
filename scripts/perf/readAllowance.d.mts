// Types for scripts/perf/readAllowance.mjs (cwv-lab's --allow-reads).
/** The READ ALLOWANCE (`--allow-reads`): which allowed read a non-GET request is, or null. */
export declare function allowedRead(
  reads: { rpcs: Set<string>; refresh: boolean } | null,
  method: string,
  url: string,
  body: string | null | undefined,
): string | null;
