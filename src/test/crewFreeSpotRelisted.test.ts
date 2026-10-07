import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { resolve } from "node:path";

import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/**
 * Q1409 (docs/OPEN.md; owner decision 2026-10-05 ~21:45 CT): a booked crew's
 * free spot is RE-LISTED until its start, so new Helprs can apply.
 *
 * THE CLASS: a place that decides "is this job taking applicants" by
 * `status = 'open'` alone. A booked crew a member left (Q1378) is 'accepted',
 * so every such place hid its free spot: the four browse surfaces, the apply
 * RPC and the application-insert gate, and the applicant's own list.
 *
 * One rule, public.crew_spots_open(job), and every one of those places reads
 * it. The inventory is EXACT and two-way, read from the effective definitions:
 * every function that applies the early-access clock (the discovery surfaces
 * and the insert gate) plus the apply RPC and the applicant's list.
 *
 * Behaviour: src/test/pglite/crewFreeSpotRelisted.pglite.mjs (5 checks RED on
 * the old surfaces with --before, all green after, migration applied 3x).
 */

// @mutate supabase/migrations/20261006023437_crew_free_spot_relisted.sql |                  AND public.job_offer_cutoff(j.date_needed, j.start_time) > now() + interval '15 minutes') |                  )
// @mutate supabase/migrations/20261006023437_crew_free_spot_relisted.sql |            WHEN j.is_group_job IS NOT TRUE OR j.parent_job_id IS NOT NULL THEN 0 |            WHEN j.is_group_job IS NOT TRUE THEN 0
// @mutate supabase/migrations/20261006023437_crew_free_spot_relisted.sql |   IF v_status != 'open' AND NOT (v_status = 'accepted' AND COALESCE(public.crew_spots_open(p_job_id), 0) > 0) THEN |   IF v_status != 'open' THEN
// @mutate supabase/migrations/20261007033530_seed_switch_hides_test_profiles.sql |      AND NOT (v_job.status = 'accepted' AND COALESCE(public.crew_spots_open(NEW.job_id), 0) > 0) THEN |      THEN
// @mutate supabase/migrations/20261006023437_crew_free_spot_relisted.sql |           OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0)\n | \n
// @mutate supabase/migrations/20261006031016_crew_spots_open_not_client_callable.sql | GRANT EXECUTE ON FUNCTION public.crew_spots_open(uuid) TO service_role; | GRANT EXECUTE ON FUNCTION public.crew_spots_open(uuid) TO anon, authenticated, service_role;
// @mutate supabase/migrations/20261007062739_open_jobs_browse_seed_switch_plus_materials_note.sql | WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id)) ELSE 0 END) > 0)) | WHEN is_group_job IS NOT TRUE THEN 0 WHEN status = 'open'::job_status OR status = 'accepted'::job_status THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id)) ELSE 0 END) > 0))

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const EFFECTIVE = effectiveDefs(MIGRATIONS);
const body = (name: string) => blankSqlComments(EFFECTIVE.get(name)?.stmt ?? "");
const THIS = "20261006023437_crew_free_spot_relisted.sql";
/** lh-authz-rls review of c5785c40d: crew_spots_open is not client-callable; the view counts inline. */
const PRIVATE = "20261006031016_crew_spots_open_not_client_callable.sql";
/** Q1411 restated the same five on the crew-era bodies, plus its hide clause (banReviewHidesPostsOnCrewSurfaces.test.ts). */
const RESTATED = "20261006042617_ban_review_hides_posts_on_crew_surfaces.sql";
// Q552 restates the same bodies again, swapping only the seed-switch call (test accounts keep test jobs).
const SEED_SWITCH = "20261007033530_seed_switch_hides_test_profiles.sql";
const RELISTED = "(j.status = 'open' OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0))";

/** Every place that decides whether a job takes applicants, and how it must read the rule. */
const TAKES_APPLICANTS: Record<string, string> = {
  get_ranked_open_jobs: `WHERE ${RELISTED}`,
  get_open_jobs_for_map: `WHERE ${RELISTED}`,
  get_public_open_jobs: `WHERE ${RELISTED}`,
  enforce_application_job_state: "AND NOT (v_job.status = 'accepted' AND COALESCE(public.crew_spots_open(NEW.job_id), 0) > 0) THEN",
  apply_to_job: "IF v_status != 'open' AND NOT (v_status = 'accepted' AND COALESCE(public.crew_spots_open(p_job_id), 0) > 0) THEN",
  get_jobs_for_my_applications: "OR (j.status = 'accepted' AND j.is_group_job IS TRUE AND public.crew_spots_open(j.id) > 0)",
};

