/**
 * Part 3 message review (owner UI audit 11-09), wording only. Reads the NEWEST definition of each SQL notice producer
 * (effectiveDefs), comments blanked.
 *
 * F192 + F193: after a 3rd change request the person who posted read "⚠️ Scope creep detected" (jargon, emoji, an
 * accusing tone) and the Helpr "Admins have been notified." with no next step; both now say what happened, what they
 * can do, and call the people who settle problems "our team". Proof of unchanged behaviour:
 * src/test/pglite/revisionNoticeWording.pglite.mjs.
 *
 * @mutate supabase/migrations/20261109193417_revision_notices_plain_words.sql |         'Several changes asked on this job', |         '⚠️ Scope creep detected',
 * @mutate supabase/migrations/20261109193417_revision_notices_plain_words.sql | Our team can see this and will step in if needed. | Admins have been notified.
 *
 * F194: the role is "Helpr" in every member notice the edge functions send (it read "the helpr" in five), and the
 * expiring-job push drops "visibility" and "!".
 * @mutate supabase/functions/create-payment/index.ts | Payment was released to the Helpr.` | Payment was released to the helpr.`
 * @mutate supabase/functions/expiring-jobs-push/index.ts | nobody's been picked yet. Boost it so more Helprs see it.` | with no helpr yet. Boost it to get more visibility!`
 *
 * F193 (edge part): the edge functions' member notices call the people who step in "our team" (was "Helpr support").
 * One title stays: "Helpr support approved your job" is matched by text in jobs_notice_email_type (20261108214605).
 * @mutate supabase/functions/auto-resolve-disputes/index.ts | so our team will decide it. | so Helpr support will decide it.
 * @mutate supabase/functions/auto-release-payment/index.ts | so our team is reaching out to them. | so Helpr support is reaching out to them.
 * F195: "confirm completion to release payment" is gone from both marked-done notices.
 * @mutate supabase/functions/create-payment/index.ts | marked "${job.title}" done. Check the work and approve it.` | marked "${job.title}" as complete. Please confirm completion to release payment.`
 * F196: the referral cash-out notice names no Stripe account. F202: "Payout sent" (no "!") says where the money goes;
 * the ID check notice is "ID check done". F203: the test notice says the Louisiana time, 12-hour, never UTC.
 * @mutate supabase/functions/cash-out-credits/index.ts | in referral credit is on its way to your bank.` | in referral credits has been sent to your connected Stripe account.`
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |           title: "Payout sent", |           title: "Payout sent!",
 * @mutate supabase/functions/stripe-idv-webhook/index.ts |           title: "ID check done", |           title: "Verification Successful",
 * @mutate supabase/functions/_shared/notification-templates.ts | notifications are working. Sent ${selfTestSentAt(now)}.` | notifications are working. ${now.toISOString().slice(11, 19)} UTC`
 *
 * F196 (SQL) + F199: "Stripe ID" -> "ID check" in the accept-on-setup and offer-lapsed notices, "off-platform contact"
 * -> what it looked like in "Message hidden", and the seller-fault setup notice's title/fee words
 * (20261109211412; behaviour proof src/test/pglite/noticesPlainBackOfficeWords.pglite.mjs: wording only, --before red).
 * @mutate supabase/migrations/20261109211412_notices_plain_back_office_words.sql | 'Your payout setup and ID check are done, so you''ve accepted "' | 'Your payout setup and Stripe ID are done, so you''ve accepted "'
 * @mutate supabase/migrations/20261109211412_notices_plain_back_office_words.sql | PERFORM public.declutter_notify(j.customer_id, 'info', 'Setup job cancelled', | PERFORM public.declutter_notify(j.customer_id, 'info', 'Setup job cancelled, no fee',
 *
 * F197 + F198 + F193 (rest): one name for the card cost ("the card cost", never a fee name) and for who decides ("our team") across 32
 * Declutter / Shops / refund-request producers (20261109224952; proof src/test/pglite/noticesCardFeeOurTeam.pglite.mjs).
 * @mutate supabase/migrations/20261109224952_notices_card_fee_and_our_team.sql | so we''re refunding your payment. You blocked the seller, so the card cost isn''t refunded.' | so your payment is coming back to your card, minus what your card company charged, because you blocked the seller.'
 * @mutate supabase/migrations/20261109224952_notices_card_fee_and_our_team.sql | 'Our automatic check flagged "%s" (%s). Our team will look at it before you''re paid.' | 'Our automatic check flagged "%s" (%s). Someone from Louisiana Helpr will look at it before you''re paid.'
 * F177 (moved from Builder 4, lead 11-09): the dispute and warning notices say "our team", never "an admin"
 * (20261109215021; proof src/test/pglite/noticesOurTeamNoStrike.pglite.mjs).
 * @mutate supabase/migrations/20261109215021_notices_our_team_and_no_strike.sql | add your side so our team hears it.' | add your side so an admin hears it.'
 * F176: the trigger's "Job cancelled" notice says who cancelled; "You don't owe anything" only when the poster did, never
 * on a dispute decision (it can bill an at-fault Helpr) or an admin's cancel (20261109231855; behaviour proof, every
 * branch single + crew, src/test/pglite/jobCancelNoticeSaysWho.pglite.mjs, --before red).
 * @mutate supabase/migrations/20261109231855_job_cancel_notice_says_who.sql | WHEN OLD.status = 'disputed' THEN ' after our team decided the dispute.' | WHEN false THEN ' after our team decided the dispute.'
 * @mutate supabase/migrations/20261109231855_job_cancel_notice_says_who.sql | THEN ' by the person who posted it. You don''t owe anything, and it doesn''t count against you.' | THEN ' by the person who posted it.'
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { readFileSync } from "node:fs";
import { buildSelfTestNotification } from "../../supabase/functions/_shared/notification-templates";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const body = (fn: string) => blankSqlComments(DEFS.get(fn)?.stmt ?? "");

describe("F192/F193: the change-request notices are plain and name 'our team'", () => {
  it("track_revision_scope_creep's two member notices", () => {
    const b = body("track_revision_scope_creep");
    expect(b.length).toBeGreaterThan(500);
    expect(b).toContain("'Several changes asked on this job'");
    expect(b).toContain("ask our team to step in");
    expect(b).toContain("'Several changes asked on your job'");
    expect(b).toContain("Our team can see this and will step in if needed.");
    expect(b).not.toMatch(/⚠|Scope creep detected|Admins have been notified/);
    // The staff fraud flag keeps its own words (staff only).
    expect(b).toContain("'scope_creep'");
  });
});

describe("F194: 'Helpr' is capitalised in the edge functions' member notices", () => {
  const FILES = ["create-payment", "auto-expire-jobs", "expiring-jobs-push"].map((f) => `supabase/functions/${f}/index.ts`);
  it("no member notice message says a lower-case 'helpr'", () => {
    const hits: string[] = [];
    for (const f of FILES) {
      const code = blankComments(readFileSync(resolve(__dirname, "../..", f), "utf8"));
      // One literal per message, whichever quote it uses (a template holds "…" around the job title).
      for (const m of code.matchAll(/message:\s*(`[^`]*`|'[^']*'|"[^"]*")/g)) if (/\bhelpr\b/.test(m[1])) hits.push(`${f}: ${m[1].slice(0, 80)}`);
    }
    expect(FILES.length).toBe(3);
    expect(hits).toEqual([]);
  });

  it("the expiring-job push has no upsell jargon or exclamation", () => {
    const code = blankComments(readFileSync(resolve(__dirname, "../../supabase/functions/expiring-jobs-push/index.ts"), "utf8"));
    expect(code).toContain("Boost it so more Helprs see it.");
    expect(code).not.toMatch(/visibility!/);
  });
});


const edge = (f: string) => blankComments(readFileSync(resolve(__dirname, "../../supabase/functions", f), "utf8"));
/** Every message/title literal a notice insert in this file writes (one per key, whichever quote it uses). */
const literals = (code: string) => [...code.matchAll(/(?:message|title):\s*(`[^`]*`|'[^']*'|"[^"]*")/g)].map((m) => m[1]);

describe("F193/F195/F196/F202/F203: the edge functions' member notices (Part 3)", () => {
  const FILES = ["create-payment/index.ts", "payment-confirm-reminder/index.ts", "auto-resolve-disputes/index.ts", "auto-release-payment/index.ts", "_shared/notification-templates.ts"];
  it("F193: no member notice says 'Helpr support' except the one title the email list matches by text", () => {
    const hits: string[] = [];
    let n = 0;
    for (const f of FILES) {
      for (const lit of literals(edge(f))) {
        n++;
        if (/Helpr support/.test(lit) && lit !== '"Helpr support approved your job"') hits.push(`${f}: ${lit.slice(0, 90)}`);
      }
    }
    expect(n).toBeGreaterThan(50);
    expect(hits).toEqual([]);
    expect(edge("auto-resolve-disputes/index.ts")).toContain('title: "Our team will decide this dispute"');
  });

  it("F195: neither marked-done notice says 'confirm completion to release payment'", () => {
    const code = edge("create-payment/index.ts");
    expect(code).toContain('marked "${job.title}" done. Check the work and approve it.`');
    expect(code).toContain('marked it done. Check it and confirm it\'s finished.`');
    expect(code).not.toMatch(/confirm completion to release payment/);
  });

  it("F196: the referral cash-out notice names no Stripe account", () => {
    const code = edge("cash-out-credits/index.ts");
    expect(code).toContain("in referral credit is on its way to your bank.`");
    expect(literals(code).filter((l) => /Stripe/.test(l))).toEqual([]);
  });

  it("F202: 'Payout sent' says where the money goes; the ID check notice is 'ID check done'", () => {
    const pay = edge("process-scheduled-payouts/index.ts");
    expect(pay).toContain('title: "Payout sent",');
    expect(pay).toContain("is on its way to your bank${feeNote}.`");
    expect(pay).not.toContain('"Payout sent!"');
    const idv = edge("stripe-idv-webhook/index.ts");
    expect(idv).toContain('title: "ID check done",');
    expect(idv).not.toContain("Verification Successful");
  });
});

