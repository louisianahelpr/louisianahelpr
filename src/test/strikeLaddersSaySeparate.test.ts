/**
 * F191 (owner UI audit 11-09, Part 3 message review; lead plan approved, wording only). Two strike counts are real:
 * strikes from our team (admin-user-actions formal_warning: 1 warning, 2 final warning, 3 a 7-day suspension) and
 * automatic flags (auto_restrict_repeat_violators: over 7 days, 1 final warning, 2 a 7-day suspension, 3 thirty days).
 * Members were told one or the other as if it were the only rule. Every member message of both now says the other rule
 * applies alongside (not "separately": the team count reads every warning row, automatic ones too; review 11-09). The ladder itself is proved unchanged by src/test/pglite/autoFlagNoticeWording.pglite.mjs.
 *
 * Reads the NEWEST definition of the trigger function (effectiveDefs), comments blanked.
 *
 * @mutate supabase/migrations/20261109192930_auto_flag_notices_say_separate_from_team_strikes.sql | If it flags another within 7 days, your account is suspended for 7 days. This automatic rule runs alongside the 3-strike rule for warnings from our team.', | If it flags another within 7 days, your account is suspended for 7 days.',
 * @mutate supabase/functions/admin-user-actions/index.ts |           ' ',\n          AUTO_FLAGS_SEPARATE,\n        ], |         ],
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const SEP = "runs alongside the 3-strike rule for warnings from our team";

describe("F191: both strike counts say the other exists", () => {
  it("the automatic ladder's three member notices say they are automatic and separate", () => {
    const fn = effectiveDefs(resolve(ROOT, "supabase/migrations")).get("auto_restrict_repeat_violators")?.stmt ?? "";
    const code = blankSqlComments(fn);
    expect(code.length).toBeGreaterThan(2000);
    const memberNotices = code.match(/'Our system flagged[^']*'/g) ?? [];
    expect(memberNotices).toHaveLength(3);
    for (const n of memberNotices) expect(n).toContain(SEP);
    // The old wording, which named no second count, is gone.
    expect(code).not.toContain("You have a violation on file");
    expect(code).not.toContain("This is your second violation in 7 days");
    // The ladder's numbers are still the ones the notices name.
    expect(code).toContain("INTERVAL '7 days'");
    expect(code).toContain("INTERVAL '30 days'");
  });

  it("the team strikes' email (strikes 1 and 2) and their notices say automatic flags count separately", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "supabase/functions/admin-user-actions/index.ts"), "utf8"));
    expect(src).toContain("An automatic rule also applies alongside these strikes: if our system flags two problems on your account within 7 days, your account is suspended for 7 days.");
    expect((src.match(/AUTO_FLAGS_SEPARATE,/g) ?? []).length).toBe(2);
    expect((src.match(/An automatic 7-day rule also applies\./g) ?? []).length).toBe(2);
  });
});