describe("Q1409: a booked crew's free spot is re-listed until its start", () => {
  it("every discovery surface and the insert gate is in the inventory (exact, two-way)", () => {
    const clock = [...EFFECTIVE.keys()]
      .filter((n) => n !== "early_access_cutoff" && /\bearly_access_cutoff\s*\(\)/.test(body(n)))
      .sort();
    expect(clock.length, "the inventory read nothing: the parser is broken").toBeGreaterThan(3);
    expect(clock, "a new place applies the browse clock: decide whether it lists a booked crew's free spot").toEqual(
      Object.keys(TAKES_APPLICANTS).filter((n) => !["apply_to_job", "get_jobs_for_my_applications"].includes(n)).sort(),
    );
  });

  it.each(Object.entries(TAKES_APPLICANTS))("%s reads crew_spots_open", (fn, rule) => {
    expect([THIS, RESTATED, SEED_SWITCH], `${fn} is not the Q1409 definition or its Q1411/Q552 restatement`).toContain(EFFECTIVE.get(fn)?.file);
    expect(body(fn).replace(/\s+/g, " ")).toContain(rule.replace(/\s+/g, " "));
  });

  it("crew_spots_open: a staffing crew's empty spots; a booked crew's until 15 minutes before its start; else 0", () => {
    const fn = body("crew_spots_open");
    expect(EFFECTIVE.get("crew_spots_open")?.file).toBe(THIS);
    expect(fn).toMatch(/SECURITY DEFINER\s+SET search_path TO 'public'/);
    expect(fn).toMatch(/WHEN j\.is_group_job IS NOT TRUE OR j\.parent_job_id IS NOT NULL THEN 0/);
    expect(fn).toMatch(/j\.status::text = 'accepted'\s+AND public\.job_offer_cutoff\(j\.date_needed, j\.start_time\) > now\(\) \+ interval '15 minutes'/);
    expect(fn).toMatch(/GREATEST\(0, COALESCE\(j\.helpers_needed, 1\)\s+- \(SELECT count\(\*\)::int FROM public\.group_job_helpers g WHERE g\.job_id = j\.id\)\)/);
    // A count only: it never returns who is on the roster.
    expect(fn).not.toMatch(/helper_id/);
    // Not client-callable (lh-authz-rls review of c5785c40d): it carries none of
    // the browse exclusions, so it must never answer for an arbitrary job id.
    // The NEWEST grant statement on it, across the ledger, is service_role only.
    const grants = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()
      .flatMap((f) => blankSqlComments(readFileSync(resolve(MIGRATIONS, f), "utf8")).match(/GRANT EXECUTE ON FUNCTION public\.crew_spots_open\(uuid\) TO [^;]*;/g) ?? []);
    expect(grants.pop()).toBe("GRANT EXECUTE ON FUNCTION public.crew_spots_open(uuid) TO service_role;");
    const priv = blankSqlComments(readFileSync(resolve(MIGRATIONS, PRIVATE), "utf8"));
    expect(priv).toContain("REVOKE ALL ON FUNCTION public.crew_spots_open(uuid) FROM PUBLIC, anon, authenticated;");
    const allow = JSON.parse(readFileSync(resolve(ROOT, "scripts/ci/definer-exec-allowlist.json"), "utf8"));
    for (const s of ["anon", "authenticated", "unscoped"]) expect(allow[s]["crew_spots_open(uuid)"], `allowlist ${s}`).toBeUndefined();
    // Every remaining caller runs it as its owner.
    for (const caller of Object.keys(TAKES_APPLICANTS)) expect(body(caller), `${caller} must be SECURITY DEFINER to call it`).toMatch(/SECURITY DEFINER/);
  });

  it("open_jobs_browse lists the re-listed spot, counts it INLINE (the same rule), and stays a definer view", () => {
    const newestView = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()
      .filter((f) => /CREATE OR REPLACE VIEW public\.open_jobs_browse/.test(blankSqlComments(readFileSync(resolve(MIGRATIONS, f), "utf8")))).pop();
    expect([PRIVATE, RESTATED, SEED_SWITCH, "20261007062739_open_jobs_browse_seed_switch_plus_materials_note.sql"]).toContain(newestView);
    const sql = readFileSync(resolve(MIGRATIONS, newestView as string), "utf8");
    const at = sql.indexOf("CREATE OR REPLACE VIEW public.open_jobs_browse");
    const view = blankSqlComments(sql.slice(at, sql.indexOf("$v$;", at)));
    expect(view).toMatch(/WITH \(security_invoker = false\)/);
    // The view calls no client-uncallable helper (a definer view checks function EXECUTE as the caller).
    expect(view).not.toMatch(/crew_spots_open\s*\(/);
    // crew_spots_open's rule, piece by piece, both in the column and in the row filter.
    const SPOTS = "(CASE WHEN is_group_job IS NOT TRUE OR parent_job_id IS NOT NULL THEN 0 WHEN status = 'open'::job_status OR (status = 'accepted'::job_status AND (CASE WHEN start_time IS NULL THEN ((date_needed + 1)::timestamp without time zone AT TIME ZONE 'America/Chicago') ELSE ((date_needed + start_time) AT TIME ZONE 'America/Chicago') END) > (now() + '00:15:00'::interval)) THEN GREATEST(0, COALESCE(helpers_needed, 1) - (SELECT count(*)::integer AS count FROM group_job_helpers g WHERE g.job_id = jobs.id)) ELSE 0 END)";
    expect(view).toContain(`WHEN is_group_job IS TRUE THEN ${SPOTS}`);
    expect(view).toContain(`WHERE (status = 'open'::job_status OR (status = 'accepted'::job_status AND is_group_job IS TRUE AND ${SPOTS} > 0)) AND parent_job_id IS NULL`);
    // ...and it is the function's rule: same exclusion, cutoff and count.
    const fn = body("crew_spots_open");
    expect(fn).toMatch(/j\.is_group_job IS NOT TRUE OR j\.parent_job_id IS NOT NULL THEN 0/);
    expect(fn).toMatch(/interval '15 minutes'/);
    expect(body("job_offer_cutoff")).toMatch(/WHEN p_start_time IS NULL THEN \(\(p_date_needed \+ 1\)::timestamp AT TIME ZONE 'America\/Chicago'\)\s+ELSE \(\(p_date_needed \+ p_start_time\)::timestamp AT TIME ZONE 'America\/Chicago'\)/);
  });

  it("the card says how many spots are open, read from the view after the main list (a missing column never breaks browse)", () => {
    const chip = blankComments(readFileSync(resolve(ROOT, "src/components/job-card/JobCardMetaRow.tsx"), "utf8"));
    expect(chip).toMatch(/spot\$\{open === 1 \? "" : "s"\} open/);
    const card = blankComments(readFileSync(resolve(ROOT, "src/components/dashboard/JobCard.tsx"), "utf8"));
    expect(card).toMatch(/<JobHelprsChip\s+helpersNeeded=\{job\.helpers_needed\}\s+spotsOpen=\{job\.crew_spots_open\}/);
    const helper = blankComments(readFileSync(resolve(ROOT, "src/lib/crewSpots.ts"), "utf8"));
    expect(helper).toMatch(/\.from\("open_jobs_browse"\)\s+\.select\("id, crew_spots_open"\)/);
    for (const f of ["src/hooks/useDashboardData.ts", "src/pages/home/fetchGuestJobs.ts"]) {
      const src = blankComments(readFileSync(resolve(ROOT, f), "utf8"));
      expect(src, `${f} does not read the open-spot counts`).toMatch(/fetchCrewSpotsOpen\(/);
    }
    for (const f of ["src/hooks/useDashboardData.ts", "src/lib/guestJobsQuery.ts", "src/boot/guestJobsPrefetch.ts", "src/components/browseMap/fetchJobForPin.ts", "src/pages/home/fetchGuestJobs.ts"]) {
      const src = blankComments(readFileSync(resolve(ROOT, f), "utf8"));
      expect(src, `${f} selects crew_spots_open in a main list (a deploy before db-deploy would fail the whole feed)`).not.toMatch(/"id, title, description[^"\n]*\bcrew_spots_open\b/);
    }
  });

  it("has a PGlite proof that is red on the old surfaces", () => {
    const proof = resolve(ROOT, "src/test/pglite/crewFreeSpotRelisted.pglite.mjs");
    expect(existsSync(proof)).toBe(true);
    const src = readFileSync(proof, "utf8");
    expect(src).toContain(`const THIS = "${THIS}"`);
    expect(src).toContain("effectiveDefs(DIR, { before: THIS })");
    for (const c of ["B1 open_jobs_browse lists", "B2 never a full crew", "B3 the ranked, map and public lists", "A1 a new Helpr applies",
      "A2 a direct application insert", "M1 the applicant still sees", "const expected = 5;"]) {
      expect(src).toContain(c);
    }
    const priv = readFileSync(resolve(ROOT, "src/test/pglite/crewSpotsOpenPrivate.pglite.mjs"), "utf8");
    expect(priv).toContain(`const THIS = "${PRIVATE}"`);
    for (const c of ["P1 anon cannot call crew_spots_open", "P2 authenticated cannot call", "P3 as ${role}", "P4 the view's count equals", "SET ROLE ${role}", "const expected = 2;"]) {
      expect(priv).toContain(c);
    }
  });
});
