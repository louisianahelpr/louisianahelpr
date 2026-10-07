/**
 * Q1461 (owner, 2026-10-06): the poster's Access & Parking notes (gate codes,
 * which door, where the key is) reach ONLY the poster and the booked
 * Helpr(s). Materials are public.
 *
 * THE CLASS. Both notes used to sit in jobs.special_requirements, which
 * open_jobs_browse handed to anon and to every signed-in browser while no
 * Helpr was ever shown them. 20261006204113 moved the access half to
 * public.job_access_notes (RLS: poster + booked Helprs), the materials half to
 * jobs.materials_note, and retired special_requirements with a CHECK.
 *
 * Pinned here, from the migrations (newest definition of each object) and the
 * client source:
 *   - no browse surface (open_jobs_browse and the three browse RPCs, plus
 *     every view the migrations define) reads job_access_notes, and the four
 *     browse surfaces are all found (floor);
 *   - job_access_notes: RLS on, nothing granted to anon, the one SELECT policy
 *     is TO authenticated through can_read_job_access_notes, and that
 *     function admits exactly the poster, the job's Helpr, the series' Helpr
 *     and the crew roster (no pending offer, no applicant);
 *   - jobs.special_requirements can hold no text (CHECK) and no client
 *     write sends it;
 *   - client code reads job_access_notes only through the two modules that
 *     own it (useJobAccessNote, jobAccessNotes).
 * Behaviour on a real Postgres (RLS by role, 3x replay, red on main):
 * src/test/pglite/jobAccessNotes.pglite.mjs. Live: the
 * scripts/check-job-access-notes-live.mjs read of prod's catalog.
 *
 * @mutate supabase/migrations/20261007062739_open_jobs_browse_seed_switch_plus_materials_note.sql |     materials_note\n   FROM jobs |     materials_note,\n    (SELECT n.notes FROM public.job_access_notes n WHERE n.job_id = jobs.id) AS access_notes\n   FROM jobs
 * @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql | CREATE POLICY "Poster and booked Helprs read access notes" ON public.job_access_notes\n  FOR SELECT TO authenticated | CREATE POLICY "Poster and booked Helprs read access notes" ON public.job_access_notes\n  FOR SELECT TO anon, authenticated
 * @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql |          OR public.can_read_job_access_notes(job_id)); |          OR true);
 * @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql | GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_access_notes TO authenticated; | GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_access_notes TO anon, authenticated;
 * @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql | ALTER TABLE public.job_access_notes ENABLE ROW LEVEL SECURITY; | SELECT 1;
 * @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql | OR j.recurring_helper_id = auth.uid()\n                     OR EXISTS (SELECT 1 FROM public.group_job_helpers g | OR j.recurring_helper_id = auth.uid()\n                     OR EXISTS (SELECT 1 FROM public.applications a WHERE a.job_id = _job_id AND a.helper_id = auth.uid())\n                     OR EXISTS (SELECT 1 FROM public.group_job_helpers g
 * @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql |             OR (j.status::text NOT IN ('completed', 'cancelled')\n                AND (j.helper_id | OR (true\n                AND (j.helper_id
 * @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql |   USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role)); |   USING (true);
 * @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql |       CHECK (special_requirements IS NULL); |       CHECK (true);
 * @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql |   DELETE FROM public.job_access_notes n\n   WHERE n.job_id IN (SELECT j.id FROM public.jobs j WHERE j.customer_id = p_user_id); |   PERFORM 1;
 * @mutate supabase/migrations/20261006204113_job_materials_and_access_notes.sql |            materials_note       = NULL -- Q1461 |            title = title -- Q1461
 * @mutate src/pages/post-job/jobSubmitHelpers.ts |     ...(materialsNote?.trim() ? { materials_note: materialsNote.trim() } : {}), |     special_requirements: materialsNote,
 * @mutate src/hooks/useDashboardData.ts |           .from("open_jobs_browse") |           .from("job_access_notes")
 */
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { walkSource, readSource } from "./helpers/walkSource";

const REPO = resolve(__dirname, "..", "..");
const MIG = join(REPO, "supabase", "migrations");
const DEFS = effectiveDefs(MIG);
const sqlOf = (f: string) => blankSqlComments(readFileSync(join(MIG, f), "utf8"));
const FILES = migrationFiles(MIG).map((f) => f.split("/").pop()!).sort();

