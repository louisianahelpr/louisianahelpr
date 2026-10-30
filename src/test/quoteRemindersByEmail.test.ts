/**
 * Q2120 (owner 2026-10-21, again 2026-10-22): quote reminders and the "Quotes
 * are closed" notice also go by EMAIL, with their own setting.
 *
 * Two layers, each read from its NEWEST source:
 *   - the sweep (newest sweep_quote_alerts) sends every reminder and the close
 *     notice with p_email true as email type 'quote_reminder', and the close
 *     notice counts the quotes still open; the newest quote_notify_to sends
 *     its email as that type;
 *   - CLASS: every email type send-notification-email gates (TYPE_MAP) is
 *     gated on a notification_preferences column a migration creates, and
 *     that column has an EMAIL SWITCH a member can see on the Notifications
 *     screen (a `rows` emailKey or a standalone toggle). An email gate with no
 *     visible switch is the invisible-preference defect N-005, on the email
 *     side: a member could get (or lose) mail they cannot control.
 *
 * Behaviour: src/test/pglite/quoteHireOnPay.pglite.mjs, the "remind" checks
 * (3/3 FAIL with --remind-before, all pass applied 3x).
 *
 * @mutate supabase/migrations/20261023120308_quote_reminders_by_email.sql |         r.quoter_id, true, r.request_id, NULL, false, 'quote_reminder'); |         r.quoter_id, false, r.request_id, NULL, false, 'quote_reminder');
 * @mutate supabase/migrations/20261023120308_quote_reminders_by_email.sql |                               AND q.quoter_id IS NOT NULL AND q.last_offer_side = 'quoter') |                               AND q.quoter_id IS NOT NULL)
 * @mutate supabase/migrations/20261023120308_quote_reminders_by_email.sql |       CASE WHEN r.too_late AND v_count = 0 |       CASE WHEN false AND v_count = 0
 * @mutate supabase/migrations/20261023120308_quote_reminders_by_email.sql | 'type', COALESCE(p_email_type, 'new_offers') | 'type', 'new_offers'
 * @mutate supabase/functions/_shared/notificationTypes.ts |   quote_reminder:    { prefCol: 'email_quote_reminders',  category: 'quote_reminders' }, |   quote_reminder:    { prefCol: 'email_new_offers',  category: 'quote_reminders' },
 * @mutate src/components/NotificationPreferences.tsx |         onToggle={() => toggle("email_quote_reminders")} |         onToggle={() => undefined}
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { declutterRows, rows } from "@/components/notificationPreferences/constants";

const root = resolve(__dirname, "../..");
const DIR = resolve(root, "supabase/migrations");
const EFFECTIVE = effectiveDefs(DIR);
const ws = (s: string) => s.replace(/\s+/g, " ");
const body = (fn: string) => {
  const stmt = EFFECTIVE.get(fn)?.stmt;
  expect(stmt, `${fn} has a definition`).toBeTruthy();
  return ws(blankSqlComments(stmt ?? ""));
};
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

function emailTypeMap(): Map<string, string> {
  // The table moved to a shared module both senders read (audit E2-12).
  const src = blankComments(read("supabase/functions/_shared/notificationTypes.ts"));
  const m = src.match(/const\s+NOTIFICATION_TYPE_MAP:[^=]*=\s*\{([\s\S]*?)\n\}/);
  if (!m) throw new Error("NOTIFICATION_TYPE_MAP not found in _shared/notificationTypes.ts");
  const out = new Map<string, string>();
  for (const e of m[1].matchAll(/(\w+):\s*\{\s*prefCol:\s*'(\w+)'/g)) out.set(e[1], e[2]);
  return out;
}

/** Every notification_preferences column a migration creates (CREATE TABLE body or ADD COLUMN). */
function prefColumns(): Set<string> {
  const cols = new Set<string>();
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(resolve(DIR, f), "utf8"));
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?notification_preferences\b([\s\S]*?);/gi)) {
      for (const c of m[1].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)) cols.add(c[1]);
    }
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?notification_preferences\s*\(([\s\S]*?)\n\);/gi)) {
      for (const c of m[1].matchAll(/^\s*"?(\w+)"?\s+(?:boolean|uuid|text|time|timestamptz|timestamp|integer)/gim)) cols.add(c[1]);
    }
    // Columns added in a loop (20261028162048, the Declutter switches):
    // FOREACH v IN ARRAY ARRAY['a', ...] LOOP ... EXECUTE format('ALTER TABLE
    // public.notification_preferences ADD COLUMN %I ...', v | 'email_' || v).
    for (const m of sql.matchAll(/FOREACH\s+(\w+)\s+IN\s+ARRAY\s+ARRAY\[([^\]]*)\]([\s\S]*?)END\s+LOOP/gi)) {
      const [, v, list, loop] = m;
      const names = [...list.matchAll(/'(\w+)'/g)].map((x) => x[1]);
      for (const a of loop.matchAll(/notification_preferences\s+ADD\s+COLUMN\s+%I[^']*',\s*('email_'\s*\|\|\s*)?(\w+)\s*\)/gi)) {
        if (a[2] !== v) continue;
        for (const n of names) cols.add(a[1] ? `email_${n}` : n);
      }
    }
  }
  return cols;
}

