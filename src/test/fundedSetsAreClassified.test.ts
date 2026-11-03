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
 * @mutate supabase/migrations/20261102103429_poster_withdraws_an_offer.sql |   v_listed := public.job_payment_is_listed(v_job.payment_status); |   v_listed := v_job.payment_status = 'escrow';
 *
 * Q2448 (finding: lh-money-escrow@756b4e7602#8): the NEGATED form too. A "never paid" list (unpaid / abandoned /
 * failed: a status array or Set, a comparison chain, or a PostgREST .or() filter) decides 'held' by leaving it out
 * or putting it in, and two round-4 findings came through exactly that gap. Every such site in an edge function or
 * app file is in NEVER_PAID_SITES (exact both ways), classified: 'held-paid' (a held card counts as paid or live:
 * the list must NOT name 'held'), 'held-never-paid' (counts as never charged: it MUST), or 'exhaustive'.
 * @mutate src/components/job-card/ActivityDialogs.tsx |             props.cancelDialogJob.payment_status !== "failed" &&\n            // Q2399: a card only HELD was never charged; its hold is released, nothing refunded.\n            props.cancelDialogJob.payment_status !== "held" |             props.cancelDialogJob.payment_status !== "failed"
 * @mutate src/lib/neverPaidStatuses.ts | export const NEVER_PAID_STATUSES = ["unpaid", "abandoned", "failed"] as const; | export const NEVER_PAID_STATUSES = ["unpaid", "abandoned", "failed", "held"] as const;
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionExpired.ts |     const funded = !!job && !["unpaid", "failed", "abandoned"].includes(job.payment_status ?? "unpaid"); |     const funded = !!job && !["unpaid", "failed", "abandoned", "held"].includes(job.payment_status ?? "unpaid");
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
  // CMP-4 (20261101065105): a held card can be instantly booked (the capture comes at the 2-hour mark)
  "instant_book_block_reason", "instant_book_tell_helpr_on_close",
  // both: an offer is answered on a listed job, the hire completes on captured money
  "accept_job_offer", "respond_to_direct_offer", "enforce_job_funded_before_award",
  // Profile link (20261101041833): the member's open jobs on /u, the same funded set as open_jobs_browse (read only).
  "public_profile_by_handle",
  // Q2604 (20261102103429): the poster withdraws an unanswered offer on a listed job, a held card included (its
  // job_payment_is_listed decides whether a direct-offer Helpr is told); no money moves, the hold stays with the job.
  "rpc_poster_withdraw_offer",
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
  // Q2088 (20261103102100): Admin -> Payout Batches labels batches of jobs whose money is captured (payout set).
  "admin_payout_batch_money_modes",
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
  "supabase/functions/card-hold-sweep/index.ts": "captured", // instant pass: a job with no hold already funded = nothing to capture
  "supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts": "captured", // un-funds failed escrow
  "supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts": "captured", // Q1994: a PI on a job not already holding captured money ('held' included) is a closed job's; a bank one pages ops to refund
  "src/lib/capturedPayment.ts": "captured",
  "src/lib/posterSpend.ts": "captured", // charged money: a held card was not charged
  "src/lib/quotes/api.ts": "captured", // a quote job is charged when paid, never held
  "src/components/ResponseDeadlineDialog.tsx": "captured", // "was paid when you posted it": not true of a hold
  "src/components/admin/AdminAnalyticsDrilldowns.tsx": "captured",
  "src/pages/admin/Admin.tsx": "captured",
  "src/pages/post-job/PaymentSuccess.tsx": "captured", // "is held securely in escrow"; a held card has its own branch
  "src/pages/post-job/firstPaymentCollected.ts": "captured", // Q2115: other jobs whose money was collected; a held card was not
  "src/lib/statusLabels.ts": "exhaustive", // every jobs_payment_status_check value, 'held' included
};
const FUNDED_TS = /["']escrow["']\s*,\s*["']payout_pending["']\s*,\s*["']released["']/;

/**
 * Q2448: every NEGATED "never paid" list (holds 'unpaid' plus 'abandoned' or 'failed'), keyed by a substring of
 * its own code that is unique among the file's sites. 'held-paid': 'held' counts as paid or live (must not name it);
 * 'held-never-paid': 'held' was never charged (must name it); 'exhaustive': every payment status, 'held' included.
 */
