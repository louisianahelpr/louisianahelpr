// Types for the page-settle measurement (e2e/prod-audit/page-settle.spec.ts).
export declare const SETTLE_INIT: (placeholderSel: string) => void;
/** A loading region: nothing inside it counts as a page item (SETTLE_INIT's countItems repeats it). */
export declare const SKELETON_SCOPE_SEL: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the result is a plain measurement record read field by field
export declare function settlePage(page: unknown, fullUrl: string, opts?: { quietMs?: number; maxMs?: number }): Promise<Record<string, any>>;
