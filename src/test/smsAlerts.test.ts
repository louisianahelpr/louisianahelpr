/**
 * SMS alerts (owner, 2026-10-20): the source-level rules that keep texts
 * private and consented.
 *   1. The consent wording version the client shows equals the one the server
 *      stamps (newest set_sms_consent definition).
 *   2. send-sms-notification never reads a notification's title or message:
 *      the text comes only from sms_claim's `kind` (+ job uuid).
 *   3. What is texted: the classifier (sms_kind_for) reaches a 'warning',
 *      'payment' or 'financial_alerts' notification only by its EXACT title
 *      (never the back-out reminders), never an admin/system/review type, and
 *      returns exactly the kinds smsPolicy.ts has a fixed phrase for.
 *   4. Messy phone input (the Text alerts card's only typed field) is read
 *      the same way by the client (normalizeUsPhone) and the server
 *      (sms_normalize_phone): only a 10-digit US number, or 11 with a leading
 *      1, with a valid area code and exchange; anything else is refused.
 * Behaviour (consent, caps, quiet hours, seed suppression, STOP, ban gate,
 * 4-year retention) is proved in PGlite: src/test/pglite/smsAlerts.pglite.mjs
 * (70 checks, migration 20261021193738) and in src/test/edge/sms-alerts.test.ts.
 */
// @mutate src/lib/smsConsent.ts |   const e = d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith("1") ? `+${d}` : null; |   const e = d.length >= 10 ? `+1${d.slice(-10)}` : null;
// @mutate src/lib/smsConsent.ts | export const SMS_CONSENT_TEXT_VERSION = "sms-v2"; | export const SMS_CONSENT_TEXT_VERSION = "sms-v3";
// @mutate supabase/functions/send-sms-notification/index.ts | jobId: claim.job_id, | jobId: claim.job_id, title: (claim as { title?: string }).title,
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { SMS_CONSENT_TEXT_BEFORE_LINKS, SMS_CONSENT_TEXT_VERSION, normalizeUsPhone } from "@/lib/smsConsent";
import { SMS_KIND_PHRASES } from "../../supabase/functions/_shared/smsPolicy";

const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");

