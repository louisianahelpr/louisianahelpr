/**
 * The ONE place a Management API log query URL is built.
 *
 * Supabase removed the Management API "logs.all" endpoint
 * (410, changelog 48235); prod-errors went red on it 2026-09-24 12:55Z
 * (run 36002140320, ledger 7cba5a56). Its replacement is
 * /analytics/endpoints/logs with the same sql and iso_timestamp_* params, but
 * the SQL is ClickHouse over ONE `logs` table: filter `source = 'postgres_logs'`
 * (not `from postgres_logs`), read nested fields as log_attributes['a.b'].
 * The old table names answer "Table postgres_logs does not exist" (run 36006924856).
 * Guard: src/test/logsQueryUsesLiveEndpoint.test.ts.
 */
export function logsQueryUrl({ ref, sql, start, end, base = "https://api.supabase.com" }) {
  return `${base}/v1/projects/${ref}/analytics/endpoints/logs?sql=${encodeURIComponent(sql)}`
    + `&iso_timestamp_start=${encodeURIComponent(start)}&iso_timestamp_end=${encodeURIComponent(end)}`;
}
