/**
 * Who a marketing blast reaches (owner decision by pop-up, 2026-11-25 ~2 AM):
 * a member who ticked "email me" at sign-up (profiles.marketing_consent) and
 * NEVER turned Promotions off gets marketing email. Since migration
 * 20261021135832 notification_preferences.email_promotions is three-valued
 * (NULL = never chosen, true = on, false = off or unsubscribed), and the blast
 * used to need an explicit true, so its reach on prod was 0 of 136 consenting,
 * verified members (measured 2026-11-25 1:55 AM).
 *
 * The rule now, the same one the welcome drip, win-back and come-back emails
 * use: email verified AND marketing_consent true AND email_promotions is not
 * false AND the Email master is not off AND not on the suppression list AND
 * not a seed/test recipient. Run for real through the edge harness.
 *
 * @mutate supabase/functions/send-marketing-blast/index.ts |           .filter((p) => p.email_promotions === false \|\| p.email_enabled === false) |           .filter((p) => p.email_promotions !== true \|\| p.email_enabled === false)
 * @mutate supabase/functions/send-marketing-blast/index.ts |           .filter((p) => p.email_promotions === false \|\| p.email_enabled === false) |           .filter((p) => p.email_enabled === false)
 * @mutate supabase/functions/send-marketing-blast/index.ts |           p.marketing_consent === true && |           true &&
 * @mutate supabase/functions/send-marketing-blast/index.ts |           p.email_verified === true && |           true &&
 * @mutate supabase/functions/send-marketing-blast/index.ts |           p.ban_status === "active" && |           true &&
 * @mutate supabase/functions/send-marketing-blast/index.ts |           !p.anonymized_at && |           true &&
 * @mutate supabase/functions/send-marketing-blast/index.ts |     recipients = recipients.filter((r) => !suppressedSet.has(r.email.toLowerCase())); |     recipients = recipients.filter((r) => !!r.email);
 * @mutate supabase/functions/send-marketing-blast/index.ts |       if (prefsScan.error \|\| !prefsScan.complete) { |       if (false) {
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetEmailMocks, sendWithResend } from "./mocks/email";

type Member = {
  user_id: string;
  email: string;
  full_name: string;
  parish: string | null;
  marketing_consent: boolean;
  email_verified: boolean;
  ban_status: string;
  anonymized_at: string | null;
};
const member = (id: string, over: Partial<Member> = {}): Member => ({
  user_id: id,
  email: `${id}@gmail.com`,
  full_name: id,
  parish: null,
  marketing_consent: true,
  email_verified: true,
  ban_status: "active",
  anonymized_at: null,
  ...over,
});

// What the profiles read can hand back. The real query also filters
// email_verified and marketing_consent server-side; the mock does not filter,
// so the two rows that fail them prove the function re-checks in code too.
const MEMBERS: Member[] = [
  member("never-chose"), // email_promotions NULL + consent -> mailed (the owner's decision)
  member("no-prefs-row"), // no notification_preferences row at all -> column defaults -> mailed
  member("turned-on"), // email_promotions true -> mailed
  member("turned-off"), // email_promotions false -> skipped
  member("master-off"), // Email master off -> skipped
  member("no-consent", { marketing_consent: false }), // never ticked the box -> skipped
  member("unverified", { email_verified: false }), // email not verified -> skipped
  member("banned", { ban_status: "banned" }), // banned -> skipped
  member("deleted", { anonymized_at: "2026-11-01T00:00:00Z" }), // deleted account -> skipped
  member("bounced"), // on the suppression list -> skipped
  member("seed-acct"), // is_seed -> logged 'suppressed', never mailed
];
const PREFS = [
  { user_id: "never-chose", email_promotions: null, email_enabled: true },
  { user_id: "turned-on", email_promotions: true, email_enabled: true },
  { user_id: "turned-off", email_promotions: false, email_enabled: true },
  { user_id: "master-off", email_promotions: null, email_enabled: false },
  { user_id: "no-consent", email_promotions: null, email_enabled: true },
  { user_id: "unverified", email_promotions: null, email_enabled: true },
  { user_id: "bounced", email_promotions: null, email_enabled: true },
  { user_id: "seed-acct", email_promotions: null, email_enabled: true },
];

async function blast(body: Record<string, unknown> = { subject: "Holiday deals", html: "<p>Hi {{name}}</p>", segment: "all" }) {
  const fn = await loadEdgeFunction("send-marketing-blast");
  return fn.fetch(fn.request({
    url: "https://edge.test/send-marketing-blast",
    headers: { Authorization: "Bearer admin-jwt" },
    body,
  }));
}
const mailedTo = () => sendWithResend.mock.calls.map((c) => (c[1] as { to: string }).to);
const logRows = () =>
  scenario.writes
    .filter((w) => w.table === "email_send_log" && w.op === "insert")
    .flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload])) as Array<{ recipient_email: string; status: string }>;

describe("send-marketing-blast reaches consenting members who never turned Promotions off", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetEmailMocks();
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", RESEND_API_KEY: "re_test" });
    scenario.authUser = { id: "admin-1", email: "admin@louisianahelpr.test" };
    scenario.rpc.has_role = true;
    scenario.reads.suppressed_emails = { rows: [{ email: "Bounced@gmail.com" }] };
    scenario.reads.notification_preferences = { rows: PREFS };
    scenario.reads.profiles = {
      // seedAddressesAmong reads `select('email')`; the recipient read names full_name.
      rows: [{ email: "seed-acct@gmail.com" }],
      selectOverrides: [{ includes: "full_name", result: { rows: MEMBERS } }],
    };
  });
  afterEach(() => resetEnv());

  it("mails NULL (never chosen) and true; skips false, master off, no consent, unverified, banned, deleted, suppressed and seed", async () => {
    const res = await blast();
    expect(res.status).toBe(200);
    expect(mailedTo().sort()).toEqual(["never-chose@gmail.com", "no-prefs-row@gmail.com", "turned-on@gmail.com"]);
    const body = await res.json();
    expect(body).toMatchObject({ sent: 3, failed: 0, suppressed: 1, total: 4 });
    // The seed recipient is logged as suppressed, never mailed.
    expect(logRows().filter((r) => r.status === "suppressed").map((r) => r.recipient_email)).toEqual(["seed-acct@gmail.com"]);
    // The database query still carries both consent filters.
    const read = (scenario.readQueries ?? []).find((q) => q.table === "profiles" && q.cols.includes("full_name"));
    expect(read?.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "eq", column: "email_verified", value: true }),
      expect.objectContaining({ op: "eq", column: "marketing_consent", value: true }),
      expect.objectContaining({ op: "eq", column: "ban_status", value: "active" }),
      expect.objectContaining({ op: "is", column: "anonymized_at", value: null }),
    ]));
  });

  it("an explicit Promotions-off is never mailed, even with the sign-up box ticked", async () => {
    scenario.reads.notification_preferences = { rows: PREFS.map((p) => ({ ...p, email_promotions: false })) };
    await blast();
    expect(mailedTo()).toEqual(["no-prefs-row@gmail.com"]);
  });

  it("fails closed: an unreadable opt-out list sends nothing", async () => {
    scenario.reads.notification_preferences = { error: { message: "boom" } };
    const res = await blast();
    expect(res.status).toBe(500);
    expect(sendWithResend).not.toHaveBeenCalled();
  });

  it("fails closed: an unreadable suppression list sends nothing", async () => {
    scenario.reads.suppressed_emails = { error: { message: "boom" } };
    const res = await blast();
    expect(res.status).toBe(503);
    expect(sendWithResend).not.toHaveBeenCalled();
  });

  it("the test_email preview still goes only to that address", async () => {
    const res = await blast({ subject: "Hi", html: "<p>Hi</p>", segment: "all", test_email: "owner@gmail.com" });
    expect(res.status).toBe(200);
    expect(mailedTo()).toEqual(["owner@gmail.com"]);
  });
});
