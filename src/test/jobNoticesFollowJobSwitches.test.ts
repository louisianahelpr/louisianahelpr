/**
 * JOB NOTICES FOLLOW THE JOB SWITCHES (list #17, audit E2 #2 and #3).
 *
 * The bug: a Helpr cancelling, an offer declined or expired, a dispute and "hasn't confirmed yet" were type 'warning',
 * so the System alerts switch silenced them while their email followed Job updates. A hire offer was type 'info'
 * (Work status) while a direct offer was 'new_offers' (Job offers). The behaviour is proved in
 * src/test/pglite/jobNoticesFollowJobSwitches.pglite.mjs; these are the anchors, built from the newest definitions.
 *
 * @mutate supabase/migrations/20261030215251_job_notices_follow_job_switches.sql | 'Your Helpr cancelled', 'Your Helpr didn''t confirm', 'Offer declined', | 'Your Helpr didn''t confirm', 'Offer declined',
 * @mutate supabase/migrations/20261030215251_job_notices_follow_job_switches.sql | WHEN p_type IN ('warning', 'job_updates') AND p_title IN ('A dispute was opened', 'Job disputed') THEN 'dispute' | WHEN p_type = 'warning' AND p_title IN ('A dispute was opened', 'Job disputed') THEN 'dispute'
 * @mutate supabase/migrations/20261030215251_job_notices_follow_job_switches.sql | WHEN p_type = 'job_updates' AND p_title IN ('Offer declined', 'Offer expired', | WHEN p_type = 'job_updates' AND p_title IN ('Offer never',
 * @mutate supabase/functions/_shared/notification-templates.ts |         type: "new_offers",\n        link: jobPage(f), |         type: "info",\n        link: jobPage(f),
 * @mutate src/components/NotificationPanel.tsx | (n.type === "warning" \|\| n.title === "Your Helpr cancelled") && | n.type === "warning" &&
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const MIG_DIR = resolve(ROOT, "supabase/migrations");
const migrations = readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort().map((f) => blankSqlComments(readFileSync(resolve(MIG_DIR, f), "utf8")));

function newest(re: RegExp): string {
  let found = "";
  for (const sql of migrations) for (const m of sql.matchAll(re)) found = m[0];
  return found;
}
const titlesIn = (sql: string): string[] => [...sql.matchAll(/'((?:[^']|'')+)'/g)].map((m) => m[1].replace(/''/g, "'"));

const trigger = newest(/CREATE\s+TRIGGER\s+aa_notifications_job_notice_type\b[^;]*;/gi);
const moved = titlesIn(trigger.slice(trigger.search(/NEW\.title IN/), trigger.search(/AND COALESCE/)));
const backoutText = newest(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.backout_notice_text\s*\([\s\S]*?AS\s+(\$[A-Za-z_]*\$)[\s\S]*?\1/gi);
const smsKind = newest(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.sms_kind_for\s*\([\s\S]*?AS\s+(\$[A-Za-z_]*\$)[\s\S]*?\1/gi).replace(/\s+/g, " ");

describe("job notices follow the job switches (#17)", () => {
  it("the trigger reads warning rows and files them under job_updates, ahead of the triggers that read the type", () => {
    expect(trigger).toMatch(/BEFORE\s+INSERT/i);
    expect(trigger).toMatch(/NEW\.type = 'warning'/);
    // Fires by name: 'aa_' sorts ahead of suppress_exact_duplicate_notification and trg_notifications_reminder_choice.
    expect("aa_notifications_job_notice_type" < "suppress_exact_duplicate_notification").toBe(true);
    expect(moved.length).toBeGreaterThan(5);
    const body = newest(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.notifications_job_notice_type\s*\([\s\S]*?AS\s+(\$[A-Za-z_]*\$)[\s\S]*?\1/gi);
    expect(body).toMatch(/NEW\.type := 'job_updates'/);
  });

  it("every back-out title the poster reads is moved; a new one fails here", () => {
    const whens = [...backoutText.matchAll(/WHEN '(\w+)' THEN '((?:[^']|'')+)'/g)].map((m) => m[2].replace(/''/g, "'"));
    const titles = [...new Set(whens)].filter((t) => /^(Offer|Your Helpr)\b/.test(t));
    expect(titles.length).toBeGreaterThan(3);
    expect(titles.filter((t) => !moved.includes(t))).toEqual([]);
  });

  it("the always-on reminders keep the type job_reminder_types matches them on", () => {
    expect(moved).not.toContain("Job cancelled");
    expect(moved).not.toContain("Job reposted");
  });

  it("moving a notice changes no text: disputes and cancellations still text, the quiet ones get an explicit NULL", () => {
    expect(smsKind).toContain("WHEN p_type IN ('warning', 'job_updates') AND p_title IN ('A dispute was opened', 'Job disputed') THEN 'dispute'");
    expect(smsKind).toContain("WHEN p_type IN ('warning', 'job_updates') AND p_title = 'Your Helpr cancelled' THEN 'job_cancelled'");
    const quiet = smsKind.indexOf("WHEN p_type = 'job_updates' AND p_title IN ('Offer declined', 'Offer expired'");
    const catchAll = smsKind.indexOf("WHEN p_type IN ('job_updates', 'job_update', 'work_status', 'expired') AND p_job_id IS NOT NULL");
    expect(quiet).toBeGreaterThan(0);
    expect(catchAll).toBeGreaterThan(quiet);
    const quietTitles = titlesIn(smsKind.slice(quiet, smsKind.indexOf("THEN NULL", quiet)));
    for (const t of moved.filter((x) => !["Your Helpr cancelled", "A dispute was opened", "Job disputed"].includes(x))) expect(quietTitles).toContain(t);
  });

  it("a hire offer follows the switch a direct offer follows, and still texts", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "supabase/functions/_shared/notification-templates.ts"), "utf8"));
    const offer = src.slice(src.indexOf("job_offer: {"), src.indexOf("application_declined: {"));
    expect(offer).toContain('title: "New job offer"');
    expect(offer).toContain('type: "new_offers"');
    expect(smsKind).toContain("WHEN p_type = 'new_offers' AND p_title IN ('You got a direct job offer!', 'New job offer', '📋 New job offer!') THEN 'job_offer'");
  });

  it("the bell keeps its Repost pill on a moved cancellation", () => {
    const panel = blankComments(readFileSync(resolve(ROOT, "src/components/NotificationPanel.tsx"), "utf8"));
    expect(panel).toContain('(n.type === "warning" || n.title === "Your Helpr cancelled") &&');
  });
});