const NEVER_PAID_SITES: Array<{ file: string; key: string; held: "held-paid" | "held-never-paid" | "exhaustive"; why: string }> = [
  { file: "src/components/job-card/ActivityDialogs.tsx", key: "props.cancelDialogJob.payment_status !==", held: "held-never-paid", why: "wasFunded: a held card was never charged, so the cancel dialog promises no refund (round-4 finding)" },
  { file: "src/components/profile/earningsTab/earningsTabHelpers.ts", key: "UNEARNED_PAYMENT_STATUSES", held: "held-never-paid", why: "a held card is not earnings" },
  { file: "src/lib/neverPaidStatuses.ts", key: "NEVER_PAID_STATUSES", held: "held-paid", why: "a held job is a live posted job: it shows in My Posts and Repost" },
  { file: "src/lib/statusLabels.ts", key: "PAYMENT_STATUSES", held: "exhaustive", why: "every jobs_payment_status_check value" },
  { file: "src/pages/post-job/maintenancePrefill.ts", key: "NEVER_FUNDED", held: "held-paid", why: "a held card keeps the maintenance request on its job (live, like funded)" },
  { file: "src/pages/post-job/useJobSubmit.ts", key: "pay === \"unpaid\"", held: "held-paid", why: "a held job is a live listing, never deleted as an unpaid draft" },
  { file: "supabase/functions/checkout-nudge-backfill/index.ts", key: "NUDGEABLE", held: "held-paid", why: "a held card needs no pay-now nudge" },
  { file: "supabase/functions/create-payment/index.ts", key: "RE_MINTABLE_PAYMENT_STATUSES", held: "held-paid", why: "a held job never re-mints a checkout over its hold" },
  { file: "supabase/functions/money-reconciliation/index.ts", key: "UNFUNDED_PAYMENT_STATES", held: "held-paid", why: "gift_spent_on_failed_payment: a gift on a held job is reserved for a live job, not stuck" },
  { file: "supabase/functions/stripe-webhook/handlers/chargeRefunded.ts", key: "REFUND_CLOSABLE_PAYMENT_STATES", held: "held-paid", why: "a held card is never refunded (a capture moves the job to escrow first), so 'held' is never refund-closed" },
  { file: "supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts", key: "jr.stripe_payment_intent_id !== thisPi", held: "held-paid", why: "a job held on another PaymentIntent is funded elsewhere (the escrow write never overwrites 'held')" },
  { file: "supabase/functions/stripe-webhook/handlers/checkoutSessionExpired.ts", key: ".in(\"payment_status\", [\"unpaid\", \"failed\"]", held: "held-paid", why: "an expired checkout never clears a held job's session" },
  { file: "supabase/functions/stripe-webhook/handlers/checkoutSessionExpired.ts", key: "const funded", held: "held-paid", why: "a held job's gift reservation is left alone (round-4 finding: the reserved gift on a failed hold)" },
  { file: "supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts", key: "isActionableStatus", held: "held-paid", why: "a failed capture of a hold is failHold's (card-hold path), never marked here" },
  { file: "supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts", key: "casFilter", held: "held-paid", why: "the failed-payment CAS never moves a held job" },
  { file: "supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts", key: "isStillUnpaid", held: "held-paid", why: "Q1994: a held job is never promoted to escrow by a PI it does not carry" },
  { file: "supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts", key: ".or(\"payment_status.is.null", held: "held-paid", why: "the ACH escrow flip never matches a held job" },
  { file: "supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts", key: "now.payment_status == null", held: "held-paid", why: "a held job read back is not unfunded-and-completed money at risk" },
];

