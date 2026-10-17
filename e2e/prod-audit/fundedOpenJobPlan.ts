/**
 * THE FUNDED OPEN JOB FIXTURE — the pure decision half (Q100).
 *
 * Ten prod-audit tests (deep-links ×3, interruptions `apply` ×7) and two
 * explore routes need "an open, escrowed job posted by poster-e2e that
 * helper-e2e has not applied to". Nothing but a real Stripe TEST checkout
 * produces that state: `create-payment` (action `escrow`) mints the Checkout
 * Session and `stripe-webhook`'s `checkout.session.completed` handler is the
 * only writer of `payment_status = 'escrow'`. `fundedOpenJob.ts` drives that
 * path; this file decides, from what prod holds right now, what it must do.
 *
 * Kept free of Playwright so src/test/fundedOpenJobPlan.test.ts can pin it.
 *
 * The rules, each for a reason:
 *  - REUSE a funded fixture row rather than pay again every run. Each
 *    interruptions test withdraws its own application in afterEach, so the
 *    same job serves every run.
 *  - REFRESH one whose `date_needed` is within MIN_RUNWAY_DAYS. auto-expire-jobs
 *    cancels an open job once its date passes and flips only `status`, so a
 *    fixture left to age out would sit `cancelled` + `escrow` — an orphaned
 *    escrow. Retiring it first goes through `cancel_escrow`, which refunds.
 *  - RETIRE every other funded fixture row (a duplicate from a concurrent run,
 *    or one helper-e2e has a stale application on), so at most one is held.
 *  - PAY an existing unpaid fixture row before minting a new one: a previous
 *    run whose checkout never completed left it, and `create-payment` re-mints
 *    on it through its own guarded path (it refuses when the prior session is
 *    live or paid, which is exactly when a second payment would be wrong).
 */

/** Title prefix every fixture row carries. NOT any sweeper marker (E2E-PRODAUDIT, PRESS DO NOT ACCEPT, E2E DO NOT ACCEPT): those delete or cancel on sight. */
export const FUNDED_FIXTURE_TITLE = "Prod audit funded fixture";

/** Days of `date_needed` runway a reused fixture must still have. */
export const MIN_RUNWAY_DAYS = 7;
/** How far out a freshly created fixture is dated. */
export const NEW_FIXTURE_DAYS = 30;

export interface FixtureRow {
  id: string;
  title: string;
  status: string;
  payment_status: string | null;
  helper_id: string | null;
  date_needed: string; // YYYY-MM-DD, Louisiana civil date
  created_at: string;
  /** jobs.stripe_session_id: its cs_test_ / cs_live_ prefix says which Stripe mode minted it. */
  stripe_session_id?: string | null;
}

/**
 * STRIPE IS LIVE ON PROD (owner switched it 2026-09-27). The mode is read, never
 * from a secret, from the prefix of the Checkout Session create-payment returns
 * (`stripeModeFromCheckoutUrl`, e2e/journeys/fixtures.ts); "unknown" until a
 * session has been minted this run, and treated as live for every money decision.
 */
export type StripeMode = "test" | "live" | "unknown";

/** Why a fixture that needs paying is skipped in live mode. The harness hands this to test.skip. */
export const LIVE_PAY_SKIP =
  "Stripe LIVE: owner decision 2026-09-27 \"nightly skips pay steps in live mode\" — a fixture that needs paying is not paid (no 4242 on a live checkout; the checkout page is never opened)";

/** Logged for a fixture a TEST key funded before the switch: cancel_escrow answers 500 "No such payment_intent" with the live key. */
export const PRE_LIVE_WHY = "pre-live test-mode fixture, not refundable with the live key";

/** A row minted in test mode while the mode is not (known to be) test: neither reuse, retire nor pay it. */
export function isPreLive(row: { stripe_session_id?: string | null }, mode: StripeMode): boolean {
  return mode !== "test" && /^cs_test_/.test(row.stripe_session_id ?? "");
}

/** Logged for a cs_test_ fixture held while this run's Stripe mode is still unknown: reused, never retired blind. */
export const UNKNOWN_MODE_HOLD_WHY = "Stripe mode not known yet this run: a cs_test_ fixture is reused, never cancel_escrow'd blind";

