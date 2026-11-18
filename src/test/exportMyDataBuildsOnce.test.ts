/**
 * "Download my data" must build its document in batches, not by re-copying it once per section (docs/OPEN.md Q2805).
 *
 * export_my_data adds each section with `v_out := v_out || jsonb_build_object(...)`. jsonb `||` rebuilds the whole
 * left side, so 195 sections in one accumulator cost the square of the export's size: 13.1 s for the poster test
 * account (9.3 MB) on prod, 2026-11-17, past the REST API's 8 s cut. 20261118000812 moves the batch into v_done after
 * every 10 sections (`v_done := v_done || v_out; v_out := '{}'::jsonb;`) and merges v_done back before RETURN:
 * 1.26-1.29 s, identical output (md5 without exported_at).
 *
 * Judged on the NEWEST definition (every migration in timestamp order, any dollar-quote tag, comments blanked with
 * blankSqlComments): no run of more than MAX_RUN top-level section statements without a batch move, the batch is
 * merged back before RETURN, and (Q2805 done-when) no statement_timeout in the header: the call fits the REST cut on
 * its own.
 *
 * @mutate supabase/migrations/20261118000812_export_my_data_builds_once.sql |   v_done := v_done \|\| v_out; v_out := '{}'::jsonb;  -- batch 7 |   -- batch 7 removed
 * @mutate supabase/migrations/20261118000812_export_my_data_builds_once.sql |   v_out := v_done \|\| v_out; |   v_out := v_out;
 * @mutate supabase/migrations/20261118000812_export_my_data_builds_once.sql |   v_done  jsonb := '{}'::jsonb; |   v_done  jsonb;
 * @mutate supabase/migrations/20261118000812_export_my_data_builds_once.sql |  SET search_path TO 'public', 'pg_temp'\nAS $function$\nDECLARE\n  v_uid |  SET search_path TO 'public', 'pg_temp'\n SET statement_timeout TO '60s'\nAS $function$\nDECLARE\n  v_uid
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "@/test/helpers/blankNonCode";

const DIR = "supabase/migrations";
const MAX_RUN = 12;
const DEFINE_RX = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.export_my_data\s*\(\s*p_user_id\s+uuid\s*\)/gi;

type Def = { file: string; header: string; body: string };

/** Every definition of export_my_data(uuid), in rebuild order; the body is read up to its own closing tag. */
function definitions(files: { name: string; sql: string }[]): Def[] {
  const out: Def[] = [];
  for (const { name, sql } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const code = blankSqlComments(sql);
    for (const m of code.matchAll(DEFINE_RX)) {
      const rest = code.slice(m.index);
      const open = /\bAS\s+(\$[A-Za-z_]*\$)/i.exec(rest);
      if (!open) continue;
      const tag = open[1];
      const from = open.index + open[0].length;
      const to = rest.indexOf(tag, from);
      out.push({ file: name, header: rest.slice(0, open.index), body: rest.slice(from, to < 0 ? undefined : to) });
    }
  }
  return out;
}

/** The longest run of top-level section statements with no batch move between them. */
function longestRun(body: string): number {
  let run = 0;
  let max = 0;
  for (const line of body.split("\n")) {
    if (/^ {2}v_out\s*:=\s*v_out\s*\|\|\s*jsonb_build_object\(/.test(line)) { run++; max = Math.max(max, run); }
    if (/^ {2}v_done\s*:=\s*v_done\s*\|\|\s*v_out\s*;\s*v_out\s*:=\s*'\{\}'::jsonb\s*;/.test(line)) run = 0;
  }
  return max;
}

const mergesBack = (body: string) => /\bv_out\s*:=\s*v_done\s*\|\|\s*v_out\s*;\s*RETURN\s+v_out\s*;\s*END\s*;?\s*$/i.test(body.trim());

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).map((name) => ({ name, sql: readFileSync(`${DIR}/${name}`, "utf8") }));

describe("export_my_data builds its document in batches", () => {
  const defs = definitions(files);
  const newest = defs[defs.length - 1];
  const sections = (newest?.body.match(/^ {2}v_out\s*:=\s*v_out\s*\|\|\s*jsonb_build_object\(/gm) ?? []).length;

  it("the newest definition moves each batch of sections out of the accumulator", () => {
    // Inventory floors: redefined many times; the export has well over 150 top-level sections.
    expect(defs.length).toBeGreaterThan(10);
    expect(sections).toBeGreaterThan(150);
    expect(longestRun(newest.body), `${newest.file}: a run of sections with no batch move`).toBeLessThanOrEqual(MAX_RUN);
    expect(mergesBack(newest.body), `${newest.file}: v_done is not merged back before RETURN`).toBe(true);
    // A NULL start would make the first `v_done || v_out` NULL, and the whole export with it.
    expect(newest.body).toMatch(/\bv_done\s+jsonb\s*:=\s*'\{\}'::jsonb\s*;/);
  });

  it("the newest definition carries no statement_timeout (it fits the REST cut on its own)", () => {
    expect(newest.header).not.toMatch(/\bstatement_timeout\b/i);
    const later = files.filter((f) => f.name > newest.file).map((f) => blankSqlComments(f.sql)).join("\n");
    expect(later).not.toMatch(/ALTER\s+FUNCTION\s+public\.export_my_data[\s\S]{0,40}SET\s+statement_timeout/i);
  });

  it("the judge fails the old one-accumulator shape and passes the batched one", () => {
    const old = defs.find((d) => d.file.startsWith("20261112081700"));
    expect(old && longestRun(old.body)).toBeGreaterThan(MAX_RUN);
    expect(old && mergesBack(old.body)).toBe(false);
  });
});
