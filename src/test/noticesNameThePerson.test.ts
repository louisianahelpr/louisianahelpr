/**
 * Q2331 (owner 2026-11-03, via the lead: "first name + last initial"): three notices named a known person by
 * role: "A Helpr you picked didn't answer in time" (expire_unanswered_offers), "A Helpr gave up <date>"
 * (series_release_dates) and "The person who posted this job ... has taken you off it" (GroupJobHelpers).
 * Each now says who ("Bea T."), and the role words survive only as the fallback for a blank name: the SQL
 * passes them to member_display_name, the client to formatName. Reads the EFFECTIVE (newest) definitions,
 * comments blanked. Behaviour (names, blank names, a "%" in a name, 3x replay, grants):
 * src/test/pglite/noticesNameThePerson.pglite.mjs.
 *
 * @mutate supabase/migrations/20261109211412_notices_plain_back_office_words.sql | ELSE public.member_display_name((SELECT p.full_name FROM public.profiles p WHERE p.user_id = v_slot.helper_id), 'A Helpr you picked')\n                    \|\| ' didn''t answer | ELSE 'A Helpr you picked' \|\| ' didn''t answer
 * @mutate supabase/migrations/20261108202000_no_show_notice_server_side.sql | ELSE '%6$s gave up %1$s on | ELSE 'A Helpr gave up %1$s on
 * @mutate supabase/migrations/20261112025718_departed_member_scrub_one_word_names.sql | WHERE o.parent_job_id = n.job_id AND o.helper_id = OLD.user_id) | WHERE false AND o.parent_job_id = n.job_id AND o.helper_id = OLD.user_id)
 * @mutate src/components/GroupJobHelpers.tsx | message: `${formatName(myName, "The person who posted this job")} is still | message: `The person who posted this job is still
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { join } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs(join(process.cwd(), "supabase", "migrations"));
const body = (name: string) => {
  const d = defs.get(name);
  expect(d, `${name} has a definition`).toBeTruthy();
  return blankSqlComments(d!.stmt);
};

describe("notices name the person, not the role", () => {
  it("expire_unanswered_offers: the crew notice names the Helpr who didn't answer", () => {
    const sql = body("expire_unanswered_offers");
    expect(sql).toMatch(/member_display_name\(\(SELECT p\.full_name FROM public\.profiles p WHERE p\.user_id = v_slot\.helper_id\), 'A Helpr you picked'\)\s*\|\| ' didn''t answer in time/);
    // The role words appear only as that fallback.
    expect(sql.split("A Helpr you picked").length - 1).toBe(1);
  });

  it("series_release_dates: the gave-up notice names the Helpr (positional, so a % in a name is text)", () => {
    const sql = body("series_release_dates");
    expect(sql).toContain(`'%6$s gave up %1$s on "%2$s"%3$s.`);
    expect(sql).toMatch(/member_display_name\(\(SELECT p\.full_name FROM public\.profiles p WHERE p\.user_id = p_helper\), 'A Helpr'\)\)/);
    expect(sql).not.toMatch(/'A Helpr gave up/);
  });

  it("GroupJobHelpers: the removal notice names the poster", () => {
    const src = blankComments(fs.readFileSync("src/components/GroupJobHelpers.tsx", "utf8"));
    expect(src).toContain('message: `${formatName(myName, "The person who posted this job")} is still putting this crew together and took you off this job.');
    expect(src.split("The person who posted this job").length - 1).toBe(1);
  });

  it("a deleted series Helpr's name leaves the gave-up notice: the scrub matches the series tables", () => {
    const sql = body("scrub_departed_member_name_from_notifications");
    for (const [t, col] of [["recurring_visit_releases", "r"], ["series_date_offers", "o"], ["series_visit_holds", "h"]]) {
      expect(sql).toMatch(new RegExp(`EXISTS \\(SELECT 1 FROM public\\.${t} ${col}\\s+WHERE ${col}\\.parent_job_id = n\\.job_id AND ${col}\\.helper_id = OLD\\.user_id\\)`));
    }
  });
});
