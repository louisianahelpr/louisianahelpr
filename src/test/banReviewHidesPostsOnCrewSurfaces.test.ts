/**
 * Q1411 + Q1409 (2026-10-06): two branches restated the same five browse
 * objects on the same night. The ban-review branch hid an account's posts while
 * its review is open; the crew branch re-listed a booked crew's free spot. The
 * one deployed LAST wins, and the ban-review bodies had been written before the
 * crew ones, so landing them as written would have silently undone the crew
 * re-listing (found at rebase, before deploy).
 *
 * The class: whichever migration defines each of these objects LAST must carry
 * BOTH rules. Inventory: every migration file, newest definition per object.
 *
 * @mutate supabase/migrations/20261007033530_seed_switch_hides_test_profiles.sql |     -- Q1411: not while the poster is under an open ban settlement review.\n    AND NOT EXISTS (SELECT 1 FROM public.ban_settlement_queue q WHERE q.user_id = j.customer_id AND q.review_state = 'open')\n  ORDER BY j.boosted_at |     AND true\n  ORDER BY j.boosted_at
 * @mutate supabase/migrations/20261006042617_ban_review_hides_posts_on_crew_surfaces.sql |  AND (NOT (EXISTS ( SELECT 1 FROM ban_settlement_queue q WHERE q.user_id = jobs.customer_id AND q.review_state = 'open'::text))) |
 * @mutate supabase/migrations/20261007033530_seed_switch_hides_test_profiles.sql |   IF EXISTS (SELECT 1 FROM public.ban_settlement_queue q\n              WHERE q.user_id = v_job.customer_id AND q.review_state = 'open') THEN |   IF false THEN
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readdirSync } from "./helpers/trackedFiles";

const DIR = join(__dirname, "..", "..", "supabase", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

/** The body of the newest definition of `name`, and the file it is in. */
function newest(name: string, kind: "FUNCTION" | "VIEW"): { file: string; body: string } {
  const head = new RegExp(`CREATE OR REPLACE ${kind} public\\.${name}\\b`);
  for (const f of [...files].reverse()) {
    const sql = readFileSync(join(DIR, f), "utf8");
    const m = head.exec(sql);
    if (!m) continue;
    const end = kind === "VIEW" ? sql.indexOf("$v$;", m.index) : sql.indexOf("$function$;", m.index);
    return { file: f, body: sql.slice(m.index, end > 0 ? end : undefined) };
  }
  throw new Error(`no migration defines ${name}`);
}

const SURFACES: Array<[string, "FUNCTION" | "VIEW"]> = [
  ["open_jobs_browse", "VIEW"],
  ["get_ranked_open_jobs", "FUNCTION"],
  ["get_open_jobs_for_map", "FUNCTION"],
  ["get_public_open_jobs", "FUNCTION"],
  ["enforce_application_job_state", "FUNCTION"],
];

describe("the newest browse definitions carry both the ban-review hide (Q1411) and the crew re-listing (Q1409)", () => {
  it("scans the real migrations", () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it.each(SURFACES)("%s hides a poster under an open ban settlement review", (name, kind) => {
    const { file, body } = newest(name, kind);
    expect(body, `${file} restated ${name} without the Q1411 clause`).toMatch(/ban_settlement_queue q\s+WHERE q\.user_id = (?:j\.|jobs\.|v_job\.)customer_id AND q\.review_state = 'open'/);
  });

  it.each(SURFACES)("%s keeps a booked crew's free spot open to applicants", (name, kind) => {
    const { file, body } = newest(name, kind);
    expect(body, `${file} restated ${name} without the crew re-listing`).toMatch(/crew_spots_open|'accepted'::job_status AND is_group_job IS TRUE|status = 'accepted' AND/);
  });
});
