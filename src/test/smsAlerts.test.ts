/**
 * SMS alerts (owner, 2026-10-20): the source-level rules that keep texts
 * private and consented.
 *   1. The consent wording version the client shows equals the one the server
 *      stamps (newest set_sms_consent definition).
 *   2. send-sms-notification never reads a notification's title or message:
 *      the text comes only from sms_claim's `kind` (+ job uuid).
 *   3. 'warning' and the admin/system/payment types never reach the SMS trigger.
 * Behaviour (consent, caps, quiet hours, seed suppression, STOP) is proved in
 * PGlite: ~/.lh-pglite/pgl-sms-1020.mjs (38 checks) and in
 * src/test/edge/sms-alerts.test.ts.
 */
// @mutate src/lib/smsConsent.ts | export const SMS_CONSENT_TEXT_VERSION = "sms-v1"; | export const SMS_CONSENT_TEXT_VERSION = "sms-v2";
// @mutate supabase/functions/send-sms-notification/index.ts | jobId: claim.job_id, | jobId: claim.job_id, title: (claim as { title?: string }).title,
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { SMS_CONSENT_TEXT_VERSION } from "@/lib/smsConsent";

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
  it("the client's consent wording version is the one set_sms_consent stamps", () => {
    const body = newestFunctionBody("set_sms_consent");
    expect(body.length).toBeGreaterThan(200);
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
    expect([...claimFields].sort()).toEqual(["action", "first_text", "job_id", "kind", "phone", "reason", "sms_id"]);
    expect(src).not.toMatch(/\btitle\b/);
    expect(src).not.toMatch(/from\(\s*['"]notifications['"]/);
  });

  it("the SMS trigger never fires for warning/admin/system/payment types", () => {
    const trg = newestTrigger("notifications_fan_out_to_sms");
    expect(trg).toMatch(/AFTER\s+INSERT\s+ON\s+public\.notifications/i);
    const types = [...(trg.match(/IN\s*\(([^)]*)\)/i)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(types.length).toBeGreaterThan(5);
    for (const banned of ["warning", "admin_alert", "system_alert", "payment", "financial_alerts", "verified", "review", "application"]) {
      expect(types).not.toContain(banned);
    }
    const cat = newestFunctionBody("sms_category_for");
    expect(cat).not.toMatch(/'warning'/);
  });
});
