/**
 * The ONE place a Management API log query URL is built.
 *
 * Supabase removed the Management API "logs.all" endpoint
 * (410, changelog 48235); prod-errors went red on it 2026-09-24 12:55Z
 * (run 36002140320, ledger 7cba5a56). Its replacement is
 * /analytics/endpoints/logs with the same sql and iso_timestamp_* params.
 * Guard: src/test/logsQueryUsesLiveEndpoint.test.ts.
 */
export function logsQueryUrl({ ref, sql, start, end, base = "https://api.supabase.com" }) {
  return `${base}/v1/projects/${ref}/analytics/endpoints/logs?sql=${encodeURIComponent(sql)}`
    + `&iso_timestamp_start=${encodeURIComponent(start)}&iso_timestamp_end=${encodeURIComponent(end)}`;
}