/**
 * Q1779: a cs_test_ row while the mode is still UNKNOWN (no session minted
 * this run yet, i.e. every fresh process). Since 2026-10-12 the shared test
 * accounts run on the TEST key, so such a row is a current fixture: REUSING
 * it moves no money and is always safe. Treating it as pre-live (as before)
 * made every fresh run mint another funded fixture and never retire one,
 * until poster-e2e hit the 5-open-jobs cap (core-loop-canary 38619494580).
 * Only RETIRING it (cancel_escrow) still waits for a known mode.
 */
export function isUnknownModeTestRow(row: { stripe_session_id?: string | null }, mode: StripeMode): boolean {
  return mode === "unknown" && /^cs_test_/.test(row.stripe_session_id ?? "");
}

/**
 * Q1779: the open-job cap budget of the shared poster account.
 *
 * enforce_open_job_limit (live pg_get_functiondef 2026-10-14) refuses a 6th
 * job while the poster holds 5 rows with status 'open' and a payment_status
 * outside ('unpaid','abandoned','failed'). By design poster-e2e holds two of
 * those for good (the browse fixture, scripts/e2e/browseFixture.mjs, and ONE
 * funded open fixture) plus at most one in passing (an accepted or dispute
 * fixture back at open, retired by the next run). Anything more is a leak
 * (fixtures minted and never retired), and it is caught here, by name, while
 * two slots are still free: not by a canary that dies on the cap's own error.
 */
export const OPEN_JOB_CAP = 5;
export const POSTER_OPEN_JOB_BUDGET = 3;
const NOT_COUNTED = new Set(["unpaid", "abandoned", "failed"]);

export interface CapRow { id: string; title: string; status: string; payment_status: string | null; created_at: string }

/** The rows enforce_open_job_limit counts. Mirrors its WHERE: status open AND COALESCE(payment_status,'') NOT IN (...). */
export function capCountedOpenJobs(rows: readonly CapRow[]): CapRow[] {
  return rows.filter((r) => r.status === "open" && !NOT_COUNTED.has(r.payment_status ?? ""));
}

/** Null while the poster is within budget; otherwise the failure message, naming every counted job. */
export function openJobBudgetProblem(rows: readonly CapRow[], who = "poster-e2e"): string | null {
  const counted = capCountedOpenJobs(rows);
  if (counted.length <= POSTER_OPEN_JOB_BUDGET) return null;
  const list = counted
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((r) => `${r.id} "${r.title}" ${r.payment_status} ${r.created_at}`)
    .join("; ");
  return `test account ${who} is accumulating open jobs (Q1779): ${counted.length} count toward the ${OPEN_JOB_CAP}-open-job cap, budget ${POSTER_OPEN_JOB_BUDGET}. ` +
    `Some run minted fixtures it never retired. Retire the extras (test-owned only) and fix the leak: ${list}`;
}

/** Left untouched entirely (neither reused, retired nor paid): a cs_test_ row once the run KNOWS it is live. */
const isPreLiveForPlan = (row: { stripe_session_id?: string | null }, mode: StripeMode) =>
  mode === "live" && /^cs_test_/.test(row.stripe_session_id ?? "");

export interface FixturePlan {
  /** The funded row to hand to the specs, as-is. */
  reuse: FixtureRow | null;
  /** Pay this row (an unpaid fixture) or a brand-new one ("new"); null when reusing. */
  pay: FixtureRow | "new" | null;
  /** Funded fixture rows to release through cancel_escrow, each with its reason. */
  retire: Array<{ row: FixtureRow; why: string }>;
  /** Pre-live test-mode rows left untouched (only present when there are some). */
  preLive?: Array<{ row: FixtureRow; why: string }>;
  /** Set (to LIVE_PAY_SKIP) only in live mode when the plan would otherwise pay. */
  skip?: string;
  /** Never-paid fixture rows to DELETE as poster-e2e (only present when there are some). */
  discard?: FixtureRow[];
}

/**
 * NEVER-PAID LEFTOVERS ARE DELETED, NOT HOARDED (lead lane, 2026-10-17).
 *
 * A run whose checkout never completed leaves its fixture row `unpaid`, and
 * void-cancelled-payments marks it `abandoned` an hour later. The plan re-pays
 * at most ONE such row, so every other one stayed open on poster-e2e for good:
 * measured 2026-10-17 05:05Z, eight open "Prod audit funded fixture" rows
 * (abandoned, created 10-09..10-13) beside the one in escrow. They hold no
 * money and no cap slot, but they are open jobs on the shared poster's Posts.
 *
 * Discarded: every never-paid row except the one this plan pays, limited to
 * what the poster's own DELETE policy ("Customers can delete their own jobs")
 * admits: `abandoned`, or `unpaid` with no Checkout Session. An `unpaid` row
 * WITH a session may be a checkout in flight; void-cancelled-payments abandons
 * it within the hour and the next run deletes it.
 */
