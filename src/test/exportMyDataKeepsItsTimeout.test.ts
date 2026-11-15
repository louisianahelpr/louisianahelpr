/**
 * "Download my data" must not hit the REST API's 8 s cut (press-every-control 43007456468 / 43584967592: export-my-data
 * 500, "57014 canceling statement due to statement timeout"; export_my_data measured 12-13 s on prod for the poster
 * account, 2026-11-14). 20261115014233 gives the function its own statement_timeout (60 s), which the REST API
 * applies to the call. CREATE OR REPLACE drops a function's SET clauses, so the NEWEST definition of export_my_data
 * must carry `SET statement_timeout` in its header, or a later migration must set it again with ALTER FUNCTION.
 *
 * Reads every migration in timestamp order (comments blanked with blankSqlComments), any dollar-quote tag, and judges
 * the newest definition.
 *
 * @mutate supabase/migrations/20261115014233_export_my_data_timeout.sql |     ALTER FUNCTION public.export_my_data(uuid) SET statement_timeout TO '60s'; |     ALTER FUNCTION public.export_my_data(uuid) SET search_path TO 'public', 'pg_temp';
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "@/test/helpers/blankNonCode";

const DIR = "supabase/migrations";
type Event = { file: string; kind: "define" | "set"; carriesTimeout: boolean };

const DEFINE_RX = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.export_my_data\s*\(/gi;
const SET_RX = /ALTER\s+FUNCTION\s+public\.export_my_data\s*\(\s*uuid\s*\)\s+SET\s+statement_timeout\b/gi;

/** Every define / set of export_my_data, in the order a rebuild runs them. */
function exportTimeoutEvents(files: { name: string; sql: string }[]): Event[] {
  const out: Event[] = [];
  for (const { name, sql } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const code = blankSqlComments(sql);
    const found: { at: number; ev: Event }[] = [];
    for (const m of code.matchAll(DEFINE_RX)) {
      // The header runs from CREATE to the body's opening dollar tag (any tag).
      const rest = code.slice(m.index);
      const body = /\bAS\s+\$[A-Za-z_]*\$/i.exec(rest);
      const header = body ? rest.slice(0, body.index) : rest;
      found.push({ at: m.index ?? 0, ev: { file: name, kind: "define", carriesTimeout: /\bSET\s+statement_timeout\b/i.test(header) } });
    }
    for (const m of code.matchAll(SET_RX)) found.push({ at: m.index ?? 0, ev: { file: name, kind: "set", carriesTimeout: true } });
    out.push(...found.sort((a, b) => a.at - b.at).map((f) => f.ev));
  }
  return out;
}

/** Does the function, as a rebuild leaves it, carry its statement_timeout? */
function newestKeepsTimeout(events: Event[]): boolean {
  const lastDefine = events.map((e) => e.kind).lastIndexOf("define");
  if (lastDefine < 0) return false;
  return events.slice(lastDefine).some((e) => e.carriesTimeout);
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).map((name) => ({ name, sql: readFileSync(`${DIR}/${name}`, "utf8") }));

describe("export_my_data keeps its own statement_timeout", () => {
  it("the definition a rebuild ends with carries it", () => {
    const events = exportTimeoutEvents(files);
    // Inventory floor: export_my_data was redefined many times before this landed.
    expect(events.filter((e) => e.kind === "define").length).toBeGreaterThan(10);
    expect(newestKeepsTimeout(events), `newest export_my_data has no statement_timeout: ${JSON.stringify(events.slice(-3))}`).toBe(true);
  });

  it("a newer CREATE OR REPLACE without it fails, one with it passes", () => {
    const head = (set: string) => `CREATE OR REPLACE FUNCTION public.export_my_data(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' ${set}
AS $fn$ BEGIN RETURN '{}'::jsonb; END $fn$;`;
    const plain = [...files, { name: "29991231000000_later.sql", sql: head("") }];
    expect(newestKeepsTimeout(exportTimeoutEvents(plain))).toBe(false);
    const kept = [...files, { name: "29991231000000_later.sql", sql: head("SET statement_timeout TO '60s'") }];
    expect(newestKeepsTimeout(exportTimeoutEvents(kept))).toBe(true);
    const commented = [...files, { name: "29991231000000_later.sql", sql: `${head("")}\n-- ALTER FUNCTION public.export_my_data(uuid) SET statement_timeout TO '60s';` }];
    expect(newestKeepsTimeout(exportTimeoutEvents(commented))).toBe(false);
  });
});
