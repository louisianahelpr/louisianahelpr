export type MeasuredResponse = { path: string; status: number; cacheControl: string };
export function cacheControlKeepsNothing(value: string | null | undefined): boolean;
export function judgeMissingAssetHeaders(input: { real: MeasuredResponse | null; missing: MeasuredResponse[] }): string[];