describe("F203: the test notice says the Louisiana time, 12-hour, never UTC", () => {
  it("a send at 21:42 UTC on Nov 9 reads 'Sent Mon, Nov 9 at 3:42 PM.'", () => {
    const n = buildSelfTestNotification(new Date("2026-11-09T21:42:00Z"));
    expect(n.message).toBe("If you got this, notifications are working. Sent Mon, Nov 9 at 3:42 PM.");
    expect(n.message).not.toMatch(/UTC/);
  });
});

describe("F196/F199: the SQL notices name no back-office word (Part 3)", () => {
  const FNS = ["complete_pending_accepts_on_setup", "expire_pending_direct_offers", "expire_unanswered_offers", "apply_message_scan_consequence", "declutter_apply_seller_fault"];
  /** The string literals of a function's newest definition. */
  const strings = (fn: string) => [...body(fn).matchAll(/'(?:[^']|'')*'/g)].map((m) => m[0]);
  it("no member notice string says 'Stripe ID' or 'off-platform contact'", () => {
    const all = FNS.flatMap((fn) => strings(fn).map((t) => `${fn}: ${t}`));
    expect(all.length).toBeGreaterThan(100);
    expect(all.filter((t) => /Stripe ID|off-platform contact or payment/.test(t))).toEqual([]);
    expect(body("complete_pending_accepts_on_setup")).toContain("payout setup and ID check are done");
    expect(body("apply_message_scan_consequence")).toContain("a phone number, email or outside payment");
  });
  it("F199: the seller-fault setup notice says what it keeps, under a title that does not say 'no fee'", () => {
    const b = body("declutter_apply_seller_fault");
    expect(b).toContain("'Setup job cancelled',");
    expect(b).toContain("except the one-time account setup fee.");
    expect(b).not.toMatch(/Setup job cancelled, no fee|excepted\)/);
  });
});