/** Newest migration body that (re)defines `fn`, any dollar-quote tag. */
function newestFunctionBody(fn: string): string {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
  let body = "";
  const re = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\([\\s\\S]*?AS\\s+(\\$[A-Za-z_]*\\$)([\\s\\S]*?)\\1`, "gi");
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(resolve(MIG_DIR, f), "utf8"));
    for (const m of sql.matchAll(re)) body = m[2];
  }
  return body;
}

/** Newest CREATE TRIGGER statement for `name`. */
function newestTrigger(name: string): string {
  const files = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort();
  let stmt = "";
  const re = new RegExp(`CREATE\\s+TRIGGER\\s+${name}\\b[^;]*;`, "gi");
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(resolve(MIG_DIR, f), "utf8"));
    for (const m of sql.matchAll(re)) stmt = m[0];
  }
  return stmt;
}

describe("SMS alerts source rules", () => {
  it("the client's consent wording version is the one the server stamps", () => {
    // Stamped on the request (set_sms_consent) and on the confirming YES
    // (sms_inbound_keyword).
    const body = newestFunctionBody("set_sms_consent") + newestFunctionBody("sms_inbound_keyword");
    expect(body.length).toBeGreaterThan(400);
    const stamped = [...body.matchAll(/consent_text_version\s*=\s*'([^']+)'|'(sms-v\d+)'/g)].map((m) => m[1] ?? m[2]);
    expect(stamped.length).toBeGreaterThan(1);
    expect(new Set(stamped)).toEqual(new Set([SMS_CONSENT_TEXT_VERSION]));
  });

  it("send-sms-notification never reads a notification title or message", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "supabase/functions/send-sms-notification/index.ts"), "utf8"));
    expect(src).toContain("buildSmsBody(");
    // Nothing from the claim but kind/job_id/first_text/phone/sms_id is read,
    // and no notification row is fetched here at all.
    const claimFields = new Set([...src.matchAll(/\bclaim\??\.([a-z_]+)/g)].map((m) => m[1]));
    expect(claimFields.size).toBeGreaterThan(3);
    expect([...claimFields].sort()).toEqual(["action", "code", "first_text", "job_id", "kind", "phone", "reason", "sms_id"]);
    expect(src).not.toMatch(/\btitle\b/);
    expect(src).not.toMatch(/from\(\s*['"]notifications['"]/);
  });

  // @mutate supabase/migrations/20261030215251_job_notices_follow_job_switches.sql |     WHEN p_type IN ('warning', 'job_updates') AND p_title IN ('A dispute was opened', 'Job disputed') THEN 'dispute' |     WHEN p_type IN ('warning', 'job_updates') THEN 'dispute'
  // @mutate supabase/migrations/20261030215251_job_notices_follow_job_switches.sql |     WHEN p_type = 'application' AND p_title = 'New application' THEN 'application' |     WHEN p_type = 'application' AND p_title = 'New application' THEN 'applied'
  it("the classifier reaches warning/payment/financial types only by exact title, never admin/system/review", () => {
    const trg = newestTrigger("notifications_fan_out_to_sms");
    expect(trg).toMatch(/AFTER\s+INSERT\s+ON\s+public\.notifications/i);
    const types = [...(trg.match(/IN\s*\(([^)]*)\)/i)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(types.length).toBeGreaterThan(5);
    for (const banned of ["admin_alert", "system_alert", "verified", "review", "transit_updates"]) {
      expect(types).not.toContain(banned);
    }
    const body = newestFunctionBody("sms_kind_for");
    expect(body.length).toBeGreaterThan(400);
    const whens = [...body.matchAll(/WHEN\s+([\s\S]*?)\s+THEN\s+'([a-z_]+)'/g)].map((m) => ({ cond: m[1].split(/\sTHEN\s+NULL\s+WHEN\s/).pop()!.replace(/\s+/g, " "), kind: m[2] })); // A THEN NULL branch never texts: only what follows it is this branch.
    expect(whens.length).toBeGreaterThan(10);
    for (const w of whens) {
      // A shared type is only ever reached through an exact title.
      if (/'(warning|payment|financial_alerts|new_offers|application)'/.test(w.cond)) {
        expect(w.cond, w.cond).toMatch(/p_title\s*(=|IN)\s*/);
      }
      expect(w.cond).not.toMatch(/'(admin_alert|system_alert|verified|review)'/);
      expect(w.cond).not.toMatch(/Offer expired|Offer declined/);
    }
    // Exactly the kinds smsPolicy.ts has a fixed phrase for (plus the opt-in 'confirm').
    const kinds = new Set(whens.map((w) => w.kind));
    expect([...kinds].sort()).toEqual(Object.keys(SMS_KIND_PHRASES).filter((k) => k !== "confirm").sort());
  });

  // NO TEXT FOR A NEARBY OR MATCHING JOB (owner ruling 2026-10-23, Twilio A2P). Behaviour (a waiting one skipped, a
  // new one never queued, the claim never hands one out) is proved in src/test/pglite/smsNoNearbyJobTexts.pglite.mjs;
  // the sender's refusal in src/test/edge/sms-alerts.test.ts. These are the anchors.
  // @mutate supabase/migrations/20261030215251_job_notices_follow_job_switches.sql |     WHEN p_type = 'job_match' THEN NULL | WHEN p_type = 'job_match' THEN 'job_match'
  // @mutate supabase/functions/_shared/smsPolicy.ts |   job_offer: "New job offer. Answer before it expires.", |   job_offer: "New job offer. Answer before it expires.",\n  job_match: "A new job was posted near you.",
  it("a nearby-job (job_match) notification is never texted, and no text can be built for one", () => {
    const body = newestFunctionBody("sms_kind_for").replace(/\s+/g, " ");
    // The FIRST branch, so no later branch (e.g. info/success with a job) can catch one.
    expect(body).toMatch(/^ ?SELECT CASE WHEN p_type = 'job_match' THEN NULL WHEN /);
    expect(body).not.toMatch(/THEN 'job_match'/);
    expect(Object.keys(SMS_KIND_PHRASES)).not.toContain("job_match");
    const retire = blankSqlComments(readFileSync(resolve(MIG_DIR, "20261023181442_sms_no_nearby_job_texts.sql"), "utf8"));
    expect(retire.replace(/\s+/g, " ")).toContain("UPDATE public.sms_messages SET status = 'skipped', reason = 'job_match_texts_retired' WHERE status = 'pending' AND kind = 'job_match';");
    // The consent wording no longer offers them.
    expect(SMS_CONSENT_TEXT_BEFORE_LINKS).not.toMatch(/nearby|near you|new jobs/i);
  });

  // @mutate supabase/migrations/20261021193738_sms_alerts.sql |     ELSIF n.read IS TRUE THEN | ELSIF false THEN
  // @mutate supabase/migrations/20261021193738_sms_alerts.sql | v_kind, 'pending', now() + interval '3 minutes') | v_kind, 'pending', now())
  // @mutate supabase/migrations/20261021193738_sms_alerts.sql |     v_urgent := r.kind IN ('job_offer', 'starting_soon'); |     v_urgent := false;
  // @mutate supabase/migrations/20261021193738_sms_alerts.sql |       IF v_release > v_now THEN |       IF false THEN
  it("a text waits a few minutes, is dropped if the alert was read, and quiet hours defer it (urgent kinds excepted)", () => {
    // Behaviour is proved in src/test/pglite/smsAlerts.pglite.mjs; these are the rules' anchors.
    const fanOut = newestFunctionBody("sms_fan_out_on_notification").replace(/\s+/g, " ");
    expect(fanOut).toContain("v_kind, 'pending', now() + interval '3 minutes')");
    expect(fanOut).not.toMatch(/http_post|sms_post_to_edge/);
    const claim = newestFunctionBody("sms_claim_due").replace(/\s+/g, " ");
    expect(claim.length).toBeGreaterThan(1000);
    expect(claim).toContain("ELSIF n.read IS TRUE THEN v_reason := 'seen_in_app';");
    expect(claim).toContain("v_urgent := r.kind IN ('job_offer', 'starting_soon');");
    expect(claim).toContain("IF NOT v_urgent THEN v_release := public.sms_quiet_release(v_release, '21:00'::time, '08:00'::time);");
    expect(claim).toContain("IF v_release > v_now THEN UPDATE public.sms_messages SET due_at = v_release, reason = 'quiet_hours' WHERE id = r.id; CONTINUE;");
    // Only pending rows are ever claimed, oldest due first, two drains never take one row.
    expect(claim).toMatch(/WHERE status = 'pending' AND due_at <= v_now ORDER BY due_at .* FOR UPDATE SKIP LOCKED/);
  });

  // @mutate supabase/migrations/20261101022048_export_my_data_signup_source.sql |         CASE WHEN t.kind = 'confirm' THEN jsonb_build_object('id', t.id, 'kind', t.kind, 'category', t.category, 'created_at', t.created_at) |         CASE WHEN false THEN jsonb_build_object('id', t.id, 'kind', t.kind, 'category', t.category, 'created_at', t.created_at)
  // @mutate supabase/migrations/20261101022048_export_my_data_signup_source.sql | jsonb_agg(to_jsonb(t) - 'confirm_code' - 'confirm_phone' - 'confirm_sent_at' - 'updated_at') | jsonb_agg(to_jsonb(t))
  // @mutate supabase/migrations/20261023181442_sms_no_nearby_job_texts.sql |        WHERE pending_phone = v_phone AND confirm_phone = v_phone AND confirm_code = p_code\n         AND confirm_sent_at > now() - interval '24 hours';\n    END IF; |        WHERE pending_phone = v_phone\n         AND confirm_sent_at > now() - interval '24 hours';\n    END IF;
  it("Download My Data never says whether a number is used on another account (lh-authz-rls review)", () => {
    const ex = newestFunctionBody("export_my_data").replace(/\s+/g, " ");
    expect(ex.length).toBeGreaterThan(5000);
    expect(ex).toContain("CASE WHEN t.kind = 'confirm' THEN jsonb_build_object('id', t.id, 'kind', t.kind, 'category', t.category, 'created_at', t.created_at) ELSE to_jsonb(t) END");
    expect(ex).toContain("jsonb_agg(to_jsonb(t) - 'confirm_code' - 'confirm_phone' - 'confirm_sent_at' - 'updated_at')");
    // and the member's own read never returns the code or its stamp either
    expect(newestFunctionBody("get_my_sms_consent")).not.toMatch(/confirm_/);
    // A YES opts in only the account whose confirmation carried THAT code to THAT number.
    const yes = newestFunctionBody("sms_inbound_keyword").replace(/\s+/g, " ");
    expect(yes).toContain("WHERE pending_phone = v_phone AND confirm_phone = v_phone AND confirm_code = p_code AND confirm_sent_at > now() - interval '24 hours';");
  });

  it("messy phone input: the client accepts exactly what the server accepts", () => {
    const accepted: [string, string][] = [
      ["2255550123", "+12255550123"],
      ["(225) 555-0123", "+12255550123"],
      ["  225.555.0123  ", "+12255550123"],
      ["+1 225 555 0123", "+12255550123"],
      ["1-225-555-0123", "+12255550123"],
    ];
    for (const [input, e164] of accepted) expect(normalizeUsPhone(input), input).toBe(e164);
    const refused = [
      "", "   ", "555-0123", "225555012", "225555012345", "22555501234",
      "0255550123", "1255550123", "2250550123", "2251550123", "+44 20 7946 0958",
      "phone", "\u0662\u0662\u0665\u0665\u0665\u0665\u0660\u0661\u0662\u0663", "\u00a0".repeat(4),
    ];
    for (const input of refused) expect(normalizeUsPhone(input), JSON.stringify(input)).toBeNull();
    // An emoji or a stray letter around a real number is stripped, as the server's [^0-9] strip does.
    expect(normalizeUsPhone("225-555-0123 \u{1F4F1}x")).toBe("+12255550123");
    // The server's rule is the same regex, after the same strip and the same length cases.
    const sql = newestFunctionBody("sms_normalize_phone");
    expect(sql).toMatch(/regexp_replace\(COALESCE\(p_phone, ''\), '\[\^0-9\]', '', 'g'\)/);
    expect(sql).toMatch(/length\(d\) = 10 THEN\s+e := '\+1' \|\| d;/);
    expect(sql).toMatch(/length\(d\) = 11 AND left\(d, 1\) = '1' THEN/);
    expect(sql).toContain("'^\\+1[2-9][0-9]{2}[2-9][0-9]{6}$'");
  });
});

