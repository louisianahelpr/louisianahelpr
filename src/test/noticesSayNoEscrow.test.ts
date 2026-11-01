/**
 * MEMBERS NEVER READ "ESCROW", AND NOTICE TITLES CARRY NO EMOJI (list #19, audit E2 #5, #9, #11, #13).
 *
 * Built from what the migrations leave in the database (effectiveDefs reads rewrites too) and from the edge functions'
 * notice titles. A new sentence naming escrow fails unless it is listed below as text only an admin reads. The list is
 * exact both ways. "Fee" wording has its own guard: src/test/membersSeeNoFeeWords.test.ts.
 *
 * @mutate supabase/migrations/20261030220537_notices_say_no_escrow.sql | $q$'Payment secured'$q$ | $q$'Payment secured in escrow'$q$
 * @mutate supabase/migrations/20261030220537_notices_say_no_escrow.sql | $q$The money stays on hold until then$q$ | $q$The money stays in escrow until then$q$
 * @mutate supabase/functions/_shared/stalledCompletion.ts | so your payment is still on hold. | so your payment is still in escrow.
 * @mutate supabase/functions/_shared/notification-templates.ts | title: "Arrival confirmed", | title: "✅ Arrival confirmed",
 * @mutate supabase/functions/auto-expire-jobs/index.ts | link: `/post-job?rebook=${job.id}`, | link: "/post-job",
 * @mutate supabase/functions/_shared/declutterSellerEmail.ts | path: "/declutter?tab=selling", | path: "/declutter?view=selling",
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const ROOT = resolve(__dirname, "../..");
const fn = (p: string) => blankComments(readFileSync(resolve(ROOT, "supabase/functions", p), "utf8"));

/** Not member notices, read one by one 2026-10-30: admin alerts, ban review, dispute records, developer-facing RAISE and HINT text. */
const ADMIN_ESCROW_TEXT = new Set([
  "admin_alert_close_rule",
  "enforce_group_roster_award_gate",
  "enforce_job_completion_server_owned",
  "enforce_job_funded_before_award",
  "enforce_retained_payment_ban",
  "notify_ops_dispute_filed",
  "prevent_job_field_escalation",
  "rpc_decide_crew_dispute",
  "rpc_supersede_dispute_decision",
  "settle_dispute_by_chargeback",
  "settle_dispute_by_external_refund",
  "settle_dispute_record",
  "sweep_open_ban_settlement_reviews",
]);

/** Single-quoted literals with a space in them that name escrow: a sentence, never the 'escrow' status value. */
function escrowSentences(def: string): string[] {
  const code = blankSqlComments(def);
  return [...code.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1]).filter((s) => /\bescrow\b/i.test(s) && /\s/.test(s));
}

describe("notices say no escrow", () => {
  it("no SQL notice names escrow; the admin list is exact both ways", () => {
    const defs = effectiveDefs(resolve(ROOT, "supabase/migrations"));
    expect(defs.size).toBeGreaterThan(1000);
    const found = new Set<string>();
    for (const [name, def] of defs) if (escrowSentences(def.stmt).length > 0) found.add(name.replace(/\(.*$/, "").replace(/^public\./, ""));
    expect([...found].sort()).toEqual([...ADMIN_ESCROW_TEXT].sort());
  });

  it("the stalled-job notices say on hold", () => {
    const src = fn("_shared/stalledCompletion.ts");
    expect(src).toContain("so your payment is still on hold.");
    expect(src).toContain("The payment stays on hold until a person decides");
    expect(src).not.toMatch(/\bin escrow\b/);
  });
});

describe("notice titles carry no emoji", () => {
  const titles = (src: string) => [...src.matchAll(/\btitle:\s*[`"']([^`"']*)[`"']/g)].map((m) => m[1]);
  const EMOJI = /\p{Extended_Pictographic}/u;

  it("the shared templates and the job match alert", () => {
    const t = titles(fn("_shared/notification-templates.ts"));
    expect(t.length).toBeGreaterThan(5);
    // The hire offer's title moves in its own branch with the classifier that reads it (wip/b40-1030-job-notice-switches).
    expect(t.filter((x) => EMOJI.test(x) && x !== "📋 New job offer!")).toEqual([]);
    const match = fn("instant-job-match/index.ts");
    expect(match).not.toMatch(/categoryEmoji/);
    expect(titles(match).filter((x) => EMOJI.test(x) || x.includes("${emoji}"))).toEqual([]);
  });
});

describe("the links a notice opens", () => {
  it("an auto-cancelled job reposts itself", () => {
    const src = fn("auto-expire-jobs/index.ts");
    const at = src.indexOf('title: "Job auto-cancelled"');
    expect(at).toBeGreaterThan(0);
    const notice = src.slice(at, at + 900);
    expect(notice).toContain("link: `/post-job?rebook=${job.id}`");
    expect(notice).toContain("with no Helpr hired"); // owner 10-31: it expired, never "cancelled"
  });

  it("seller emails and payout lines use the one Declutter address", () => {
    expect(fn("_shared/declutterSellerEmail.ts")).toContain("/declutter?tab=selling");
    const payout = fn("stripe-payouts/payoutDetail.ts");
    expect(payout).toContain('"/declutter?tab=selling"');
    expect(payout).not.toContain("/declutter?view=selling");
  });

  it("the guard's inventory is real", () => {
    expect(readdirSync(resolve(ROOT, "supabase/functions")).length).toBeGreaterThan(50);
  });
});
