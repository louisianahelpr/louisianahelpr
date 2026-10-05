/**
 * Q1165: a Helpr's answer to a withdrawn dispute survived the re-file. Nothing
 * cleared jobs.dispute_helper_response, so the old answer rendered under the
 * new complaint, and since 20261003180355 the answer is write-once, so the
 * Helpr could never answer the new one. open_dispute_as's NEW-dispute UPDATE
 * now clears it.
 *
 * Executable proof: src/test/pglite/refileClearsHelprAnswer.pglite.mjs (open,
 * answer, withdraw, re-file: the answer is NULL and the next answer lands; RED
 * with NEW_MIGRATION=skip). This file pins the shape of the NEWEST definition
 * so a later migration cannot restate open_dispute_as without the clear.
 *
 * @mutate supabase/migrations/20261005064816_dispute_refile_keeps_helpr_answer.sql | dispute_helper_response = NULL, | dispute_reason = _reason,
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

/** The newest CREATE OR REPLACE FUNCTION public.<name>( in the migrations, comments blanked. */
function newestFunction(name: string): { file: string; sql: string } {
  const header = `CREATE OR REPLACE FUNCTION public.${name}(`;
  for (let i = files.length - 1; i >= 0; i--) {
    const sql = blankSqlComments(readFileSync(`${dir}/${files[i]}`, "utf8"));
    const at = sql.lastIndexOf(header);
    if (at < 0) continue;
    const tag = /AS\s+(\$[A-Za-z_]*\$)/.exec(sql.slice(at))?.[1];
    if (!tag) throw new Error(`${name}: no dollar-quote tag in ${files[i]}`);
    const open = sql.indexOf(tag, at);
    return { file: files[i], sql: sql.slice(at, sql.indexOf(tag, open + tag.length) + tag.length) };
  }
  throw new Error(`${name}: not found`);
}

describe("a re-filed dispute starts with no Helpr answer (Q1165)", () => {
  const def = newestFunction("open_dispute_as");

  it("inventory: the newest open_dispute_as is SECURITY DEFINER and found", () => {
    expect(def.file.length).toBeGreaterThan(0);
    expect(def.sql).toMatch(/SECURITY DEFINER/);
  });

  it("the new-dispute UPDATE of jobs clears dispute_helper_response", () => {
    const insert = def.sql.indexOf("INSERT INTO public.disputes (job_id, opener_id, reason, evidence_urls)");
    expect(insert).toBeGreaterThan(0);
    const update = def.sql.indexOf("UPDATE public.jobs", insert);
    expect(update).toBeGreaterThan(insert);
    const stmt = def.sql.slice(update, def.sql.indexOf("WHERE id = _job_id", update));
    expect(stmt).toMatch(/dispute_reason = _reason,/);
    expect(stmt).toMatch(/dispute_helper_response = NULL,/);
  });

  it("the open-dispute branch (evidence append) does not clear an answer that belongs to the still-open dispute", () => {
    // The still-open branch ends at its RETURN (Q1262 archives the previous
    // dispute's answer on the NEW path, after it, by reading the column).
    const end = def.sql.indexOf("RETURN _existing_id;");
    expect(end).toBeGreaterThan(0);
    const branch = def.sql.slice(0, end);
    expect(branch).not.toMatch(/dispute_helper_response/);
  });

  it("the grants survive the restatement: service_role only", () => {
    const all = files.map((f) => blankSqlComments(readFileSync(`${dir}/${f}`, "utf8"))).join("\n");
    expect(all).toContain("REVOKE ALL ON FUNCTION public.open_dispute_as(uuid, uuid, text, text[]) FROM PUBLIC, anon, authenticated;");
    const probe = readFileSync("src/test/pglite/refileClearsHelprAnswer.pglite.mjs", "utf8");
    expect(probe).toContain("20261004004705_refile_clears_helpr_dispute_answer.sql");
    expect(probe).toContain("NEW_MIGRATION");
  });
});
