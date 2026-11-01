/**
 * Q2423 The one-time "Add your phone so you don't miss updates" prompt (owner-approved 2026-10-27).
 *
 * Shown at a member's FIRST job post and a Helpr's FIRST hire, with the existing text-alert opt-in (SmsAlertsCard:
 * the same consent sentence, version and double opt-in); dismissed on the ACCOUNT
 * (notification_preferences.sms_phone_prompt_dismissed_at, own row only); never once a phone is confirmed; never on
 * sign-up. SMS-OPTIN (owner 2026-10-29, 20261030132841): a third moment, 'has_phone', asks a member whose profile
 * already has a phone, once, on Home, after the first-run tour. Behaviour: src/test/pglite/smsPhonePrompt.pglite.mjs
 * (23 PASS with both migrations applied 3x; PHONE_MIGRATION=skip: the 7 has_phone checks FAIL). This guard pins the
 * newest definitions and the three places it is mounted.
 *
 * @mutate supabase/migrations/20261030132841_sms_prompt_for_members_with_a_phone.sql |               WHERE np.user_id = v_uid AND np.sms_phone_prompt_dismissed_at IS NOT NULL) THEN |               WHERE np.user_id = v_uid) THEN
 * @mutate supabase/migrations/20261030132841_sms_prompt_for_members_with_a_phone.sql |                AND (c.sms_opt_in IS TRUE |                AND (false
 * @mutate supabase/migrations/20261030132841_sms_prompt_for_members_with_a_phone.sql |   RETURN v_n = 1; |   RETURN v_n >= 1;
 * @mutate supabase/migrations/20261030132841_sms_prompt_for_members_with_a_phone.sql | WHERE p.id = v_uid AND nullif(btrim(p.phone), '') IS NOT NULL); | WHERE p.id = v_uid);
 * @mutate src/pages/home/HomeDashboard.tsx | {!firstRunActive && <Suspense fallback={null}><SmsPhonePrompt moment="has_phone" /> | {<Suspense fallback={null}><SmsPhonePrompt moment="has_phone" />
 * @mutate src/pages/home/HomeDashboard.tsx | <FirstRun userId={user?.id} onActiveChange={setFirstRunActive} /> | <FirstRun userId={user?.id} />
 * @mutate src/components/notificationPreferences/SmsPhonePromptDialog.tsx | title={allSet ? "You're all set" : moment === "has_phone" ? SMS_TEXTS_PROMPT_TITLE : SMS_PHONE_PROMPT_TITLE} | title={allSet ? "You're all set" : SMS_PHONE_PROMPT_TITLE}
 * @mutate src/components/notificationPreferences/SmsPhonePromptDialog.tsx |           <SmsAlertsCard inPrompt onAllSet={onAllSet} /> |           <p>Text alerts</p>
 * @mutate src/components/notificationPreferences/SmsPhonePromptDialog.tsx |     void supabase.rpc("dismiss_sms_phone_prompt") |     void Promise.resolve({ data: 1, error: null })
 * @mutate src/pages/post-job/PaymentSuccess.tsx | <SmsPhonePrompt moment="first_job" /> | <span />
 * @mutate src/components/job-card/ActivityOfferDialogs.tsx |           <SmsPhonePrompt moment="first_hire" /> |           <span />
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { newestFunction } from "./helpers/parityReaders";
import { smsConfirmWaitingFresh } from "@/lib/smsConsent";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { readdirSync } from "./helpers/trackedFiles";

const code = (name: string) => blankSqlComments(newestFunction(name).body).replace(/\s+/g, " ");
const read = (p: string) => blankComments(readFileSync(p, "utf8")).replace(/\s+/g, " ");
// B87: the gate (switch, due read) and the dialog it loads once due are two files.
const readPrompt = () => read("src/components/notificationPreferences/SmsPhonePrompt.tsx") + read("src/components/notificationPreferences/SmsPhonePromptDialog.tsx");

describe("the one-time add-your-phone prompt", () => {
  it("reads the newest definitions (floor)", () => {
    const newest: Record<string, string> = {
      sms_phone_prompt_due: "20261030132841",
      dismiss_sms_phone_prompt: "20261027183058",
    };
    const names = Object.keys(newest);
    for (const n of names) expect(newestFunction(n).file, n).toContain(newest[n]);
    expect(names.length).toBeGreaterThan(1);
  });

  it("the server: due only at the first post or hire, never after a dismissal or with a confirmed or waiting phone", () => {
    const due = code("sms_phone_prompt_due");
    expect(due).toContain("v_uid uuid := (SELECT auth.uid());");
    expect(due).toContain("WHERE np.user_id = v_uid AND np.sms_phone_prompt_dismissed_at IS NOT NULL) THEN RETURN false;");
    expect(due).toContain("AND (c.sms_opt_in IS TRUE OR (c.pending_phone IS NOT NULL AND c.pending_since > now() - interval '24 hours'))) THEN RETURN false;");
    expect(due).toContain("SELECT count(*)::integer INTO v_n FROM public.jobs j WHERE j.customer_id = v_uid;");
    expect(due).toContain("RETURN v_n = 1;");
    // SMS-OPTIN: 'has_phone' is the caller's own profile phone, blank or spaces counting as none.
    expect(due).toContain("p_moment NOT IN ('first_job', 'first_hire', 'has_phone')");
    expect(due).toContain("IF p_moment = 'has_phone' THEN RETURN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND nullif(btrim(p.phone), '') IS NOT NULL); END IF;");
    // The dismissal and texts-on checks come BEFORE the has_phone answer, so they hold for it too.
    expect(due.indexOf("sms_phone_prompt_dismissed_at IS NOT NULL")).toBeLessThan(due.indexOf("IF p_moment = 'has_phone'"));
    expect(due.indexOf("c.sms_opt_in IS TRUE")).toBeLessThan(due.indexOf("IF p_moment = 'has_phone'"));
    const dismiss = code("dismiss_sms_phone_prompt");
    expect(dismiss).toContain("VALUES (v_uid, now())");
    expect(dismiss).not.toMatch(/p_user|p_id/);
  });

  it("the client: the existing opt-in card inside, the switch read, every close dismisses", () => {
    const prompt = readPrompt();
    expect(prompt).toContain("<SmsAlertsCard inPrompt onAllSet={onAllSet} />");
    expect(prompt).toContain('const enabled = useFeature("sms_alerts");');
    expect(prompt).toContain('void supabase.rpc("dismiss_sms_phone_prompt")');
    expect(prompt).toContain('<Dialog open onOpenChange={(o) => { if (!o) close(); }}>');
    expect(prompt).toContain('<DialogSecondaryAction onClick={close}>{allSet ? "Close" : "Not now"}</DialogSecondaryAction>');
  });

  it("on Home for members who already gave a phone: worded as turning texts on, never over the first-run tour", () => {
    const home = read("src/pages/home/HomeDashboard.tsx");
    expect(home).toContain('{!firstRunActive && <Suspense fallback={null}><SmsPhonePrompt moment="has_phone" /></Suspense>}');
    expect(home).toContain("<FirstRun userId={user?.id} onActiveChange={setFirstRunActive} />");
    expect(home).toContain("const [firstRunActive, setFirstRunActive] = useState(true);");
    const prompt = readPrompt();
    expect(prompt).toContain('title={allSet ? "You\'re all set" : moment === "has_phone" ? SMS_TEXTS_PROMPT_TITLE : SMS_PHONE_PROMPT_TITLE}');
    expect(prompt).toContain('export const SMS_TEXTS_PROMPT_TITLE = "Turn on texts so you don\'t miss updates";');
  });

  it("mounted at the first job post and the first hire, and never on sign-up", () => {
    expect(read("src/pages/post-job/PaymentSuccess.tsx")).toContain('{isHeld && <Suspense fallback={null}><SmsPhonePrompt moment="first_job" /></Suspense>}');
    expect(read("src/components/job-card/ActivityOfferDialogs.tsx")).toContain('<SmsPhonePrompt moment="first_hire" />');
    const signup = readdirSync("src/pages/auth/signup").filter((f: string) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
    expect(signup.length).toBeGreaterThan(2);
    for (const f of signup) expect(read(`src/pages/auth/signup/${f}`), f).not.toContain("SmsPhonePrompt");
  });
});

// Owner 2026-10-28 (screenshot + prod events): the phone's YES opted in at
// 03:04:07, but the open card still showed "Waiting" with Cancel; Cancel at
// 03:04:16 turned the new alerts straight off. The card re-reads while a
// confirmation is waiting, and a Cancel first re-reads and keeps alerts on if
// the YES already landed.
// @mutate src/components/notificationPreferences/SmsAlertsCard.tsx |     refetchInterval: (q) => (smsConfirmWaitingFresh(q.state.data) ? 3000 : false), |     refetchInterval: false,
// @mutate src/lib/smsConsent.ts | now - Date.parse(c.pending_since) < SMS_CONFIRM_POLL_CAP_MS | true
// @mutate src/components/notificationPreferences/SmsAlertsCard.tsx |        if (fresh?.sms_opt_in) { |        if (false) {
describe("the waiting-card re-read is capped at 10 min", () => {
  it("polls only while a confirmation is waiting and under 10 minutes old", () => {
    const t0 = Date.parse("2026-10-28T03:00:00Z");
    const waiting = { phone_e164: null, sms_opt_in: false, opted_in_at: null, opted_out_at: null, opt_out_source: null, pending_phone: "+12255550123", pending_since: "2026-10-28T03:00:00Z" };
    expect(smsConfirmWaitingFresh(waiting, t0 + 9 * 60_000)).toBe(true);
    expect(smsConfirmWaitingFresh(waiting, t0 + 10 * 60_000)).toBe(false);
    expect(smsConfirmWaitingFresh({ ...waiting, sms_opt_in: true }, t0 + 60_000)).toBe(false);
    expect(smsConfirmWaitingFresh({ ...waiting, pending_since: null }, t0 + 60_000)).toBe(false);
    expect(smsConfirmWaitingFresh(undefined, t0)).toBe(false);
  });
});

describe("a confirmed YES is never undone by a stale Waiting card", () => {
  it("re-reads while waiting, and Cancel keeps alerts on when the YES already landed", () => {
    const card = read("src/components/notificationPreferences/SmsAlertsCard.tsx");
    expect(card).toContain("refetchInterval: (q) => (smsConfirmWaitingFresh(q.state.data) ? 3000 : false),");
    expect(card).toMatch(/if \(!optIn && pendingPhone && !optedIn\) \{ const fresh = \(await refetch\(\)\)\.data; if \(fresh\?\.sms_opt_in\) \{ toast\.success\("Text alerts are on\."\); return; \} \}/);
  });
});
