/**
 * Wanted notices try email (gap sweep D4-11; migration 20261030154707).
 *
 * The bug: "A seller has a match" made a bell row and a push and no email_send_log row, though the email switch exists.
 * Reads the EFFECTIVE functions. Backend proof: src/test/pglite/declutterWantedEmail.pglite.mjs (3x; red without the
 * migration and on its planted defects).
 */
// @mutate supabase/migrations/20261030154707_declutter_wanted_email.sql | PERFORM public.declutter_wanted_email(w.user_id, 'A seller has a match', v_message, '/declutter?tab=buying'); | NULL;
// @mutate supabase/migrations/20261030154707_declutter_wanted_email.sql | IF v_id IS NOT NULL THEN\n    PERFORM public.declutter_wanted_email | IF true THEN\n    PERFORM public.declutter_wanted_email
// @mutate supabase/migrations/20261030154707_declutter_wanted_email.sql | 'type', 'declutter_wanted', 'link', p_link | 'type', 'new_offers', 'link', p_link
// @mutate supabase/migrations/20261030154707_declutter_wanted_email.sql | AND NOT COALESCE((SELECT r.is_seed FROM public.profiles r WHERE r.user_id = w.user_id), false)) THEN | AND false) THEN
// @mutate supabase/migrations/20261030154707_declutter_wanted_email.sql | 'A seller has a match', v_message, '/declutter?tab=buying', v_uid); | 'A seller has a match', v_message, '/declutter?view=offers', v_uid);
// @mutate supabase/migrations/20261030154707_declutter_wanted_email.sql | 'message', public.declutter_price_words(p_message) | 'message', p_message
// @mutate src/components/notificationPreferences/constants.tsx | label: "Wanted matches", icon: <Search className="w-3.5 h-3.5" /> }, | label: "Wanted matches", icon: <Search className="w-3.5 h-3.5" />, noEmailSwitch: NO_EMAIL },
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";
import { declutterRows } from "@/components/notificationPreferences/constants";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const body = (fn: string) => blankSqlComments(defs.get(fn)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("Wanted notices try email", () => {
  it("the helper posts to send-notification-email under the Wanted type, in the words the bell shows", () => {
    const h = flat(body("declutter_wanted_email"));
    expect(h.length).toBeGreaterThan(300);
    expect(h).toContain("/functions/v1/send-notification-email");
    expect(h).toContain("'type', 'declutter_wanted'");
    expect(h).toContain("'message', public.declutter_price_words(p_message)");
    expect(h).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(h).toContain("public.log_cron_defect('declutter_wanted_email'");
  });
  it("the match alerts email only when the bell row landed", () => {
    expect(flat(body("declutter_wanted_notify"))).toContain("IF v_id IS NOT NULL THEN PERFORM public.declutter_wanted_email(p_user, p_title, p_message, p_link);");
  });
  it("a reply emails the poster, and a test seller never reaches a real member", () => {
    const r = flat(body("declutter_wanted_reply"));
    expect(r).toContain("PERFORM public.declutter_wanted_email(w.user_id, 'A seller has a match', v_message, '/declutter?tab=buying');");
    expect(r).toContain("IF NOT (COALESCE((SELECT o.is_seed FROM public.profiles o WHERE o.user_id = v_uid), false) AND NOT COALESCE((SELECT r.is_seed FROM public.profiles r WHERE r.user_id = w.user_id), false)) THEN");
  });
  it("Settings shows a real Email switch for it, so a member can turn it off", () => {
    const row = declutterRows.find((r) => r.key === "declutter_wanted");
    expect(row?.emailKey).toBe("email_declutter_wanted");
    expect(row?.noEmailSwitch).toBeUndefined();
  });
  it("a reply's notice opens the buyer's tab", () => {
    const r = body("declutter_wanted_reply");
    expect(r).not.toContain("?view=offers");
    expect(flat(r)).toContain("'A seller has a match', v_message, '/declutter?tab=buying', v_uid);");
  });
});
