/**
 * Q2399 (owner 2026-10-25): a job whose poster's card is only HELD is
 * payment_status 'held'. It is LISTED (browse, apply, alerts, offers) but
 * never FUNDED: no hire completes and no payout, refund, tip or dispute path
 * runs on it, because 'escrow' keeps meaning the money is captured.
 *
 * That only holds if every reader of the funded set is classified, so this
 * guard is built from the app's own inventory, both ways:
 *   - SQL: the NEWEST definition (any dollar tag, comments blanked) of every
 *     function and view, and every trigger WHEN, that reads the funded set
 *     ('escrow','payout_pending','released' or job_payment_is_funded()) must
 *     be in LISTED or CAPTURED below. A LISTED one must admit 'held' (or call
 *     job_payment_is_listed); a CAPTURED one must NOT. An entry that no
 *     longer reads the set fails too (the lists are exact).
 *   - TypeScript: every edge function and app file (comments blanked) that
 *     spells the funded triple must be in TS_CLASSIFIED, and a 'listed' file
 *     must read LISTED_PAYMENT_STATUSES.
 * A new reader that nobody classified is the defect this exists for: a
 * listing that hides held jobs, or a money path that runs on a hold.
 *
 * @mutate supabase/functions/expiring-jobs-push/index.ts |       .in("payment_status", LISTED_FOR_FINAL) |       .eq("payment_status", "escrow")
 * @mutate src/pages/jobs/jobPage/JobPage.tsx | (job.payment_status === "escrow" \|\| job.payment_status === "held") | job.payment_status === "escrow"
 * @mutate supabase/migrations/20261031000945_guests_get_no_poster_id_or_street.sql | AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text, 'held'::text])) AND (offered_to_helper_id | AND (payment_status = ANY (ARRAY['escrow'::text, 'payout_pending'::text, 'released'::text])) AND (offered_to_helper_id
 * @mutate supabase/migrations/20261027185146_card_hold_at_post.sql | IF NOT public.job_payment_is_listed(v_payment_status) THEN | IF NOT public.job_payment_is_funded(v_payment_status) THEN
 * @mutate supabase/functions/_shared/accountPurge.ts |   "payment_status.in.(escrow,payout_pending,held)"; |   "payment_status.in.(escrow,payout_pending)";
 * @mutate supabase/functions/instant-job-match/index.ts |     const FUNDED_PAYMENT_STATUSES = [...LISTED_PAYMENT_STATUSES]; |     const FUNDED_PAYMENT_STATUSES = ["escrow", "payout_pending", "released"];
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readdirSync, trackedFiles } from "./helpers/trackedFiles";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

/** A payment-status list that starts with the money states ('escrow', 'payout_pending', ...), or a predicate call. */
const FUNDED_SQL = /'escrow'(?:::text)?\s*,\s*'payout_pending'|job_payment_is_funded\s*\(|job_payment_is_listed\s*\(/;
/** Every status LIST that carries 'escrow' (an IN (...) or ARRAY[...]). */
const STATUS_LISTS = /\(\s*'escrow'[^)]*\)|ARRAY\s*\[\s*'escrow'[^\]]*\]/g;
/** Admits a held card: a status list with 'held' in it, or the listed predicate. */
function admitsHeld(code: string): boolean {
  if (/job_payment_is_listed\s*\(/.test(code)) return true;
  return [...code.matchAll(STATUS_LISTS)].some((m) => /'held'/.test(m[0]));
}

/** Posted and payable: must admit a held card. */
const LISTED = [
  "open_jobs_browse", "get_ranked_open_jobs", "get_open_jobs_for_map", "get_public_open_jobs", "job_announceable_to",
  "apply_to_job", "job_is_funded", "deliver_saved_search_alert", "notify_helpers_on_job_post", "notify_saved_searches_on_new_job",
  "notify_helper_on_direct_offer", "restart_direct_offer_clock_on_funding", "expire_pending_direct_offers",
  "get_my_pending_direct_offers", "jobs_offer_target_gone_retires_offer", "record_backout_notice", "direct_accept_block_reason",
  "enforce_group_roster_award_gate", "link_str_turnover_job", "rentals_request_job_state",
  // both: an offer is answered on a listed job, the hire completes on captured money
  "accept_job_offer", "respond_to_direct_offer", "enforce_job_funded_before_award",
  // Profile link (20261101041833): the member's open jobs on /u, the same funded set as open_jobs_browse (read only).
  "public_profile_by_handle",
  // the predicates themselves
  "job_payment_is_listed",
] as const;

/** Captured money only: must NOT admit a held card. */
const CAPTURED = [
  "job_payment_is_funded", "complete_job_accept", "payment_captured", "quote_job_funded_hires_quoter", "get_my_job_quotes",
  "cancel_quote_request", "auto_tip_candidates", "auto_tip_job_state", "ban_settlement_action", "settle_one_off_jobs_for_banned_account",
  "cancel_job_after_failed_bank_payment", "start_underfilled_crews", "sweep_unfilled_series_visit_reminders",
  "check_stale_dispute_settlement_claims", "claim_dispute_settlement", "report_stale_dispute_settlement_claim",
  "clear_test_mode_dispute_ledger", "rpc_clear_test_mode_dispute_refund_stamp", "rpc_clear_test_mode_dispute_stamp",
  "rpc_close_test_mode_dispute", "rpc_decide_crew_dispute", "rpc_supersede_dispute_decision", "sweep_disputes_closed_without_payment",
  "get_payout_batch_job_ids", "get_payout_batches", "admin_ban_settlement_reviews", "admin_list_business_accounts",
  "admin_queue_still_pending", "admin_section_funnel",
  // payout_after_hire (20261025162003, landed during the card-hold rebase): a Helpr may open a payout account, and is
  // reminded to, only once hired on CAPTURED money; on a held card the hire completes (and captures) first. NOTE: with
  // payout_after_hire off, a Helpr with no payout account could not complete a held hire (the accept waits on payout
  // setup, which waits on the capture); the switch is 'everyone' on prod since 2026-10-25.
  "payout_setup_hire_allowed", "claim_payout_setup_reminders",
] as const;

/** Trigger WHENs (newest CREATE TRIGGER of each name) that read the funded set: all four are the Helpr fan-outs. */
const LISTED_TRIGGERS = [
  "trg_notify_helpers_funded_insert", "trg_notify_helpers_funded_update",
  "trg_notify_saved_searches_funded_insert", "trg_notify_saved_searches_funded_update",
] as const;

/** Edge functions and app files that spell the funded triple. 'listed' ones must read LISTED_PAYMENT_STATUSES. */
const TS_CLASSIFIED: Record<string, "listed" | "captured" | "exhaustive"> = {
  "supabase/functions/_shared/listedPaymentStatus.ts": "listed",
  "supabase/functions/_shared/cardHold.ts": "captured", // captureCardHold: already funded = nothing to capture
  "supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts": "captured", // un-funds failed escrow
  "src/lib/capturedPayment.ts": "captured",
  "src/lib/posterSpend.ts": "captured", // charged money: a held card was not charged
  "src/lib/quotes/api.ts": "captured", // a quote job is charged when paid, never held
  "src/components/ResponseDeadlineDialog.tsx": "captured", // "was paid when you posted it": not true of a hold
  "src/components/admin/AdminAnalyticsDrilldowns.tsx": "captured",
  "src/pages/admin/Admin.tsx": "captured",
  "src/pages/post-job/PaymentSuccess.tsx": "captured", // "is held securely in escrow"; a held card has its own branch
  "src/lib/statusLabels.ts": "exhaustive", // every jobs_payment_status_check value, 'held' included
};
const FUNDED_TS = /["']escrow["']\s*,\s*["']payout_pending["']\s*,\s*["']released["']/;

/**
 * The NEWEST CREATE [OR REPLACE] FUNCTION / VIEW of every name across the
 * migrations, through its closing dollar tag (any tag) or, for a view, its
 * terminating semicolon; comments blanked before anything is read.
 */
function latestDefinitions(): Map<string, { name: string; file: string; text: string }> {
  const out = new Map<string, { name: string; file: string; text: string }>();
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  const head = /CREATE\s+(?:OR\s+REPLACE\s+)?(FUNCTION|VIEW)\s+(?:public\.)?"?([a-z_0-9]+)"?[\s(]/gi;
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
    for (const m of sql.matchAll(head)) {
      const rest = sql.slice(m.index);
      let end: number;
      if (m[1].toUpperCase() === "FUNCTION") {
        const tag = /\bAS\s+(\$[A-Za-z_]*\$)/i.exec(rest);
        if (!tag) continue;
        const close = rest.indexOf(tag[1], tag.index + tag[0].length);
        end = close < 0 ? rest.length : close + tag[1].length;
      } else {
        const semi = rest.search(/;\s*(\n|$)/);
        end = semi < 0 ? rest.length : semi + 1;
      }
      out.set(m[2], { name: m[2], file: f, text: rest.slice(0, end) });
    }
  }
  return out;
}

/** The newest CREATE TRIGGER statement of each name, comments blanked. */
function latestTriggers(): Map<string, string> {
  const out = new Map<string, string>();
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(`supabase/migrations/${f}`, "utf8"));
    for (const m of sql.matchAll(/CREATE\s+TRIGGER\s+"?([a-z_0-9]+)"?[\s\S]*?;/gi)) out.set(m[1], m[0]);
  }
  return out;
}

