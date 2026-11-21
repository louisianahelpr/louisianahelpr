/** Types for src/lib/holidayHubSeo.mjs (api/share.ts's Holiday Hub bodies and JSON-LD). */
export function holidayHubBody(path: string, today: string): string | null;
export function holidayLightsItemListLd(today: string): Record<string, unknown>;
export function holidayEventsLd(today: string): Record<string, unknown>[];
export function holidayHubLd(path: string, today: string): Record<string, unknown>[] | null;
