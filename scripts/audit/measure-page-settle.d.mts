// Types for the page-settle measurement (e2e/prod-audit/page-settle.spec.ts).
export declare const SETTLE_INIT: (placeholderSel: string) => void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the result is a plain measurement record read field by field
export declare function settlePage(page: unknown, fullUrl: string, opts?: { quietMs?: number; maxMs?: number }): Promise<Record<string, any>>;