export function discardableNeverPaid(rows: readonly FixtureRow[], keep: FixtureRow | null): FixtureRow[] {
  return rows.filter(
    (r) =>
      r !== keep &&
      r.status === "open" &&
      !r.helper_id &&
      (r.payment_status === "abandoned" || (r.payment_status === "unpaid" && !r.stripe_session_id)),
  );
}

const FUNDED = new Set(["escrow", "cancelling"]);
const REPAYABLE = new Set(["unpaid", "abandoned", "failed"]);

/**
 * helper-e2e's applications, by job id, as `applications.status`.
 * apply_to_job refuses ANY existing application ("Already applied to this job",
 * live pg_get_functiondef 2026-09-28: `COUNT(*) ... WHERE job_id AND helper_id`,
 * no status filter), and accept_application hires only a pending one. So a
 * fixture whose application is rejected/withdrawn (expire_unanswered_offers
 * rejects an unanswered offer and re-opens the job) can be neither applied to
 * nor hired: it is DEAD for helper-e2e (a11y-webkit-prod run 36352716213,
 * job 36eebad4, #1794).
 */
export type HelperApplications = ReadonlyMap<string, string>;
const isDeadFor = (apps: HelperApplications, jobId: string) => apps.has(jobId) && apps.get(jobId) !== "pending";
const nextAfterFunding = (apps: HelperApplications, jobId: string): "apply" | "hire" => (apps.get(jobId) === "pending" ? "hire" : "apply");