describe("F177: 'our team' in the dispute and warning notices (Part 3)", () => {
  /** A newest definition's string literals, its -- comments blanked (blankSqlComments in body()). */
  const strings = (fn: string) => [...body(fn).matchAll(/'(?:[^']|'')*'/g)].map((m) => m[0]);
  it("F177: no member notice in the dispute and warning producers says 'an admin'", () => {
    const fns = ["open_dispute_as", "rpc_escalate_dispute", "rpc_supersede_dispute_decision", "admin_reverse_violation"];
    const all = fns.flatMap((fn) => strings(fn).map((t) => `${fn}: ${t}`));
    expect(all.length).toBeGreaterThan(80);
    // Staff alerts (admin_alert rows, error codes) may name admins; member words may not.
    const member = all.filter((t) => /\b[Aa]n admin\b/.test(t) && !/needs an admin decision|another admin has to supersede|Re-opened by an admin/.test(t));
    expect(member).toEqual([]);
    expect(body("rpc_escalate_dispute")).toContain("'Our team will decide this dispute'");
  });
});

describe("F197/F198/F193: one name for the card cost and for who decides, in every SQL notice (Part 3)", () => {
  const FNS = ["declutter_accept_refund_with_return", "declutter_admin_decide_problem", "declutter_admin_decide_stuck_delivery", "declutter_answer_refund", "declutter_answer_refund_offer", "declutter_ask_refund", "declutter_complete_handover", "declutter_delivery_return_finish", "declutter_handover_sweep", "declutter_hold_unchecked_listings", "declutter_mark_order_paid", "declutter_porch_photo", "declutter_record_ai_check", "declutter_refund_after_handover", "declutter_seller_picked_up", "declutter_ship_sweep", "declutter_withdraw_problem", "helpr_task_cant_finish", "helpr_task_confirm", "helpr_task_customer_confirm", "helpr_task_sweep", "refund_agreements_due", "refund_requests_sweep", "respond_job_schedule_change", "rpc_open_refund_request", "shop_complete_handover", "shop_handover_sweep", "shop_lock_open_charged_order", "shop_preorder_sweep", "shops_admin_refund_order", "shops_buyer_cancel_order", "sweep_needs_you_reminders"];
  const strings = (fn: string) => [...body(fn).matchAll(/'(?:[^']|'')*'/g)].map((m) => `${fn}: ${m[0]}`);
  const all = FNS.flatMap(strings);
  it("reads every producer (floor)", () => {
    expect(FNS.length).toBe(32);
    expect(all.length).toBeGreaterThan(800);
  });
  it("F197: the card cost is only ever 'the card cost' (never a fee name)", () => {
    expect(all.filter((t) => /card network kept|what your card company charged|card payment cost|card-processing cost|what the card company keeps|card fee/.test(t))).toEqual([]);
    expect(all.filter((t) => /card cost/.test(t)).length).toBeGreaterThan(12);
  });
  it("F193: who decides is only ever 'our team'", () => {
    expect(all.filter((t) => /Louisiana Helpr decides|real person at Helpr|goes to Helpr|Someone from Louisiana Helpr/.test(t))).toEqual([]);
  });
  it("F198: the strike-removed notice is one fact a sentence, and names the block as why the card cost is kept", () => {
    expect(body("declutter_mark_order_paid")).toContain("The item''s hold had already ended, so we''re refunding your payment. You blocked the seller, so the card cost isn''t refunded.");
    expect(body("declutter_mark_order_paid")).not.toContain("minus what your card company charged, because you blocked the seller");
  });
});

