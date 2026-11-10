/**
 * F466/F502 (whole-app audit 11-10, Worker 6; lead confirmed): members read three different strike rules (warning
 * email: 3rd strike = 7 days with no window; one push: 2nd in 7 days = 7 days; another push: 30 days). The enforcement
 * code applies two ladders side by side (team strikes in admin-user-actions; automatic flags in
 * auto_restrict_repeat_violators). Every member strike email and push now states them in ONE wording, STRIKE_RULE
 * (supabase/functions/_shared/strikeRule.ts), and the SQL trigger carries the same bytes.
 *
 * Reads the NEWEST trigger definition (effectiveDefs), comments blanked.
 *
 * @mutate supabase/migrations/20261110200605_strike_rule_one_wording.sql | the 2nd suspends your account for 7 days, and the 3rd suspends it for 30 days. Reach out to support if you think this is a mistake.', violation_count) | the 2nd suspends your account for 7 days. Reach out to support if you think this is a mistake.', violation_count)
 * @mutate supabase/functions/admin-user-actions/index.ts |             ' A warning banner now shows at the top of your app. ',\n            STRIKE_RULE, |             ' One more violation will result in an automatic 7-day suspension.',
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const ruleSrc = readFileSync(resolve(ROOT, "supabase/functions/_shared/strikeRule.ts"), "utf8");
const RULE = /STRIKE_RULE =\s*'([^']+)'/.exec(ruleSrc)?.[1] ?? "";

describe("F466/F502: one strike rule, same words everywhere", () => {
  it("the rule names both ladders with the numbers the code enforces", () => {
    expect(RULE.length).toBeGreaterThan(150);
    expect(RULE).toContain("the 3rd suspends your account for 7 days");
    expect(RULE).toContain("counted over 7 days");
    expect(RULE).toContain("the 3rd suspends it for 30 days");
  });

  it("the automatic ladder's three member notices carry the rule verbatim, and its numbers match", () => {
    const fn = effectiveDefs(resolve(ROOT, "supabase/migrations")).get("auto_restrict_repeat_violators")?.stmt ?? "";
    const code = blankSqlComments(fn);
    expect(code.length).toBeGreaterThan(2000);
    const notices = code.match(/'Our system flagged[^']*'/g) ?? [];
    expect(notices).toHaveLength(3);
    for (const n of notices) expect(n).toContain(RULE);
    expect(code).toContain("INTERVAL '7 days'");
    expect(code).toContain("auto_suspended_until = NOW() + INTERVAL '30 days'");
    expect(code).toContain("'Account suspended for 7 days'");
    expect(code).toContain("'Account suspended for 30 days'");
    expect(code).not.toContain("Account suspended —");
  });

  it("every team strike push and email (strikes 1, 2, 3) carries the rule, and no other ladder summary is left", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "supabase/functions/admin-user-actions/index.ts"), "utf8"));
    const block = src.slice(src.indexOf("action === 'formal_warning'"), src.indexOf("admin_apply_account_action', {\n        p_user_id: targetUserId,\n        p_admin_id: userData.user.id,\n        p_action: actionTaken"));
    expect(block.length).toBeGreaterThan(2000);
    // 3 pushes + 3 email callouts.
    expect((block.match(/STRIKE_RULE/g) ?? []).length).toBe(6);
    expect(block).not.toMatch(/One more violation will result/);
    expect(block).not.toMatch(/An automatic 7-day rule also applies/);
    expect(block).not.toMatch(/3-strike limit/);
    expect(src).toContain("from '../_shared/strikeRule.ts'");
  });
});
