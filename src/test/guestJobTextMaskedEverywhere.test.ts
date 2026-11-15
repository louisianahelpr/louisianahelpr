/**
 * F268a follow-up (lead 11-14, Builder 2): a signed-out visitor never reads a phone number, street address or email
 * typed into a job's free text. 20261112202620 masked open_jobs_browse.description; 20261114234033 masks the title,
 * special requirements and materials note too, the titles of every anon-callable function that hands out open
 * jobs, and adds emails to mask_guest_contact.
 *
 * CLASS CHECK, built from the migrations: every function whose effective (newest) definition reads public.jobs and
 * returns a job's title, and whose newest EXECUTE grant still reaches anon, must read the title through
 * mask_guest_contact for a caller with no session. A new anon-callable job reader that prints the raw title turns
 * this red. The definer view open_jobs_browse is checked field by field. The PGlite proof
 * src/test/pglite/guestsReadMaskedJobText.pglite.mjs runs the masks themselves.
 *
 * @mutate supabase/migrations/20261115064940_teaser_profile_instant_match_hide_blocked.sql | 'title', CASE WHEN (SELECT auth.uid()) IS NULL THEN public.mask_guest_contact(j.title) ELSE j.title END, | 'title', j.title,
 * @mutate supabase/migrations/20261114234033_guests_read_masked_job_text.sql |     CASE WHEN CURRENT_USER = 'anon'::name THEN public.mask_guest_contact(materials_note) ELSE materials_note END AS materials_note, |     materials_note,
 * @mutate supabase/migrations/20261114234033_guests_read_masked_job_text.sql |           '[email hidden]', 'g'), |           '', 'g'),
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const defs = effectiveDefs(MIG);

/** Whether anon holds EXECUTE on public.<fn> after every migration, replayed in order (GRANT/REVOKE by role name). */
function anonExecutes(): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const re = /\b(GRANT|REVOKE)\s+(?:ALL|EXECUTE)(?:\s+PRIVILEGES)?\s+ON\s+FUNCTION\s+(?:public\.)?"?(\w+)"?\s*\([^)]*\)\s+(TO|FROM)\s+([^;]+);/gi;
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
    for (const m of sql.matchAll(re)) {
      const roles = m[4].toLowerCase().split(",").map((r) => r.trim());
      // Only a statement naming anon moves anon's grant (REVOKE ... FROM PUBLIC leaves an explicit anon grant standing).
      if (roles.includes("anon")) out.set(m[2], m[1].toUpperCase() === "GRANT");
    }
  }
  return out;
}

describe("a guest never reads contact details typed into a job (F268a follow-up)", () => {
  const anon = anonExecutes();
  const readers = [...defs.entries()]
    .filter(([name]) => anon.get(name) === true)
    .map(([name, d]) => ({ name, file: d.file, body: blankSqlComments(d.stmt) }))
    .filter((d) => /\bpublic\.jobs\s+j\b/.test(d.body) && /\bj\.title\b/.test(d.body));

  it("finds the anon-callable functions that return a job's title (inventory floor)", () => {
    expect(readers.map((r) => r.name).sort()).toEqual(expect.arrayContaining(["get_open_jobs_for_map", "get_public_open_jobs", "get_ranked_open_jobs", "public_profile_by_handle"]));
    expect(readers.length).toBeGreaterThan(3);
  });

  it("each reads the title through mask_guest_contact for a caller with no session", () => {
    const raw = readers.filter((r) => {
      // ranked reads j.title into a CTE and masks the CTE's title on the way out.
      const masked = /auth\.uid\(\)\)?\s+IS\s+NULL\s+THEN\s+public\.mask_guest_contact\((?:j\.)?title\)/i.test(r.body);
      return !masked;
    });
    expect(raw.map((r) => `${r.name} (${r.file})`), "anon-callable job readers that hand a guest the raw title").toEqual([]);
  });

  it("open_jobs_browse masks every free-text field for anon", () => {
    let view = "";
    for (const f of files) {
      const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
      const at = sql.lastIndexOf("CREATE OR REPLACE VIEW public.open_jobs_browse");
      if (at >= 0) view = sql.slice(at, sql.indexOf(" FROM jobs", at));
    }
    expect(view.length).toBeGreaterThan(1000);
    for (const col of ["title", "description", "special_requirements", "materials_note"]) {
      expect(view, col).toContain(`CASE WHEN CURRENT_USER = 'anon'::name THEN public.mask_guest_contact(${col}) ELSE ${col} END AS ${col}`);
    }
  });

  it("mask_guest_contact masks emails, phones and street addresses", () => {
    const body = defs.get("mask_guest_contact")?.stmt ?? "";
    for (const token of ["[email hidden]", "[phone hidden]", "[address hidden]"]) expect(body).toContain(token);
  });
});
