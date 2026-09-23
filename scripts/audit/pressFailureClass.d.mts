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
export declare const SENTRY_INGEST_RX: RegExp;
export declare function answerSentryLocally(ctx: { route: (pattern: RegExp, handler: (r: { fulfill: (o: { status: number; contentType?: string; body?: string }) => Promise<void> }) => unknown) => Promise<void> }): Promise<RegExp>;
