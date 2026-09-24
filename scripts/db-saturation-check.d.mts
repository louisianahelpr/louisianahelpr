/**
 * Types for scripts/db-saturation-check.mjs, so
 * src/test/dbSaturationMonitor.test.ts can import its parser. Same pattern as
 * scripts/check-migration-relation-grants.d.mts.
 */
/** The statement-timeout count out of a Management API logs response; throws on anything unreadable. */
export function countFromLogsBody(body: unknown): number;
