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
}

export interface FixturePlan {
  /** The funded row to hand to the specs, as-is. */
  reuse: FixtureRow | null;
  /** Pay this row (an unpaid fixture) or a brand-new one ("new"); null when reusing. */
  pay: FixtureRow | "new" | null;
  /** Funded fixture rows to release through cancel_escrow, each with its reason. */
  retire: Array<{ row: FixtureRow; why: string }>;
}

const FUNDED = new Set(["escrow", "cancelling"]);
const REPAYABLE = new Set(["unpaid", "abandoned", "failed"]);

/** Whole days from `today` to `date` (both YYYY-MM-DD). */
export function daysBetween(today: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}

export function planFundedOpenJob(
  rows: FixtureRow[],
  opts: { today: string; appliedJobIds: ReadonlySet<string> },
): FixturePlan {
  const mine = rows
    .filter((r) => r.title.startsWith(FUNDED_FIXTURE_TITLE) && r.status === "open" && !r.helper_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const retire: FixturePlan["retire"] = [];
  let reuse: FixtureRow | null = null;
  for (const r of mine.filter((x) => FUNDED.has(x.payment_status ?? ""))) {
    const runway = daysBetween(opts.today, r.date_needed);
    if (r.payment_status === "cancelling") retire.push({ row: r, why: "stuck in cancelling — finish the refund" });
    else if (runway < MIN_RUNWAY_DAYS) retire.push({ row: r, why: `only ${runway}d of runway (< ${MIN_RUNWAY_DAYS}); auto-expire would cancel it without a refund` });
    else if (opts.appliedJobIds.has(r.id)) retire.push({ row: r, why: "helper-e2e has an application on it" });
    else if (reuse) retire.push({ row: r, why: `duplicate of ${reuse.id}` });
    else reuse = r;
  }
  if (reuse) return { reuse, pay: null, retire };
  const repayable = mine.find(
    (r) => REPAYABLE.has(r.payment_status ?? "unpaid") && daysBetween(opts.today, r.date_needed) >= MIN_RUNWAY_DAYS,
  );
  return { reuse: null, pay: repayable ?? "new", retire };
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
  opts: { helperId: string; appliedJobIds: ReadonlySet<string> },
): DisputePlan {
  const mine = rows
    .filter((r) => r.title.startsWith(DISPUTE_FIXTURE_TITLE))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const disputed = mine.find((r) => r.status === "disputed" && r.helper_id === opts.helperId);
  if (disputed) return { kind: "reuse", row: disputed };
  const hired = mine.find((r) => HIRED.has(r.status) && r.helper_id === opts.helperId && r.payment_status === "escrow");
  if (hired) return { kind: "resume", row: hired, next: "dispute" };
  const open = mine.find((r) => r.status === "open" && !r.helper_id);
  if (open && open.payment_status === "escrow") {
    return { kind: "resume", row: open, next: opts.appliedJobIds.has(open.id) ? "hire" : "apply" };
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
 * (accept_application), and it is LEFT accepted. The rules:
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
) & {
  /** Funded fixture rows back at open with short runway, to release through cancel_escrow, each with its reason. */
  retire: Array<{ row: FixtureRow; why: string }>;
};

/** `rows`: poster-e2e's own jobs titled ACCEPTED_FIXTURE_TITLE*, in any order. */
export function planAcceptedJob(
  rows: FixtureRow[],
  opts: { today: string; helperId: string; appliedJobIds: ReadonlySet<string> },
): AcceptedPlan {
  const mine = rows
    .filter((r) => r.title.startsWith(ACCEPTED_FIXTURE_TITLE))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const runway = (r: FixtureRow) => daysBetween(opts.today, r.date_needed);
  const open = mine.filter((r) => r.status === "open" && !r.helper_id);
  const retire: AcceptedPlan["retire"] = open
    .filter((r) => FUNDED.has(r.payment_status ?? "") && runway(r) < MIN_RUNWAY_DAYS)
    .map((row) => ({ row, why: `open again with only ${runway(row)}d of runway (< ${MIN_RUNWAY_DAYS}): release its escrow` }));
  const accepted = mine.find(
    (r) => r.status === "accepted" && r.helper_id === opts.helperId && r.payment_status === "escrow" && runway(r) >= MIN_RUNWAY_DAYS,
  );
  if (accepted) return { kind: "reuse", row: accepted, retire };
  const funded = open.find((r) => r.payment_status === "escrow" && runway(r) >= MIN_RUNWAY_DAYS);
  if (funded) return { kind: "resume", row: funded, next: opts.appliedJobIds.has(funded.id) ? "hire" : "apply", retire };
  const unpaid = open.find((r) => REPAYABLE.has(r.payment_status ?? "unpaid") && runway(r) >= MIN_RUNWAY_DAYS);
  if (unpaid) return { kind: "resume", row: unpaid, next: "fund", retire };
  return { kind: "create", retire };
}
