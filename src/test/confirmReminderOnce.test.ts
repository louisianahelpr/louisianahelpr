/**
 * Confirm-your-email reminder: ONE email, about a day after sign-up, never
 * more than one (owner 2026-10-29, pop-up through the lead).
 *
 * Prod 2026-10-30 (read-only): the two-step version (20261025190000) sent a
 * one-hour email and a day email; 1 account got both, and 7 real unconfirmed
 * accounts never got one because the day step stopped at 7 days old.
 *
 * Guards, on the definition the migrations actually leave live
 * (effectiveDefs) and on the sender:
 * - claim_confirm_reminders claims step 2 only, from 24 hours after sign-up,
 *   with no upper age bound, and skips an account with a reminder row of ANY
 *   step;
 * - the confirm-reminders edge function asks for step 2 and nothing else;
 * - can fail: the pre-fix definition breaks the rule.
 * Behaviour (real Postgres, 24-hour edge to the millisecond):
 * src/test/pglite/confirmReminderOnce.pglite.mjs.
 *
 * @mutate supabase/migrations/20261030025302_confirm_reminder_once_after_a_day.sql | AND p_step = 2 | AND p_step IN (1, 2)
 * @mutate supabase/migrations/20261030025302_confirm_reminder_once_after_a_day.sql | AND NOT EXISTS (SELECT 1 FROM public.confirm_reminder_sends c WHERE c.user_id = u.id) | AND NOT EXISTS (SELECT 1 FROM public.confirm_reminder_sends c WHERE c.user_id = u.id AND c.reminder_step = 2)
 * @mutate supabase/migrations/20261030025302_confirm_reminder_once_after_a_day.sql | AND u.created_at <= now() - interval '24 hours' | AND u.created_at <= now() - interval '24 hours' AND u.created_at > now() - interval '7 days'
 * @mutate supabase/migrations/20261030025302_confirm_reminder_once_after_a_day.sql | AND u.created_at <= now() - interval '24 hours' | AND u.created_at <= now() - interval '1 hour'
 * @mutate supabase/functions/confirm-reminders/index.ts | const STEPS: ConfirmReminderStep[] = [2]; | const STEPS: ConfirmReminderStep[] = [1, 2];
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";
const FIX = "20261030025302";
const SENDER = "supabase/functions/confirm-reminders/index.ts";

/** Why the live claim_confirm_reminders could send more than one reminder, or at the wrong time ([] = none). */
function breaches(defs: ReturnType<typeof effectiveDefs>): string[] {
  const def = defs.get("claim_confirm_reminders");
  if (!def) return ["claim_confirm_reminders is gone"];
  const body = blankSqlComments(def.stmt).replace(/\s+/g, " ");
  const out: string[] = [];
  if (!/\bAND p_step = 2 AND\b/i.test(body)) out.push("step 2 is not the only step that can be due");
  if (!/u\.created_at <= now\(\) - interval '24 hours'/i.test(body)) out.push("not due from 24 hours after sign-up");
  if (/u\.created_at >/i.test(body)) out.push("an upper age bound skips older unconfirmed accounts");
  if (!/NOT EXISTS \(SELECT 1 FROM public\.confirm_reminder_sends c WHERE c\.user_id = u\.id\)/i.test(body)) {
    out.push("an account with an earlier reminder row of any step is not skipped");
  }
  return out;
}

describe("one confirm-your-email reminder per account, about a day after sign-up (owner 2026-10-29)", () => {
  it("the live claim_confirm_reminders claims step 2 only, from 24 h, no upper bound, never after any earlier reminder", () => {
    const defining = readdirSync(DIR).filter((f) =>
      /create\s+(or\s+replace\s+)?function\s+public\.claim_confirm_reminders\s*\(/i.test(blankSqlComments(readFileSync(`${DIR}/${f}`, "utf8"))),
    );
    // Inventory floor: the two-step original and this fix both define it.
    expect(defining.length).toBeGreaterThan(1);
    const defs = effectiveDefs(DIR);
    expect(defs.get("claim_confirm_reminders")?.file).toMatch(new RegExp(`^${FIX}`));
    expect(breaches(defs)).toEqual([]);
  });

  it("the sender asks for step 2 and nothing else", () => {
    const src = blankComments(readFileSync(SENDER, "utf8"));
    const m = src.match(/const STEPS: ConfirmReminderStep\[\] = \[([^\]]*)\];/);
    expect(m, "STEPS not found in confirm-reminders").toBeTruthy();
    expect(m![1].split(",").map((s) => s.trim())).toEqual(["2"]);
    // Every claim goes through the STEPS loop: no direct step-1 call.
    expect(src).not.toMatch(/p_step:\s*1\b/);
  });

  it("can fail: before the fix, the live definition sent the one-hour email and stopped at 7 days", () => {
    const before = breaches(effectiveDefs(DIR, { before: FIX }));
    expect(before).toContain("step 2 is not the only step that can be due");
    expect(before).toContain("an upper age bound skips older unconfirmed accounts");
    expect(before).toContain("an account with an earlier reminder row of any step is not skipped");
  });
});