/**
 * Email switches a member can see: `rows` emailKeys, the Declutter group's rows
 * (DeclutterNotificationGroup: each shows its Email switch or, for a kind that
 * sends no email or always does, a dash with that reason as its label), plus
 * standalone toggles on the screen.
 */
function visibleEmailSwitches(): Set<string> {
  const screen = blankComments(read("src/components/NotificationPreferences.tsx"));
  const standalone = [...screen.matchAll(/toggle\("(email_\w+)"\)/g)].map((m) => m[1]);
  const declutter = declutterRows.map((r) => r.emailKey as string);
  return new Set<string>([...rows.map((r) => r.emailKey as string), ...declutter, ...standalone]);
}

describe("Q2120 quote reminders by email, with their own switch", () => {
  it("the sweep emails every reminder and the close notice as quote_reminder", () => {
    const sweep = body("sweep_quote_alerts");
    const calls = [...sweep.matchAll(/PERFORM public\.quote_notify_to\(([^;]*?)\);/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(2);
    for (const c of calls) expect(c).toMatch(/, true, r\.(request_id|id), NULL, false, 'quote_reminder'$/);
    // The close notice counts the quotes the poster can answer now, by
    // respond_to_job_quote's own rules, and past the 2-hour start rule offers nothing.
    expect(sweep).toContain(
      "SELECT count(*), count(*) FILTER (WHERE q.status = 'pending' AND q.respond_until > now() AND q.quoter_id IS NOT NULL AND q.last_offer_side = 'quoter') INTO v_count, v_live",
    );
    expect(sweep).toContain("- interval '2 hours' <= now() AS too_late");
    expect(sweep).toContain("CASE WHEN r.too_late AND v_count = 0 THEN 'No quotes came in for \"' || r.title || '\".'");
    expect(sweep).toContain("and none is waiting on you. You can set your own price and post it.");
    // The helper sends its email as the type it is given (8-argument callers keep new_offers).
    const notify = body("quote_notify_to");
    expect(notify).toContain("p_email_type text DEFAULT 'new_offers'");
    expect(notify).toContain("'type', COALESCE(p_email_type, 'new_offers')");
    expect(notify).toContain("VALUES (p_user, p_title, p_message, 'new_offers', v_link, p_job_id)");
  });

  it("the quote_reminder email type is gated on its own column", () => {
    expect(emailTypeMap().get("quote_reminder")).toBe("email_quote_reminders");
  });

  it("CLASS: every email gate is a real preference column with a switch on the Notifications screen", () => {
    const map = emailTypeMap();
    const cols = prefColumns();
    const visible = visibleEmailSwitches();
    // Floors: the parsers read the real registries, not an empty set.
    expect(map.size).toBeGreaterThan(17);
    expect(cols.size).toBeGreaterThan(20);
    expect(visible.size).toBeGreaterThan(11);
    const gates = [...new Set(map.values())];
    expect(gates.filter((c) => !cols.has(c)).sort()).toEqual([]);
    expect(gates.filter((c) => !visible.has(c)).sort()).toEqual([]);
  });
});