/** Status words a negated never-paid site may name. */
const NEVER_WORDS = /["'](unpaid|abandoned|failed)["']|payment_status\.eq\.(unpaid|abandoned|failed)\b/g;
const NAMES_HELD = /["']held["']|payment_status\.eq\.held\b/;
/** The negated never-paid sites in one file's comment-blanked code: [the site's own text]. */
function neverPaidSites(code: string): string[] {
  const out: string[] = [];
  const isNeverPaid = (t: string) => {
    const w = new Set([...t.matchAll(NEVER_WORDS)].map((m) => m[1] ?? m[2]));
    return w.has("unpaid") && (w.has("abandoned") || w.has("failed"));
  };
  const statusAt = (end: number) => code.slice(Math.max(0, end - 160), end).replace(/\s+/g, " ");
  // (a) a status array literal, with the declaration or call it sits in (up to the end of the line it opens on).
  for (const m of code.matchAll(/\[\s*((?:["'][a-z_]+["']\s*,?\s*)+)\]/g)) {
    if (!isNeverPaid(m[0])) continue;
    const lineStart = code.lastIndexOf("\n", code.lastIndexOf("\n", m.index! - 1) - 1) + 1;
    out.push(`${code.slice(lineStart, m.index! + m[0].length).replace(/\s+/g, " ")}`);
  }
  // (b) a comparison chain of a payment status against string literals or null, joined by || / &&.
  const cmp = String.raw`[\w.?]+\s*[!=]==?\s*(?:["'][a-z_]+["']|null)`;
  for (const m of code.matchAll(new RegExp(String.raw`(?:${cmp}\s*\)?\s*(?:\|\||&&)\s*\(*\s*)+${cmp}`, "g"))) {
    if (!isNeverPaid(m[0])) continue;
    out.push(`${statusAt(m.index!)}${m[0].replace(/\s+/g, " ")}`);
  }
  // (c) a PostgREST filter string.
  for (const m of code.matchAll(/["'][^"'\n]*payment_status\.eq\.unpaid[^"'\n]*["']/g)) {
    if (!isNeverPaid(m[0])) continue;
    out.push(`${statusAt(m.index!)}${m[0]}`);
  }
  return out;
}

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
  it("Q2448: every negated never-paid list is classified for 'held', exactly both ways", () => {
    const edge = (readdirSync("supabase/functions", { recursive: true }) as string[]).map((f) => `supabase/functions/${f}`);
    const files = [...trackedFiles("src"), ...edge]
      .filter((f) => /\.(ts|tsx|mjs)$/.test(f))
      .filter((f) => !/\.test\.|\/test\/|\.spec\./.test(f));
    const found: Array<{ file: string; text: string }> = [];
    for (const f of files) for (const text of neverPaidSites(blankComments(readFileSync(f, "utf8")))) found.push({ file: f, text });
    expect(found.length, "negated never-paid sites found").toBeGreaterThan(10);
    const entryFor = (s: { file: string; text: string }) => NEVER_PAID_SITES.filter((e) => e.file === s.file && s.text.includes(e.key));
    const unclassified = found.filter((s) => entryFor(s).length !== 1).map((s) => `${s.file}: ${s.text.slice(-140)}`);
    expect(unclassified, "classify each new never-paid list in NEVER_PAID_SITES (held-paid / held-never-paid / exhaustive)").toEqual([]);
    const stale = NEVER_PAID_SITES.filter((e) => found.filter((s) => s.file === e.file && s.text.includes(e.key)).length !== 1);
    expect(stale.map((e) => `${e.file} ${e.key}`), "stale or ambiguous NEVER_PAID_SITES entry").toEqual([]);
    const wrong: string[] = [];
    for (const s of found) {
      const e = entryFor(s)[0];
      const named = NAMES_HELD.test(s.text);
      if (e.held === "held-paid" && named) wrong.push(`${s.file} (${e.key}) is held-paid but names 'held'`);
      if (e.held !== "held-paid" && !named) wrong.push(`${s.file} (${e.key}) is ${e.held} but does not name 'held'`);
    }
    expect(wrong).toEqual([]);
  });

  it("Q2448: a planted never-paid list is found, with and without 'held'", () => {
    expect(neverPaidSites(`const X = new Set(["unpaid", "failed"]);`)).toHaveLength(1);
    expect(neverPaidSites(`const ok = j.payment_status !== "unpaid" && j.payment_status !== "abandoned";`)).toHaveLength(1);
    expect(neverPaidSites(`q.or("payment_status.is.null,payment_status.eq.unpaid,payment_status.eq.abandoned")`)).toHaveLength(1);
    expect(NAMES_HELD.test(neverPaidSites(`const X = ["unpaid", "abandoned", "held"];`)[0] ?? "")).toBe(true);
    expect(neverPaidSites(`const X = ["unpaid"]; const y = j.payment_status === "escrow";`)).toHaveLength(0);
  });
});
