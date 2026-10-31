/**
 * Job reminders: always on or switchable, ON by default, in one Settings
 * section (owner 2026-10-29, via the lead). Behaviour on real Postgres:
 * src/test/pglite/jobReminderChoices.pglite.mjs. This guard keeps the layers
 * joined, on the definitions the migrations actually leave live:
 * - the push fan-out lets an always-on reminder past the category gate and
 *   holds a switchable one to its own switch;
 * - the notifications insert gate drops a switchable reminder the member
 *   turned off, and the stalled-completion sender treats that drop as by design;
 * - payout day1/day3/day7 follow-ups honour their switch in the claim;
 * - every switchable reminder in the registry has a column the Settings screen
 *   can write (types, defaults, deploy-lag list, the group's keys), exact both ways;
 * - the screen renders the Job reminders group.
 *
 * @mutate supabase/migrations/20261030031059_job_reminder_choices.sql | IF v_rem_kind IS NOT NULL AND v_rem_always IS TRUE THEN | IF false THEN
 * @mutate supabase/migrations/20261030031059_job_reminder_choices.sql | IF public.job_reminder_switched_off(NEW.user_id, NEW.type, NEW.title, NEW.message) THEN | IF false THEN
 * @mutate supabase/migrations/20261031220849_id_check_asked_when_hired_restated.sql | WHERE np.user_id = h.uid AND np.remind_payout_followups IS FALSE) | WHERE false)
 * @mutate src/components/notificationPreferences/JobRemindersGroup.tsx | "remind_starting_soon", "remind_finish_job", "remind_payout_followups", | "remind_starting_soon", "remind_finish_job",
 * @mutate supabase/functions/stalled-completion-reminder/index.ts | if (!switchErr && switchedOff === true) return; | if (false) return;
 * @mutate src/components/NotificationPreferences.tsx | <JobRemindersGroup | <JobRemindersGroupGone
 */
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { describe, expect, it } from "vitest";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { REMINDER_PREF_KEYS } from "@/components/notificationPreferences/JobRemindersGroup";
import { defaultPrefs } from "@/components/notificationPreferences/constants";
import { ALL_PRESENT } from "@/components/notificationPreferences/deployLagColumns";

const DIR = "supabase/migrations";
const flat = (s: string) => blankSqlComments(s).replace(/\s+/g, " ");
const src = (p: string) => blankComments(readFileSync(p, "utf8"));

/** Every switchable column named by a job_reminder_types insert in any migration. */
function registryColumns(): string[] {
  const cols = new Set<string>();
  for (const f of readdirSync(DIR)) {
    const sql = blankSqlComments(readFileSync(`${DIR}/${f}`, "utf8"));
    for (const ins of sql.matchAll(/INSERT INTO public\.job_reminder_types[\s\S]*?;/gi)) {
      for (const m of ins[0].matchAll(/'(remind_[a-z_]+)'/g)) cols.add(m[1]);
    }
  }
  return [...cols].sort();
}

describe("job reminders: always on or switchable (owner 2026-10-29)", () => {
  it("the live push fan-out sends an always-on reminder past the category gate, a switchable one by its own switch", () => {
    const def = effectiveDefs(DIR).get("fan_out_push_on_notification");
    expect(def, "fan_out_push_on_notification is gone").toBeTruthy();
    const body = flat(def!.stmt);
    const kind = body.indexOf("public.job_reminder_kind(NEW.type, NEW.title, NEW.message)");
    const bypass = body.indexOf("IF v_rem_kind IS NOT NULL AND v_rem_always IS TRUE THEN NULL;");
    const category = body.indexOf("FROM public.notification_type_pref_map");
    expect(kind).toBeGreaterThan(-1);
    expect(bypass, "always-on reminders must skip the category gate").toBeGreaterThan(kind);
    expect(category, "the category gate stays for everything else, after the reminder check").toBeGreaterThan(bypass);
    // push_enabled (all push off) is still checked first.
    expect(body.indexOf("prefs.push_enabled IS NOT TRUE")).toBeLessThan(kind);
  });

  it("the insert gate drops a switched-off reminder, and the stalled sender reads that drop as by design", () => {
    const gate = effectiveDefs(DIR).get("notifications_reminder_choice");
    expect(gate, "notifications_reminder_choice is gone").toBeTruthy();
    expect(flat(gate!.stmt)).toMatch(/IF public\.job_reminder_switched_off\(NEW\.user_id, NEW\.type, NEW\.title, NEW\.message\) THEN RETURN NULL;/);
    const trig = readdirSync(DIR).filter((f) => /CREATE TRIGGER trg_notifications_reminder_choice\s+BEFORE INSERT ON public\.notifications/i.test(blankSqlComments(readFileSync(`${DIR}/${f}`, "utf8"))));
    expect(trig.length).toBeGreaterThan(0);
    const stalled = src("supabase/functions/stalled-completion-reminder/index.ts");
    expect(stalled).toMatch(/rpc\("job_reminder_switched_off"/);
    expect(stalled).toMatch(/if \(!switchErr && switchedOff === true\) return;/);
  });

  it("payout follow-ups honour their switch in the live claim; hired and money do not", () => {
    const def = effectiveDefs(DIR).get("claim_payout_setup_reminders");
    expect(def).toBeTruthy();
    const body = flat(def!.stmt);
    const nudge = body.slice(body.indexOf("nudge_due AS"), body.indexOf("due AS (", body.indexOf("nudge_due AS") + 12));
    expect(nudge).toMatch(/np\.user_id = h\.uid AND np\.remind_payout_followups IS FALSE/);
    // Only the follow-ups: the switch appears nowhere else in the claim.
    expect(body.split("remind_payout_followups").length - 1).toBe(1);
  });

  it("every switchable reminder has a column the Settings screen can write, exact both ways", () => {
    const cols = registryColumns();
    // Inventory floor: the three switchable reminders of 2026-10-29.
    expect(cols.length).toBeGreaterThan(2);
    expect([...REMINDER_PREF_KEYS].sort()).toEqual(cols);
    for (const c of cols) {
      expect(defaultPrefs[c as keyof typeof defaultPrefs], `${c} default`).toBe(true);
      expect(c in ALL_PRESENT, `${c} in the deploy-lag list`).toBe(true);
    }
    const types = readFileSync("src/integrations/supabase/types.ts", "utf8");
    for (const c of cols) expect(types).toMatch(new RegExp(`\\b${c}: boolean`));
  });

  it("the Notifications screen renders the Job reminders group", () => {
    expect(src("src/components/NotificationPreferences.tsx")).toMatch(/<JobRemindersGroup\b/);
  });
});
