// Types for the press harness's non-app failure classifier (Q128), so guards in
// src/test can import it under `tsc -b --noEmit`.
export declare const TELEMETRY_HOST_RX: RegExp;
export declare const VENDOR_HOST_RX: RegExp;
export declare function requestOwner(url: string | null | undefined): "app" | "telemetry" | "vendor";
export declare function classifyFailedResponse(a: { url: string | null | undefined; status: number }): "app" | "telemetry" | "vendor-5xx";
export declare function classifyConsoleError(a: { text: string; locationUrl?: string | null }): "app" | "telemetry" | "vendor-5xx";
export declare const OWN_FIXTURE_MARKER: string;
export declare const FOREIGN_FIXTURE_MARKER: string;
export declare const FOREIGN_FIXTURE_SKIP: string;
export declare function isForeignSweepFixture(chain: readonly string[] | null | undefined): boolean;
export declare function clickFailureReason(message: string | null | undefined): string;
export declare function jwtExpiryMs(token: string | null | undefined): number | null;
export declare const TOKEN_REFRESH_MARGIN_MS: number;
export declare function tokenNeedsRefresh(token: string | null | undefined, now?: number, marginMs?: number): boolean;
export declare function refusalIsDeath(token: string | null | undefined, now?: number): boolean;
export declare const NOT_REACHED_STATUS: string;
export declare function overTimeBudget(a: { startedAt: number; now?: number; budgetMs: number }): boolean;
export declare function ceilingWaitMs(a: { minutes: Record<number | string, number> | null | undefined; now?: number; ceiling: number; burst: number }): number;
export declare const MIN_CYCLE_BURST: number;
export declare const CHROME_SKIP: string;
export declare function chromeKey(a: { persona: string; chain: readonly string[] | null | undefined; sig: string | null | undefined }): string;
export declare function chromeDisposition(a: { fromChrome: boolean; depth: number; key: string; passedOn: Map<string, string> }): string | null;
export declare function landingSettled(samples: readonly { t: number; url: string }[], quietMs: number): boolean;
export declare const LANDING_QUIET_MS: number;
export declare function rowDetailLines(a: {
  route: string;
  persona: string;
  controls: readonly { chain?: readonly string[]; result?: string; why?: string }[];
  documented: ReadonlySet<string>;
  max?: number;
}): string[];
export declare const RECENT_CYCLES: number;
export declare const PACE_HEADROOM: number;
export declare function cycleBurstEstimate(recent: readonly number[] | null | undefined): number;