/** The newest CREATE [OR REPLACE] VIEW public.<name> body in the migrations, per view name. */
function newestViews(): Map<string, { file: string; body: string }> {
  const out = new Map<string, { file: string; body: string }>();
  for (const f of FILES) {
    const sql = sqlOf(f);
    for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+public\.(\w+)/gi)) {
      // A view statement ends at the first `;` or the closing `$v$`-style tag, whichever comes first.
      const rest = sql.slice(m.index!);
      const end = Math.min(...[rest.indexOf(";"), rest.search(/\$\w*\$/)].filter((i) => i > 0));
      out.set(m[1], { file: f, body: rest.slice(0, end) });
    }
  }
  return out;
}

const NEWEST_TABLE_FILE = FILES.filter((f) => /CREATE TABLE IF NOT EXISTS public\.job_access_notes/.test(sqlOf(f))).pop()!;
const TABLE_SQL = sqlOf(NEWEST_TABLE_FILE ?? FILES[0]);

describe("Q1461: no browse surface carries the access notes", () => {
  const views = newestViews();
  const BROWSE_FNS = ["get_ranked_open_jobs", "get_open_jobs_for_map", "get_public_open_jobs"];

  it("finds every browse surface (floor) and none of them reads job_access_notes", () => {
    const browse = views.get("open_jobs_browse");
    expect(browse, "open_jobs_browse has no definition in the migrations").toBeTruthy();
    const surfaces: [string, string][] = [["view open_jobs_browse", browse!.body]];
    for (const fn of BROWSE_FNS) {
      const d = DEFS.get(fn);
      expect(d, `${fn}: no definition in the migrations`).toBeTruthy();
      surfaces.push([`function ${fn}`, blankSqlComments(d!.stmt)]);
    }
    expect(surfaces.length).toBeGreaterThanOrEqual(4);
    expect(surfaces.filter(([, body]) => /job_access_notes/i.test(body)).map(([n]) => n)).toEqual([]);
  });

  it("no view the migrations define reads job_access_notes", () => {
    expect(views.size, "the view walk found too few views").toBeGreaterThan(3);
    expect([...views].filter(([, v]) => /job_access_notes/i.test(v.body)).map(([n, v]) => `${n} (${v.file})`)).toEqual([]);
  });

  it("open_jobs_browse projects materials_note (public by owner decision) and stays a definer view", () => {
    const browse = views.get("open_jobs_browse")!;
    expect(browse.body).toMatch(/\bmaterials_note\s*$/m);
    expect(browse.body).toMatch(/security_invoker\s*=\s*false/i);
  });
});