describe("every reader of the funded set is classified for card holds (Q2399)", () => {
  const defs = latestDefinitions();
  const readers = [...defs.values()].filter((d) => FUNDED_SQL.test(blankSqlComments(d.text)));

  it("the inventory is real (floors)", () => {
    expect(defs.size).toBeGreaterThan(900);
    expect(readers.length).toBeGreaterThan(40);
  });

  it("every SQL reader of the funded set is LISTED or CAPTURED, and every entry still reads it", () => {
    const classified = new Set<string>([...LISTED, ...CAPTURED]);
    const unclassified = readers.map((d) => d.name).filter((n) => !classified.has(n));
    expect(unclassified, "new readers of the funded set: classify each as LISTED (admits 'held') or CAPTURED").toEqual([]);
    const readerNames = new Set(readers.map((d) => d.name));
    const stale = [...classified].filter((n) => !readerNames.has(n) && n !== "job_payment_is_listed");
    expect(stale, "entries that no longer read the funded set: remove them").toEqual([]);
  });

  it("a LISTED object admits a held card; a CAPTURED one never does", () => {
    const code = (n: string) => blankSqlComments(defs.get(n)?.text ?? "");
    expect(LISTED.filter((n) => !admitsHeld(code(n))), "LISTED objects that hide a held job").toEqual([]);
    expect(CAPTURED.filter((n) => admitsHeld(code(n))), "CAPTURED objects that would act on a held card").toEqual([]);
  });

  it("the Helpr fan-out triggers fire on the move INTO listed, a held card included", () => {
    const trig = latestTriggers();
    const funded = [...trig].filter(([, t]) => FUNDED_SQL.test(t)).map(([n]) => n).sort();
    expect(funded).toEqual([...LISTED_TRIGGERS].sort());
    for (const n of LISTED_TRIGGERS) {
      // both the NEW and the OLD list carry it, so held -> escrow (the capture) announces nothing
      expect((trig.get(n)!.match(/'held'/g) ?? []).length, n).toBe(n.endsWith("_insert") ? 1 : 2);
    }
  });

  it("account deletion counts a held card as live work (lh-money-escrow review #5: a hire would charge a deleted poster's card)", () => {
    const purge = blankComments(readFileSync("supabase/functions/_shared/accountPurge.ts", "utf8"));
    const filter = /const LIVE_STATUS_FILTER =([\s\S]*?);/.exec(purge)?.[1] ?? "";
    expect(filter, "LIVE_STATUS_FILTER not found").toMatch(/payment_status\.in\.\(/);
    expect(filter).toMatch(/payment_status\.in\.\([^)]*\bheld\b/);
  });

  it("no read of an OPEN job's listing state tests 'escrow' alone (a held card is a live listing too)", () => {
    // Found in the 2026-10-25 rebase: the hire nudge (expiring-jobs-push, day-out and final reads) and the job
    // page's "No applicants yet" (board 57) read payment_status = 'escrow' for an open, unhired job, so a held
    // card's job got no nudge and no prompt. Inventory: every edge function and app file; a jobs read whose chain
    // filters status open AND payment_status by one value, or a client test of an open job against 'escrow' alone.
    const edge = (readdirSync("supabase/functions", { recursive: true }) as string[]).map((f) => `supabase/functions/${f}`);
    const files = [...trackedFiles("src"), ...edge]
      .filter((f) => /\.(ts|tsx|mjs)$/.test(f))
      .filter((f) => !/\.test\.|\/test\/|\.spec\./.test(f));
    const bad: string[] = [];
    let openReads = 0;
    for (const f of files) {
      const code = blankComments(readFileSync(f, "utf8"));
      for (const m of code.matchAll(/\.from\(\s*["']jobs["']\s*\)([\s\S]*?)(?:;|\bawait\b)/g)) {
        if (!/\.eq\(\s*["']status["']\s*,\s*["']open["']\s*\)/.test(m[1])) continue;
        openReads++;
        // 'escrow' or a named constant standing for it (FUNDED); an optimistic-concurrency echo of the row's own value is fine.
        if (/\.eq\(\s*["']payment_status["']\s*,\s*(?:["']escrow["']|[A-Z_]+\s*\))/.test(m[1])) bad.push(`${f}: ${m[1].replace(/\s+/g, " ").slice(0, 90)}`);
      }
      for (const m of code.matchAll(/\bopen\b[^\n;]{0,40}payment_status\s*===\s*["']escrow["'](?![^\n]{0,30}["']held["'])/g)) bad.push(`${f}: ${m[0]}`);
    }
    expect(openReads, "open-job reads found").toBeGreaterThan(3);
    expect(bad).toEqual([]);
  });

  it("every edge function and app file that spells the funded set is classified, and a listing reads LISTED_PAYMENT_STATUSES", () => {
    // trackedFiles indexes src/; the edge functions are walked (readdirSync is the real one outside src/).
    const edge = (readdirSync("supabase/functions", { recursive: true }) as string[]).map((f) => `supabase/functions/${f}`);
    const files = [...trackedFiles("src"), ...edge]
      .filter((f) => /\.(ts|tsx|mjs)$/.test(f))
      .filter((f) => !/\.test\.|\/test\/|\.spec\./.test(f));
    const spelled = files.filter((f) => FUNDED_TS.test(blankComments(readFileSync(f, "utf8"))));
    expect(spelled.length).toBeGreaterThan(5);
    expect(spelled.filter((f) => !(f in TS_CLASSIFIED)), "new funded-set spellings: classify them").toEqual([]);
    expect(Object.keys(TS_CLASSIFIED).filter((f) => !spelled.includes(f)), "entries that no longer spell it").toEqual([]);
    const listedUsers = files.filter((f) => /LISTED_PAYMENT_STATUSES/.test(blankComments(readFileSync(f, "utf8"))));
    for (const f of [
      "supabase/functions/expiring-jobs-push/index.ts",
      "supabase/functions/instant-job-match/index.ts", "supabase/functions/auto-expire-jobs/index.ts",
      "src/pages/post-job/useJobSubmit.ts", "src/components/admin/adminJobs/adminJobsHelpers.ts",
      "src/lib/declutter/setupHelpr.ts", "src/pages/post-job/turnoverPrefill.ts",
    ]) expect(listedUsers, f).toContain(f);
  });
});
