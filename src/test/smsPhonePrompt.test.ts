/**
 * Q2423 The one-time "Add your phone so you don't miss updates" prompt (owner-approved 2026-10-27).
 *
 * Shown at a member's FIRST job post and a Helpr's FIRST hire, with the existing text-alert opt-in (SmsAlertsCard:
 * the same consent sentence, version and double opt-in); dismissed on the ACCOUNT
 * (notification_preferences.sms_phone_prompt_dismissed_at, own row only); never once a phone is confirmed; never on
 * sign-up. Behaviour: src/test/pglite/smsPhonePrompt.pglite.mjs (15 PASS with 20261027183058 applied 3x; 14 FAIL
 * with it absent). This guard pins the newest definitions and the two places it is mounted.
 *
 * @mutate supabase/migrations/20261027183058_sms_phone_prompt.sql |               WHERE np.user_id = v_uid AND np.sms_phone_prompt_dismissed_at IS NOT NULL) THEN |               WHERE np.user_id = v_uid) THEN
 * @mutate supabase/migrations/20261027183058_sms_phone_prompt.sql |                AND (c.sms_opt_in IS TRUE |                AND (false
 * @mutate supabase/migrations/20261027183058_sms_phone_prompt.sql |   RETURN v_n = 1; |   RETURN v_n >= 1;
 * @mutate src/components/notificationPreferences/SmsPhonePrompt.tsx |           <SmsAlertsCard /> |           <p>Text alerts</p>
 * @mutate src/components/notificationPreferences/SmsPhonePrompt.tsx |     void supabase.rpc("dismiss_sms_phone_prompt") |     void Promise.resolve({ data: 1, error: null })
 * @mutate src/pages/post-job/PaymentSuccess.tsx | <SmsPhonePrompt moment="first_job" /> | <span />
 * @mutate src/components/job-card/ActivityOfferDialogs.tsx |           <SmsPhonePrompt moment="first_hire" /> |           <span />
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newestFunction } from "./helpers/parityReaders";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const code = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");
const read = (p: string) => blankComments(readFileSync(p, "utf8")).replace(/\s+/g, " ");

describe("the one-time add-your-phone prompt", () => {
  it("reads the newest definitions (floor)", () => {
    const names = ["sms_phone_prompt_due", "dismiss_sms_phone_prompt"];
    for (const n of names) expect(newestFunction(n).file, n).toContain("20261027183058");
    expect(names.length).toBeGreaterThan(1);
  });

  it("the server: due only at the first post or hire, never after a dismissal or with a confirmed or waiting phone", () => {
    const due = code("sms_phone_prompt_due");
    expect(due).toContain("v_uid uuid := (SELECT auth.uid());");
    expect(due).toContain("WHERE np.user_id = v_uid AND np.sms_phone_prompt_dismissed_at IS NOT NULL) THEN RETURN false;");
    expect(due).toContain("AND (c.sms_opt_in IS TRUE OR (c.pending_phone IS NOT NULL AND c.pending_since > now() - interval '24 hours'))) THEN RETURN false;");
    expect(due).toContain("SELECT count(*)::integer INTO v_n FROM public.jobs j WHERE j.customer_id = v_uid;");
    expect(due).toContain("RETURN v_n = 1;");
    const dismiss = code("dismiss_sms_phone_prompt");
    expect(dismiss).toContain("VALUES (v_uid, now())");
    expect(dismiss).not.toMatch(/p_user|p_id/);
  });

  it("the client: the existing opt-in card inside, the switch read, every close dismisses", () => {
    const prompt = read("src/components/notificationPreferences/SmsPhonePrompt.tsx");
    expect(prompt).toContain("<SmsAlertsCard />");
    expect(prompt).toContain('const enabled = useFeature("sms_alerts");');
    expect(prompt).toContain('void supabase.rpc("dismiss_sms_phone_prompt")');
    expect(prompt).toContain('<Dialog open onOpenChange={(o) => { if (!o) close(); }}>');
    expect(prompt).toContain('<DialogSecondaryAction onClick={close}>Not now</DialogSecondaryAction>');
  });

  it("mounted at the first job post and the first hire, and never on sign-up", () => {
    expect(read("src/pages/post-job/PaymentSuccess.tsx")).toContain('{isHeld && <Suspense fallback={null}><SmsPhonePrompt moment="first_job" /></Suspense>}');
    expect(read("src/components/job-card/ActivityOfferDialogs.tsx")).toContain('<SmsPhonePrompt moment="first_hire" />');
    const signup = readdirSync("src/pages/auth/signup").filter((f: string) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
    expect(signup.length).toBeGreaterThan(2);
    for (const f of signup) expect(read(`src/pages/auth/signup/${f}`), f).not.toContain("SmsPhonePrompt");
  });
});
