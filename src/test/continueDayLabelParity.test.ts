/**
 * F175 (owner UI audit 11-09; lead 11-09): the continue-day date is written ONE way, on the server (continue_day_label,
 * read by every continue-day notice) and in the app (continueDayLabel, the job page and card lines): the house style
 * "Wed, Nov 11 at 9:00 AM". The newest SQL definition's to_char patterns are pinned here, and the client is checked
 * against the words those patterns produce; src/test/pglite/continueDayHouseDateStyle.pglite.mjs runs the SQL itself
 * against the client for the same samples. And "Your Helpr needs another day" names the asker "First L.".
 *
 * @mutate supabase/migrations/20261109224343_continue_day_house_date_style.sql |   SELECT to_char(p_date, 'FMDy, FMMon FMDD') |   SELECT to_char(p_date, 'FMDy FMMM/FMDD')
 * @mutate src/lib/continueDayWords.ts |   return `${weekday}, ${MONTH[m - 1]} ${d} at | return `${weekday} ${m}/${d} at
 * @mutate supabase/migrations/20261109224343_continue_day_house_date_style.sql | COALESCE(NULLIF(public.member_display_name((SELECT pr.full_name FROM public.profiles pr WHERE pr.user_id = v_uid), NULL), ''), 'Your Helpr') | COALESCE(NULLIF(split_part(public.member_display_name((SELECT pr.full_name FROM public.profiles pr WHERE pr.user_id = v_uid), NULL), ' ', 1), ''), 'Your Helpr')
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { continueDayLabel } from "@/lib/continueDayWords";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const body = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "");

describe("F175: one continue-day date style, server and app", () => {
  it("the newest continue_day_label writes 'FMDy, FMMon FMDD' at 'FMHH12:MI AM'", () => {
    const b = body("continue_day_label");
    expect(b.length).toBeGreaterThan(50);
    expect(b).toContain("to_char(p_date, 'FMDy, FMMon FMDD')");
    expect(b).toContain("to_char(p_time, 'FMHH12:MI AM')");
    expect(b).not.toContain("FMMM/FMDD");
  });

  it("the app's mirror gives the words those patterns give", () => {
    const cases: [string, string, string][] = [
      ["2026-11-11", "09:00", "Wed, Nov 11 at 9:00 AM"],
      ["2026-11-05", "13:30", "Thu, Nov 5 at 1:30 PM"],
      ["2026-11-08", "00:00", "Sun, Nov 8 at 12:00 AM"],
      ["2026-11-08", "12:15:00", "Sun, Nov 8 at 12:15 PM"],
      ["2027-01-01", "07:05", "Fri, Jan 1 at 7:05 AM"],
    ];
    expect(cases.length).toBeGreaterThan(4);
    for (const [d, t, want] of cases) expect(continueDayLabel(d, t), `${d} ${t}`).toBe(want);
  });

  it("the continue-day ask names the asker First L. in both directions, never the first name alone", () => {
    const b = body("propose_job_continue_day");
    expect(b).not.toContain("split_part(");
    expect((b.match(/COALESCE\(NULLIF\(public\.member_display_name\(/g) ?? []).length).toBe(2);
  });
});
