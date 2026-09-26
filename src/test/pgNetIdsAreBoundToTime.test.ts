/**
 * CLASS GUARD: a pg_net id is never a key on its own.
 *
 * pg_net's response ids RESTARTED on prod on 2026-09-24 ~10:04Z (new ids ~1,450;
 * cron_run_log already held ids up to 62,593). cron_run_log's UNIQUE
 * (response_id) + ON CONFLICT DO NOTHING then dropped 90 of 91 cron runs in
 * three hours as "already logged" against 2026-09-16 rows, health-check read
 * "newest cron run is 189 min old", and edge-function-smoke went red
 * (ledger d2074c4a) while pg_cron ran 120 jobs an hour. The failure sweep's
 * alert dedupe and catch-up join keyed on the id alone the same way.
 *
 * THE CLASS, from the migrations: every function whose EFFECTIVE definition
 * (effectiveFunctionDefs, rewrites applied) reads net._http_response. Each
 * equality on that response's `.id` must be bound to time by a `.created`
 * comparison in the same clause. Behaviour, red on the state before (5 checks):
 * src/test/pglite/cronLogSurvivesIdReuse.pglite.mjs.
 */
// @mutate supabase/migrations/20260924132850_cron_log_keys_survive_pg_net_id_reuse.sql |                 AND e.created_at >= resp.created) |                 )
// @mutate supabase/migrations/20260925231818_cron_work_visibility.sql |       JOIN net._http_response resp ON resp.id = l.response_id AND resp.created = l.occurred_at |       JOIN net._http_response resp ON resp.id = l.response_id
// @mutate supabase/migrations/20260925231818_cron_work_visibility.sql |   ON CONFLICT (response_id, occurred_at) DO NOTHING; |   ON CONFLICT (response_id) DO NOTHING;
// @mutate supabase/migrations/20260924132850_cron_log_keys_survive_pg_net_id_reuse.sql |   ON public.cron_run_log (response_id, occurred_at); |   ON public.cron_run_log (response_id);
// @mutate supabase/migrations/20260924132850_cron_log_keys_survive_pg_net_id_reuse.sql |                                        AND r.created BETWEEN e.created_at - interval '5 minutes' |                                        AND e.created BETWEEN e.created_at - interval '5 minutes'
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = join(__dirname, "..", "..", "supabase", "migrations");

describe("pg_net ids are bound to time", () => {
  const readers = [...effectiveDefs(DIR)].filter(([, d]) => /net\._http_response/i.test(d.stmt));

  it("every id join on net._http_response also compares its created time", () => {
    const joins: string[] = [];
    const unbound: string[] = [];
    for (const [name, d] of readers) {
      const sql = blankSqlComments(d.stmt);
      const aliases = [...sql.matchAll(/net\._http_response\s+(?:AS\s+)?(\w+)/gi)].map((m) => m[1]);
      for (const a of new Set(aliases)) {
        const eq = new RegExp(`(?:\\b${a}\\.id\\s*(?:::text\\s*)?=|=\\s*${a}\\.id\\b)`, "gi");
        for (const m of sql.matchAll(eq)) {
          const clause = sql.slice(m.index!, m.index! + 160);
          joins.push(`${name}:${a}`);
          if (!new RegExp(`\\b${a}\\.created\\b`, "i").test(clause)) unbound.push(`${name} (${d.file}): ${clause.split("\n")[0].trim()}`);
        }
      }
    }
    expect(readers.length).toBeGreaterThan(1);
    expect(joins.length).toBeGreaterThan(3);
    expect(unbound).toEqual([]);
  });

  it("cron_run_log is unique on (response_id, occurred_at), never response_id alone", () => {
    const files = migrationFiles(DIR);
    let unique = "";
    for (const f of files) {
      const sql = blankSqlComments(readFileSync(join(DIR, f), "utf8"));
      for (const m of sql.matchAll(/CREATE\s+UNIQUE\s+INDEX[^;]*ON\s+public\.cron_run_log\s*\(([^)]*)\)/gi)) unique = m[1].replace(/\s+/g, "");
    }
    expect(unique).toBe("response_id,occurred_at");
    const silent = blankSqlComments(effectiveDefs(DIR).get("sweep_silent_cron_failures")!.stmt);
    expect(silent).toMatch(/ON CONFLICT \(response_id, occurred_at\) DO NOTHING/);
  });
});
