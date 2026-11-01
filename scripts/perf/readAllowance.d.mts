// Types for scripts/perf/readAllowance.mjs (cwv-lab's --allow-reads).
/** The READ ALLOWANCE (`--allow-reads`): which allowed read a non-GET request is, or null. */
export declare function allowedRead(
  reads: { rpcs: Set<string>; refresh: boolean } | null,
  method: string,
  url: string,
  body: string | null | undefined,
): string | null;
/** The lab's fixed stripe-payouts list answer (test data). */
export declare const LAB_STRIPE_PAYOUTS: {
  connected: boolean;
  payouts_enabled: boolean;
  available: { amount: number; currency: string }[];
  pending: { amount: number; currency: string }[];
  instant_available: { amount: number; currency: string }[];
  payouts: { id: string; amount: number; currency: string; status: string; arrival_date: number; method: string; created: number; description: string | null }[];
};
/** The MOCKED READS of `--allow-reads`: a read the lab answers itself, or null. */
export declare function mockedRead(
  reads: { rpcs: Set<string>; refresh: boolean } | null,
  method: string,
  url: string,
  body: string | null | undefined,
): { read: string; body: typeof LAB_STRIPE_PAYOUTS } | null;