describe("F176: the Job cancelled notice says who cancelled, and 'nothing owed' only when that is true", () => {
  const b = () => body("notify_on_job_update");
  it("one set of words, chosen by who cancelled, read by the single-Helpr and crew notices", () => {
    expect(b().length).toBeGreaterThan(2000);
    expect(b()).toContain("WHEN OLD.status = 'disputed' THEN ' after our team decided the dispute.'");
    expect(b()).toContain("WHEN NEW.cancelled_by IS NOT NULL AND NEW.cancelled_by = OLD.customer_id");
    expect(b()).toContain("THEN ' by the person who posted it. You don''t owe anything, and it doesn''t count against you.'");
    expect(b()).toContain("WHEN NEW.cancelled_by IS NOT NULL AND public.has_role(NEW.cancelled_by, 'admin') THEN ' by our team.'");
    expect(b().split("v_cancelled_words").length - 1).toBe(4); // declared, set, single notice, crew notice
  });
  it("the dispute case is decided before the poster case (a dispute decision can bill the Helpr)", () => {
    expect(b().indexOf("OLD.status = 'disputed'")).toBeGreaterThan(0);
    expect(b().indexOf("OLD.status = 'disputed'")).toBeLessThan(b().indexOf("NEW.cancelled_by = OLD.customer_id"));
  });
  it("no notice text claims the poster cancelled outside the poster case", () => {
    expect(b().split("by the person who posted it").length - 1).toBe(1);
  });
});