/** Whole days from `today` to `date` (both YYYY-MM-DD). */
export function daysBetween(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function planFundedOpenJob(
  rows: FixtureRow[],
  opts: { today: string; appliedJobIds: ReadonlySet<string>; mode?: StripeMode },
): FixturePlan {
  const mode = opts.mode ?? "test";
  const all = rows
    .filter((r) => r.title.startsWith(FUNDED_FIXTURE_TITLE) && r.status === "open" && !r.helper_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const preLive = all.filter((r) => isPreLiveForPlan(r, mode)).map((row) => ({ row, why: PRE_LIVE_WHY }));
  const mine = all.filter((r) => !isPreLiveForPlan(r, mode));
  const retire: FixturePlan["retire"] = [];
  // Q1779: while the mode is unknown a cs_test_ row is never retired blind; it is held (logged) instead.
  const retireOrHold = (row: FixtureRow, why: string) => {
    if (isUnknownModeTestRow(row, mode)) preLive.push({ row, why: `${UNKNOWN_MODE_HOLD_WHY} (would retire: ${why})` });
    else retire.push({ row, why });
  };
  let reuse: FixtureRow | null = null;
  for (const r of mine.filter((x) => FUNDED.has(x.payment_status ?? ""))) {
    const runway = daysBetween(opts.today, r.date_needed);
    if (r.payment_status === "cancelling") retireOrHold(r, "stuck in cancelling — finish the refund");
    else if (runway < MIN_RUNWAY_DAYS) retireOrHold(r, `only ${runway}d of runway (< ${MIN_RUNWAY_DAYS}); auto-expire would cancel it without a refund`);
    else if (opts.appliedJobIds.has(r.id)) retireOrHold(r, "helper-e2e has an application on it");
    else if (reuse) retireOrHold(r, `duplicate of ${reuse.id}`);
    else reuse = r;
  }
  const extra = preLive.length ? { preLive } : {};
  const withDiscard = (keep: FixtureRow | null) => {
    const discard = discardableNeverPaid(mine, keep);
    return discard.length ? { discard } : {};
  };
  if (reuse) return { reuse, pay: null, retire, ...extra, ...withDiscard(null) };
  if (mode === "live") return { reuse: null, pay: null, retire, ...extra, skip: LIVE_PAY_SKIP };
  const repayable = mine.find(
    (r) => REPAYABLE.has(r.payment_status ?? "unpaid") && daysBetween(opts.today, r.date_needed) >= MIN_RUNWAY_DAYS,
  );
  return { reuse: null, pay: repayable ?? "new", retire, ...extra, ...withDiscard(repayable ?? null) };
}

/**
 * THE DISPUTED JOB FIXTURE — the pure decision half (Q132).
 *
 * `explore: disputedJob-poster` / `-helper` (messy-input) open /jobs/<id> of
 * "a disputed job between poster-e2e and helper-e2e". prod-audit run
 * 35844514386 skipped both: none existed. The seed (scripts/audit/prod-seed.mjs)
 * opens one only when a funded pair job happens to be lying around, and the
 * lifecycle journeys complete and release theirs. So the prod-audit owns one:
 * a funded job of its own, helper-e2e applies, poster-e2e hires
 * (accept_application), poster-e2e opens a dispute (rpc_open_dispute) — the
 * app's own path at every step. It never borrows the in-progress / completed
 * pair jobs other explores read.
 *
 * A disputed fixture is REUSED indefinitely: a dispute on an is_seed job stays
 * open (auto-resolve-disputes skips is_seed jobs, 20260914183932) and holds
 * Stripe TEST money only. A fixture row left half-way (funded, applied or
 * hired, not yet disputed) by an interrupted run is RESUMED, never re-paid.
 */
export const DISPUTE_FIXTURE_TITLE = "Prod audit dispute fixture";

export interface DisputeRow {
  id: string;
  title: string;
  status: string;
  payment_status: string | null;
  helper_id: string | null;
  created_at: string;
}

export type DisputePlan =
  | { kind: "reuse"; row: DisputeRow }
  | { kind: "resume"; row: DisputeRow; next: "fund" | "apply" | "hire" | "dispute" }
  | { kind: "create" };

const HIRED = new Set(["accepted", "in_progress", "completed", "revision_requested"]);

/** `rows`: poster-e2e's own jobs titled DISPUTE_FIXTURE_TITLE*, newest first or not. */
export function planDisputedJob(
  rows: DisputeRow[],
  opts: { helperId: string; applications: HelperApplications },
): DisputePlan {
  const mine = rows
    .filter((r) => r.title.startsWith(DISPUTE_FIXTURE_TITLE))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const disputed = mine.find((r) => r.status === "disputed" && r.helper_id === opts.helperId);
  if (disputed) return { kind: "reuse", row: disputed };
  const hired = mine.find((r) => HIRED.has(r.status) && r.helper_id === opts.helperId && r.payment_status === "escrow");
  if (hired) return { kind: "resume", row: hired, next: "dispute" };
  // A row helper-e2e's closed application makes dead is skipped: create instead.
  const open = mine.find((r) => r.status === "open" && !r.helper_id && !isDeadFor(opts.applications, r.id));
  if (open && open.payment_status === "escrow") {
    return { kind: "resume", row: open, next: nextAfterFunding(opts.applications, open.id) };
  }
  if (open && REPAYABLE.has(open.payment_status ?? "unpaid")) return { kind: "resume", row: open, next: "fund" };
  return { kind: "create" };
}

/**
 * THE ACCEPTED JOB FIXTURE — the pure decision half (nightly-red #1794).
 *
 * The prod a11y sweep (e2e/a11y-prod/a11y-prod.spec.ts) renders /jobs/<id>
 * once per job_status, from poster-e2e's own is_seed jobs. In a11y-webkit-prod
 * run 36148473443 (2026-09-25) `accepted` had none — "no is_seed job in status
 * "accepted" owned by the poster on prod" — an unjustified skip on both
 * engines. Nothing owned that state: prod-seed.mjs lists it as "real flow",
 * and the only accepted seed rows were ones another run happened to hire and
 * leave. `accepted` is a waiting state, not a resting one: auto-expire-jobs
 * re-opens an accepted job whose helper has not confirmed by noon (Chicago)
 * the day before `date_needed`, and a journey starts, completes or disputes
 * its own. A borrowed accepted row always goes away.
 *
 * So the accepted state gets an owner, like the disputed one: a funded job of
 * its own, helper-e2e applies (apply_to_job), poster-e2e hires
 * (accept_application), helper-e2e confirms the offer (the app's Accept Job
 * write; unconfirmed, expire_unanswered_offers strikes helper-e2e at the
 * deadline), and it is LEFT accepted. The rules:
 *  - REUSE an accepted fixture hired to helper-e2e, escrowed, with at least
 *    MIN_RUNWAY_DAYS of `date_needed` runway. auto-expire-jobs only reads
 *    accepted jobs dated tomorrow or earlier, so a reused one stays accepted.
 *  - An accepted fixture with less runway is NOT touched: cancel_escrow
 *    refuses a hired job (only open with no Helpr), and cancelling it as the
 *    poster is the cancellation-fee ladder on a shared account. auto-expire-jobs
 *    re-opens it at its deadline; a later run then finds it open + escrow +
 *    short runway and RETIRES it through cancel_escrow (a refund), as the
 *    funded open fixture does.
 *  - RESUME a half-made one (funded, or funded and applied to) with runway,
 *    never paying twice; PAY an unpaid one with runway; else CREATE.
 */
export const ACCEPTED_FIXTURE_TITLE = "Prod audit accepted fixture";

export type AcceptedPlan = (
  | { kind: "reuse"; row: FixtureRow }
  | { kind: "resume"; row: FixtureRow; next: "fund" | "apply" | "hire" }
  | { kind: "create" }
  /** Live mode and the fixture would need paying: the harness skips with `why` (LIVE_PAY_SKIP). */
  | { kind: "skip"; why: string }
) & {
  /** Funded fixture rows back at open with short runway, to release through cancel_escrow, each with its reason. */
  retire: Array<{ row: FixtureRow; why: string }>;
  /** Pre-live test-mode rows left untouched (only present when there are some). */
  preLive?: Array<{ row: FixtureRow; why: string }>;
};

/** `rows`: poster-e2e's own jobs titled ACCEPTED_FIXTURE_TITLE*, in any order. */
export function planAcceptedJob(
  rows: FixtureRow[],
  opts: { today: string; helperId: string; applications: HelperApplications; mode?: StripeMode },
): AcceptedPlan {
  const mode = opts.mode ?? "test";
  const all = rows
    .filter((r) => r.title.startsWith(ACCEPTED_FIXTURE_TITLE))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const preLive = all.filter((r) => isPreLiveForPlan(r, mode)).map((row) => ({ row, why: PRE_LIVE_WHY }));
  const mine = all.filter((r) => !isPreLiveForPlan(r, mode));
  const runway = (r: FixtureRow) => daysBetween(opts.today, r.date_needed);
  const openAll = mine.filter((r) => r.status === "open" && !r.helper_id);
  const retireAll: AcceptedPlan["retire"] = openAll
    .filter((r) => FUNDED.has(r.payment_status ?? ""))
    .flatMap((row) =>
      runway(row) < MIN_RUNWAY_DAYS
        ? [{ row, why: `open again with only ${runway(row)}d of runway (< ${MIN_RUNWAY_DAYS}): release its escrow` }]
        : isDeadFor(opts.applications, row.id)
          ? [{ row, why: `helper-e2e's application on it is ${opts.applications.get(row.id)}: apply_to_job refuses a second, release its escrow` }]
          : [],
    );
  // Q1779: while the mode is unknown a cs_test_ row is never retired blind; it is held (logged) instead.
  const retire = retireAll.filter(({ row }) => !isUnknownModeTestRow(row, mode));
  for (const { row, why } of retireAll) {
    if (isUnknownModeTestRow(row, mode)) preLive.push({ row, why: `${UNKNOWN_MODE_HOLD_WHY} (would retire: ${why})` });
  }
  const extra = preLive.length ? { preLive } : {};
  const open = openAll.filter((r) => !isDeadFor(opts.applications, r.id));
  const accepted = mine.find(
    (r) => r.status === "accepted" && r.helper_id === opts.helperId && r.payment_status === "escrow" && runway(r) >= MIN_RUNWAY_DAYS,
  );
  if (accepted) return { kind: "reuse", row: accepted, retire, ...extra };
  const funded = open.find((r) => r.payment_status === "escrow" && runway(r) >= MIN_RUNWAY_DAYS);
  if (funded) return { kind: "resume", row: funded, next: nextAfterFunding(opts.applications, funded.id), retire, ...extra };
  if (mode === "live") return { kind: "skip", why: LIVE_PAY_SKIP, retire, ...extra };
  const unpaid = open.find((r) => REPAYABLE.has(r.payment_status ?? "unpaid") && runway(r) >= MIN_RUNWAY_DAYS);
  if (unpaid) return { kind: "resume", row: unpaid, next: "fund", retire, ...extra };
  return { kind: "create", retire, ...extra };
}