describe("Q1461: job_access_notes is the poster's and the booked Helpr's only", () => {
  it("the table, RLS on, and nothing for anon", () => {
    expect(NEWEST_TABLE_FILE, "no migration creates public.job_access_notes").toBeTruthy();
    expect(TABLE_SQL).toContain("ALTER TABLE public.job_access_notes ENABLE ROW LEVEL SECURITY;");
    expect(TABLE_SQL).toContain("REVOKE ALL ON public.job_access_notes FROM PUBLIC, anon, authenticated;");
    const grants = [...TABLE_SQL.matchAll(/GRANT\s+[^;]*\s+ON\s+public\.job_access_notes\s+TO\s+([^;]+);/gi)].map((m) => m[1]);
    expect(grants.length).toBeGreaterThan(0);
    expect(grants.filter((to) => /\b(anon|public)\b/i.test(to))).toEqual([]);
  });

  it("every policy is TO authenticated, and SELECT goes through can_read_job_access_notes", () => {
    const policies = [...TABLE_SQL.matchAll(/CREATE POLICY "([^"]+)" ON public\.job_access_notes\s+FOR (\w+) TO ([^\n]+)\n([^;]*);/g)];
    expect(policies.length).toBe(5);
    for (const [, name, , to] of policies) expect(to.trim(), name).toBe("authenticated");
    const select = policies.filter(([, , cmd]) => cmd === "SELECT");
    expect(select.length).toBe(2);
    // Owner answer 2: admins read; the second SELECT policy is exactly that.
    const admin = policies.find(([, name]) => name === "Admins read access notes");
    expect(admin?.[2]).toBe("SELECT");
    expect(admin?.[4].replace(/\s+/g, " ").trim()).toBe("USING (public.has_role((SELECT auth.uid()), 'admin'::public.app_role))");
    select.splice(select.indexOf(admin!), 1);
    // The poster, spelled out (the job_pets id match), or whoever the definer function admits.
    expect(select[0][4].replace(/\s+/g, " ").trim()).toBe(
      "USING (EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = job_access_notes.job_id AND j.customer_id = (SELECT auth.uid())) OR public.can_read_job_access_notes(job_id))",
    );
    for (const [, name, cmd, , body] of policies.filter(([, , c]) => c !== "SELECT")) {
      // Writes stay the poster's alone (admins read only).
      expect(body, `${name} (${cmd}) is not poster-only`).toMatch(/j\.customer_id = \(SELECT auth\.uid\(\)\)/);
    }
  });

  it("can_read_job_access_notes admits the poster, and the job's Helpr, the series' Helpr and the crew only while the job is live", () => {
    const fn = blankSqlComments(DEFS.get("can_read_job_access_notes")!.stmt);
    expect(fn).toMatch(/SECURITY DEFINER/);
    // No user argument: it can only answer about the caller.
    expect(fn).toMatch(/can_read_job_access_notes\(_job_id uuid\)/);
    for (const who of ["j.customer_id = auth.uid()", "j.helper_id = auth.uid()", "j.recurring_helper_id = auth.uid()", "g.helper_id = auth.uid()"]) {
      expect(fn, who).toContain(who);
    }
    // Owner answer 1: the Helpr side ends with the job; the poster side does not.
    const flat = fn.replace(/\s+/g, " ");
    expect(flat).toMatch(/j\.customer_id = auth\.uid\(\) OR \(j\.status::text NOT IN \('completed', 'cancelled'\) AND \(j\.helper_id = auth\.uid\(\)/);
    expect(flat.indexOf("g.helper_id = auth.uid()")).toBeGreaterThan(flat.indexOf("NOT IN ('completed', 'cancelled')"));
    // A pending direct offer or a mere application is not a booking.
    expect(fn).not.toMatch(/offered_to_helper_id|public\.applications/);
    expect(TABLE_SQL).toContain("REVOKE ALL ON FUNCTION public.can_read_job_access_notes(uuid) FROM PUBLIC, anon, authenticated;");
  });

  it("account deletion takes the poster's notes with the rest of their free text (newest purge_user_data)", () => {
    // The job outlives its poster (customer_id ON DELETE SET NULL, helper_id
    // kept): a gate code left behind stays readable by the Helpr forever.
    const purge = blankSqlComments(DEFS.get("purge_user_data")!.stmt);
    expect(purge).toMatch(/special_requirements = NULL,\s+materials_note\s+= NULL/);
    expect(purge).toMatch(/DELETE FROM public\.job_access_notes n\s+WHERE n\.job_id IN \(SELECT j\.id FROM public\.jobs j WHERE j\.customer_id = p_user_id\);/);
    expect(purge.indexOf("set_config('app.access_notes_server_write', '1', true)")).toBeLessThan(purge.indexOf("DELETE FROM public.job_access_notes"));
  });

  it("jobs.special_requirements can hold no text, and no client write sends it", () => {
    expect(TABLE_SQL).toMatch(/ADD CONSTRAINT jobs_special_requirements_retired\s+CHECK \(special_requirements IS NULL\);/);
    for (const f of ["src/pages/post-job/jobSubmitHelpers.ts", "src/pages/post-job/useJobSubmit.ts", "src/pages/posts/EditJobDialog.tsx"]) {
      expect(blankComments(readFileSync(join(REPO, f), "utf8")), f).not.toMatch(/\bspecial_requirements\s*:/);
    }
  });
});

describe("Q1461: client code reads job_access_notes only through its two owners", () => {
  const OWNERS = new Set([
    "src/hooks/useJobAccessNote.ts", // the read (RLS decides who gets a row)
    "src/lib/jobAccessNotes.ts", // the poster's write
    "src/integrations/supabase/types.ts", // generated types
  ]);
  const files = walkSource([join(REPO, "src")]).filter((f) => !/\.test\.tsx?$/.test(f) && !f.includes(`${join("src", "test")}/`));

  it("walks the client source (floor) and finds no other reader", () => {
    expect(files.length).toBeGreaterThan(500);
    const readers = files
      .filter((f) => /job_access_notes/.test(blankComments(readSource(f) ?? "")))
      .map((f) => relative(REPO, f));
    expect(readers.filter((f) => !OWNERS.has(f))).toEqual([]);
    expect(readers.filter((f) => f !== "src/integrations/supabase/types.ts").sort()).toEqual(["src/hooks/useJobAccessNote.ts", "src/lib/jobAccessNotes.ts"]);
  });
});
