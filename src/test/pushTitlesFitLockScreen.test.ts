/**
 * Whole-app audit 11-10 (Worker 6), wording only (migration 20261110205345):
 *   F508 member-facing push titles longer than 40 characters are cut at the lock screen; every one is now <=40,
 *        and every title-keyed reader (declutter_notice_type, sms_kind_for, jobs_notice_email_type, the guarantee
 *        filing filter + trigger, both Declutter email triggers) lists the new title beside the old.
 *   F504 the manager-mode end notice names the person ("<Name> ended your Declutter access" / "<Name> stopped
 *        managing your Declutter"), not "Declutter managing ended".
 *   F509 the offer notice title carries no emoji, so the no-escrow copy guard needs no exemption for it.
 * Reads the NEWEST definition of each function (effectiveDefs) and the newest CREATE TRIGGER, comments blanked.
 *
 * @mutate supabase/migrations/20261112004748_declutter_seller_notices_name_the_buyer.sql | PERFORM public.declutter_notify(p_buyer, 'declutter_sales', 'Reserved: check out within 30 minutes', | PERFORM public.declutter_notify(p_buyer, 'declutter_sales', 'Reserved for you: check out within 30 minutes',
 * @mutate supabase/migrations/20261110205345_push_titles_fit_lock_screen.sql | AND NEW.title = 'Revision deadline passed: dispute opened' THEN | AND NEW.title = 'Revision deadline passed — dispute opened' THEN
 * @mutate supabase/migrations/20261110205345_push_titles_fit_lock_screen.sql | THEN format('%s ended your Declutter access', public.declutter_manager_first_name(v_uid)) | THEN 'Declutter managing ended'
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";
const defs = effectiveDefs(DIR);
const code = (fn: string) => {
  const s = blankSqlComments(defs.get(fn)?.stmt ?? "");
  expect(s.length, fn).toBeGreaterThan(200);
  return s;
};
const newestTrigger = (name: string): string => {
  let last = "";
  for (const f of migrationFiles(DIR)) {
    const sql = blankSqlComments(readFileSync(`${DIR}/${f}`, "utf8"));
    for (const m of sql.matchAll(new RegExp(`CREATE TRIGGER ${name}\\s+([\\s\\S]*?);`, "gi"))) last = m[1];
  }
  return last;
};

/** sender function -> [old title (SQL-quoted form), new title]. */
const RENAMES: Array<[string, string, string]> = [
  ["declutter_answer_bundle", "Bundle accepted: waiting for the buyer to pay", "Bundle accepted: waiting on payment"],
  ["declutter_delivery_gave_up_check", "Your delivery pay is being sent by our team", "Our team is sending your delivery pay"],
  ["declutter_answer_no_show", "Declutter problem: the other side answered", "Declutter problem: other side answered"],
  ["declutter_respond_swap", "Trade accepted: choose a pickup within 48 hours", "Trade accepted: pick a pickup time"],
  ["declutter_respond_swap", "Trade set: choose a pickup within 48 hours", "Trade set: pick a pickup time"],
  ["declutter_take_item", "It''s yours: pick a pickup within 48 hours", "It''s yours: pick a pickup time"],
  ["declutter_take_item", "Reserved for you: check out within 30 minutes", "Reserved: check out within 30 minutes"],
  ["declutter_take_item", "Reserved for you: check out within 24 hours", "Reserved for you: check out in 24 hours"],
  ["helpr_task_sweep", "Louisiana Helpr is looking at this delivery", "Our team is looking at this delivery"],
  ["notify_helpr_of_booking_clash", "You''re booked for two jobs at the same time", "Two jobs booked at the same time"],
  ["open_dispute_as", "Revision deadline passed — dispute opened", "Revision deadline passed: dispute opened"],
  ["sweep_dayof_confirm_reminders", "A Helpr on your crew hasn''t confirmed yet", "A crew Helpr hasn''t confirmed yet"],
  ["sweep_dayof_confirm_reminders", "Helprs on your crew haven''t confirmed yet", " crew Helprs haven''t confirmed yet"],
];

describe("11-10 push titles fit a lock screen", () => {
  it("F508: every renamed title is <=40 characters and the sender uses it, not the old one", () => {
    for (const [fn, oldT, newT] of RENAMES) {
      expect(newT.trim().replace(/''/g, "'").length, newT).toBeLessThanOrEqual(40);
      const s = code(fn);
      expect(s, `${fn} sends '${newT}'`).toContain(`'${newT}'`);
      expect(s, `${fn} still sends '${oldT}'`).not.toContain(`'${oldT}'`);
    }
  });

  it("F508: declutter_notice_type keeps the renamed Declutter titles on their pre-rename email type", () => {
    const s = code("declutter_notice_type");
    for (const t of ["It''s yours: pick a pickup time", "Reserved for you: check out in 24 hours",
      "Reserved: check out within 30 minutes", "Bundle accepted: waiting on payment"]) expect(s, t).toContain(`'${t}'`);
  });

  it("F508: sms_kind_for still skips the crew reminder; jobs_notice_email_type and the guarantee filter still see the dispute notice", () => {
    expect(code("sms_kind_for")).toContain("'A crew Helpr hasn''t confirmed yet'");
    expect(code("jobs_notice_email_type")).toContain("'Revision deadline passed: dispute opened'");
    expect(code("guarantee_filing_skips_revision_notice")).toContain(
      "AND NEW.title = 'Revision deadline passed: dispute opened' THEN",
    );
    expect(newestTrigger("aa_notifications_guarantee_filing")).toContain("NEW.title = 'Revision deadline passed: dispute opened'");
  });

  it("F508: both Declutter email triggers list the renamed trade titles", () => {
    const trade = newestTrigger("trg_email_declutter_trade_notice");
    expect(trade).toContain("'Trade accepted: pick a pickup time'");
    const notice = newestTrigger("trg_email_declutter_notice");
    expect(notice).toContain("'Trade accepted: pick a pickup time'");
    expect(notice).toContain("'Trade set: pick a pickup time'");
  });

  it("F504: the manager-mode end notice names the person on both sides", () => {
    const s = code("declutter_manager_end");
    expect(s).toContain("format('%s ended your Declutter access', public.declutter_manager_first_name(v_uid))");
    expect(s).toContain("format('%s stopped managing your Declutter', public.declutter_manager_first_name(v_uid))");
    expect(s).not.toContain("'Declutter managing ended'");
    expect(s).toContain("Sales already paid for still go through.");
    expect(s).not.toContain("Shares already locked on sales still pay.");
  });

  it("F509: the offer notice title has no emoji", () => {
    const src = readFileSync("supabase/functions/_shared/notification-templates.ts", "utf8");
    expect(src).toContain('title: "New job offer"');
    expect(src).not.toContain("📋 New job offer!");
  });
});
