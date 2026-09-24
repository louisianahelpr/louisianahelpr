/**
 * Every Management API log query goes through scripts/lib/supabaseLogs.mjs,
 * which targets the live /analytics/endpoints/logs path.
 *
 * Supabase removed /analytics/endpoints/logs.all (HTTP 410). prod-errors went
 * red on it 2026-09-24 12:55Z (run 36002140320, ledger 7cba5a56); the
 * scoreboard, SLO and quota readers used the same dead path. The class: any
 * script or workflow that builds an /analytics/endpoints/logs URL itself.
 */
// @mutate scripts/lib/supabaseLogs.mjs | /analytics/endpoints/logs?sql= | /analytics/endpoints/logs.all?sql=
// @mutate scripts/slo.mjs | from logs where source = 'edge_logs' | from edge_logs
// @mutate scripts/db-saturation-check.mjs | "select count(*) as n from logs where source = 'postgres_logs' and | "select count(*) as n from postgres_logs where
// @mutate scripts/db-saturation-check.mjs | const url = logsQueryUrl({ ref: REF, sql: TIMEOUT_LOG_SQL, start, end: new Date(now).toISOString() }); | const url = `https://api.supabase.com/v1/projects/${REF}/analytics/endpoints/logs.all?sql=${TIMEOUT_LOG_SQL}`;
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { logsQueryUrl } from "../../scripts/lib/supabaseLogs.mjs";

const ROOT = join(__dirname, "..", "..");
const HELPER = "scripts/lib/supabaseLogs.mjs";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === "node_modules" ? [] : walk(p);
    return /\.(m?js|ts|ya?ml|sh)$/.test(n) ? [p] : [];
  });
}

describe("Management API log queries use the live endpoint", () => {
  const files = [...walk(join(ROOT, "scripts")), ...walk(join(ROOT, ".github")), ...walk(join(ROOT, "supabase", "functions"))]
    .map((p) => ({ rel: p.slice(ROOT.length + 1), src: readFileSync(p, "utf8") }));

  it("the helper builds /analytics/endpoints/logs, never logs.all", () => {
    const url: string = logsQueryUrl({ ref: "abc", sql: "select 1", start: "2026-09-24T00:00:00Z", end: "2026-09-24T01:00:00Z" });
    expect(url).toMatch(/^https:\/\/api\.supabase\.com\/v1\/projects\/abc\/analytics\/endpoints\/logs\?sql=select%201&iso_timestamp_start=/);
  });

  it("no script, workflow or edge function names the removed logs.all path", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.filter((f) => /endpoints\/logs\.all/.test(f.src)).map((f) => f.rel)).toEqual([]);
  });

  it("every log reader goes through the helper instead of building the URL", () => {
    const readers = files.filter((f) => f.rel !== HELPER && /logsQueryUrl\(/.test(f.src));
    expect(readers.map((f) => f.rel).sort()).toEqual(
      ["scripts/check-quota-usage.mjs", "scripts/db-saturation-check.mjs", "scripts/scoreboard.mjs", "scripts/slo.mjs"],
    );
    expect(files.filter((f) => f.rel !== HELPER && /analytics\/endpoints\/logs\b/.test(f.src)).map((f) => f.rel)).toEqual([]);
  });

  it("log SQL reads the one ClickHouse `logs` table by source, never the old per-source tables", () => {
    // The new endpoint answers "Table postgres_logs does not exist" (run 36006924856).
    const old = /\bselect\b[^"`\n]*\bfrom\s+(edge_logs|postgres_logs|function_edge_logs|function_logs|auth_logs|postgrest_logs)\b/i;
    expect(files.filter((f) => old.test(f.src)).map((f) => f.rel)).toEqual([]);
    const readers = ["scripts/check-quota-usage.mjs", "scripts/db-saturation-check.mjs", "scripts/scoreboard.mjs", "scripts/slo.mjs"];
    for (const r of readers) expect(files.find((f) => f.rel === r)!.src, r).toMatch(/from logs where source = '\w+'/);
  });
});
