import { postedActivityBucket, appliedActivityBucket, jobIsUnfundedDraft } from "@/components/job-card/activityFilters";
import type { Job, AppliedApp } from "@/components/job-card/activityConstants";
import { backoutNoticeApplies, type BackoutNotice } from "@/lib/backoutNotices";
import type { ShopOrder } from "@/lib/shops/orders";
import type { CartLine, FreeAskToPick, MyOffer } from "@/lib/declutter/api";
import type { MyRefundTodo } from "@/lib/declutter/refundRequests";
import { formatCents } from "@/lib/shops/formatCents";
import { posterStatusLine, helperStatusLine, type JobStatusLine } from "@/components/job-card/jobStatusLine";
import { jobStartTarget } from "@/components/job-card/CountdownRows";
import { jobProgress } from "@/components/tracker/jobProgressState";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import { continueDayNextStep, continueDayWords, type ContinueDay } from "@/lib/continueDayWords";

export interface TodoItem {
  id: string;
  /** Which section the to-do belongs to: the nav counts are per section. */
  section: "jobs" | "shops" | "declutter";
  /** The TASK (spec v2 §5.2: "title = the task"), never just the job's name. */
  title: string;
  /** Which side you are on, then the job or order it is about ("You hired · Mow the lawn"). */
  meta: string;
  to: string;
  /** The Next up card's one button (sentence case). */
  action: string;
  /** A real amount tied to the task (rust on Home); omitted when there is none. */
  money?: string;
  /**
   * JA-39: the Helpr step the button takes (the Working card's face rule, helperStepRequest.ts): Home leaves the
   * one-shot request and opens the job's Working card, whose tracker presses its OWN button, so every gate (GPS,
   * photos) still decides. Omitted for a task that only opens a page.
   */
  helperStep?: { jobId: string; key: "arrived" };
}

export interface NeedsYouInputs {
  postedJobs: readonly Job[];
  pendingApplicantCounts: Readonly<Record<string, number>>;
  appliedApps: readonly AppliedApp[];
  shopOrders: readonly ShopOrder[];
  backout: ReadonlyMap<string, BackoutNotice>;
  /** A3-81: the member's Declutter cart lines and offers (the Buying / Selling tabs' own reads). */
  declutterCart?: readonly CartLine[];
  declutterOffers?: readonly MyOffer[];
  /** A3-81: refund requests waiting on the member (declutter_my_refund_todos) and the giver's free asks to pick from. */
  declutterRefunds?: readonly MyRefundTodo[];
  declutterFreeAsks?: readonly FreeAskToPick[];
  /** The active continue days of my jobs under way, by job id (useContinueDays). */
  continueDays?: Readonly<Record<string, ContinueDay>>;
}

/** "$30" for whole dollars (garage-sale prices), "$7.50" otherwise. */
const dollars = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : formatCents(cents));

/** "Mon 2:00 PM" in Louisiana time: the Declutter to-do's "by" (the offer's respond_by, the cart's checkout_by). */
function byWhen(ms: number): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "short" });
  const time = d.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" });
  return `${day} ${time}`;
}

/**
 * A3-81 (audit 11-01, High): what needs the member on Declutter, from the SAME rules as the Buying / Selling badges
 * (src/lib/declutter/tabs.ts declutterTodo): an offer waiting on their answer (either side), a cart checkout still
 * inside its time (one per seller: one checkout per seller), and a paid pickup order still in its handover. Each
 * carries its deadline when it has one. A Helpr-delivered order is left out (the Helpr does the handover).
 */
function declutterTodos(
  cart: readonly CartLine[],
  offers: readonly MyOffer[],
  now: number,
  refunds: readonly MyRefundTodo[] = [],
  freeAsks: readonly FreeAskToPick[] = [],
): { item: TodoItem; due: number | null; waiting: boolean }[] {
  const out: { item: TodoItem; due: number | null; waiting: boolean }[] = [];
  // A3-81 (a), first: a refund request waiting on the member. The seller answers within 24 hours (answer_by), or it
  // goes to Louisiana Helpr; a buyer answers the seller's part offer by offer_answer_by.
  for (const r of refunds) {
    const due = Date.parse(r.due_at);
    if (!Number.isFinite(due) || due < now) continue;
    const seller = r.my_side === "seller";
    const what = r.title ? (r.item_count > 1 ? `${r.title} + ${r.item_count - 1} more` : r.title) : "your order";
    out.push({
      due,
      waiting: true,
      item: {
        id: `dr-${r.request_id}`,
        section: "declutter",
        title: seller ? "Answer a refund request" : "Answer the seller's refund offer",
        meta: `${seller ? "Selling" : "Buying"} · ${what} · by ${byWhen(due)}`,
        to: `/declutter?tab=${seller ? "selling" : "buying"}`,
        action: seller ? "Answer request" : "Answer offer",
      },
    });
  }
  for (const o of offers) {
    if (o.status !== "open" || o.awaiting !== o.my_side) continue;
    const due = Date.parse(o.respond_by);
    const live = Number.isFinite(due) && due >= now ? due : null;
    if (Number.isFinite(due) && due < now) continue;
    const seller = o.my_side === "seller";
    out.push({
      due: live,
      waiting: true,
      item: {
        id: `do-${o.offer_id}`,
        section: "declutter",
        // The amount is in the task itself, so no money line repeats it (Home prints money as "order total").
        title: seller ? `Answer a ${dollars(o.amount_cents)} offer` : `Answer the seller's ${dollars(o.amount_cents)} counteroffer`,
        meta: `${seller ? "Selling" : "Buying"} · ${o.item_title}${live ? ` · by ${byWhen(live)}` : ""}`,
        to: `/declutter?tab=${seller ? "selling" : "buying"}`,
        action: "Answer offer",
      },
    });
  }
  const checkouts = new Map<string, CartLine[]>();
  for (const l of cart) {
    if (l.my_side !== "buyer" || l.status !== "in_cart" || !(Date.parse(l.checkout_by) > now)) continue;
    const k = l.seller_id ?? l.line_id;
    checkouts.set(k, [...(checkouts.get(k) ?? []), l]);
  }
  for (const [k, lines] of checkouts) {
    const due = Math.min(...lines.map((l) => Date.parse(l.checkout_by)));
    out.push({
      due,
      waiting: true,
      item: {
        id: `dc-${k}`,
        section: "declutter",
        title: lines.length === 1 ? `Check out ${lines[0].item_title}` : `Check out ${lines.length} items`,
        meta: `Buying · by ${byWhen(due)}`,
        to: "/declutter?tab=buying",
        action: "Check out",
        money: dollars(lines.reduce((s, l) => s + l.price_cents, 0)),
      },
    });
  }
  const orders = new Map<string, CartLine>();
  for (const l of cart) {
    if (l.status !== "paid" || !l.order_id || l.order_status !== "paid" || l.handover === "delivery") continue;
    if (!orders.has(l.order_id)) orders.set(l.order_id, l);
  }
  for (const [id, l] of orders) {
    const seller = l.my_side === "seller";
    out.push({
      due: null,
      waiting: true,
      item: {
        id: `dh-${id}`,
        section: "declutter",
        title: seller ? `Hand over ${l.item_title}` : `Pick up ${l.item_title}`,
        meta: seller ? "Selling · sold, waiting for the handover" : "Buying · paid, waiting for the pickup",
        to: `/declutter?tab=${seller ? "selling" : "buying"}`,
        action: seller ? "Open sale" : "Open order",
      },
    });
  }
  // A3-81 (b): the free giver picks who gets the item (no deadline: the server sets none).
  for (const f of freeAsks) {
    if (f.asked < 1) continue;
    out.push({
      due: null,
      waiting: true,
      item: {
        id: `df-${f.item_id}`,
        section: "declutter",
        title: `Pick who gets ${f.title}`,
        meta: `Free · ${f.asked} asked`,
        to: `/declutter/item/${f.item_id}`,
        action: "Pick",
      },
    });
  }
  return out;
}

/** An open back-out notice rides on its job, as useActivityData does it (Q1575). */
function withBackout<J extends { id: string; status?: string | null }>(j: J, backout: ReadonlyMap<string, BackoutNotice>): J {
  const open = backout.get(j.id);
  return open && backoutNoticeApplies(open.backout_kind, j.status) ? { ...j, backout_notice: open } : j;
}

/** JA-39: the on-the-way Helpr's Next up task. */
export const ON_THE_WAY_TASK = "Tap I've arrived when you get there";
/** JA-39: its button, the Working card's own step label (helperFaceAction.ts: key "arrived"). */
export const ARRIVED_ACTION = "I've arrived";
/**
 * JA-39: which side of the job the Helpr is on, by where the job stands (never "working" before they arrive).
 * A3-84 (audit 11-01): hired, offered, confirmed and confirm-due read "You're hired" (the confirm-due Home row said
 * "Confirm you'll be at the job · You're working"); "You're working" only from arrival.
 */
function helprSide(job: Job, lineId: string): string {
  if (!job.helper_id) return "You applied";
  if (lineId === "on_the_way") return "You're on the way";
  return (job as { helper_arrived_at?: string | null }).helper_arrived_at ? "You're working" : "You're hired";
}
const HOUR = 3_600_000;
/** A3-83: the poster's step when the Helpr marked it done (or fixed what was asked): its Next up button. */
export const REVIEW_WORK_ACTION = "Review work";
const POSTER_REVIEW_STEPS = new Set(["approve", "revision_fixed"]);

/** Spec v2 §5.2 tier 2: someone is waiting on the member (applicants, an offer, an order, a finished job). */
const POSTER_SOMEONE_WAITING = new Set(["applicants", "approve", "revision_fixed", "confirm_arrival"]);
const HELPER_SOMEONE_WAITING = new Set(["offer", "confirm_booking", "confirm_spot", "revision"]);

/**
 * When a to-do's clock runs out, if it has one STILL AHEAD: the status line's
 * own countdown (the one the card shows), else the job's start when that is
 * still to come. A passed clock is not a deadline any more (the card says
 * "expired" or the job is overdue), so it does not jump the queue.
 */
function dueAt(line: JobStatusLine, job: Pick<Job, "date_needed" | "start_time">, now: number): number | null {
  const clock = line.deadline?.at ? Date.parse(line.deadline.at) : NaN;
  if (Number.isFinite(clock) && clock >= now) return clock;
  const start = jobStartTarget(job.date_needed, job.start_time)?.getTime() ?? NaN;
  return Number.isFinite(start) && start >= now ? start : null;
}

/**
 * A3-17 (audit 11-01): the task says by when, as the cards' next-step line does ("Approve Yusef's work · 23h 49m left",
 * "Confirm you'll be at the job · by Mon 8:00 AM"). From the status line's OWN clock, only while it is still ahead; a
 * task whose words already carry a day keeps them.
 */
export function withTodoBy(task: string, line: Pick<JobStatusLine, "deadline">, now: number): string {
  const at = line.deadline?.at ? Date.parse(line.deadline.at) : NaN;
  if (!Number.isFinite(at) || at < now || / by (Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/.test(task)) return task;
  if (line.deadline!.source === "auto_complete") {
    const mins = Math.floor((at - now) / 60_000);
    return `${task} · ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`} left`;
  }
  const day = new Date(at).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" });
  return `${task} · by ${day.replace(",", "")}`;
}

/**
 * A3-17 rest (audit 11-01): the task is the job's NEXT STEP, the words the job page and the cards print (jobNextStep
 * from the one tracker, jobProgress), e.g. "Approve your Helpr's work · 23h 0m left", never a second wording of the
 * same step. Home reads no names (the cores only), so the other person is "your Helpr" / "them". A step that is not
 * the member's own (or none) keeps the status line's words.
 */
export function todoTask(job: Job, viewer: "poster" | "helpr", line: JobStatusLine, now: number, o: { pendingApplicants?: number; application?: string | null } = {}): string {
  const progress = jobProgress(job, { viewer, now: new Date(now), pendingApplicants: o.pendingApplicants, application: o.application });
  const step = jobNextStep(progress, { side: viewer, pendingApplicants: o.pendingApplicants });
  if (!step || step.who !== "you") return withTodoBy(line.detail, line, now);
  return step.by ? `${step.text} · ${step.by}` : withTodoBy(step.text, line, now);
}

/** A job's date for tier 4 ("everything else, by date"); undated last. */
const jobDateMs = (job: Pick<Job, "date_needed" | "start_time">) => jobStartTarget(job.date_needed, job.start_time)?.getTime() ?? Infinity;

/**
 * NEXT UP RANKING (spec v2 §5.2): (1) a deadline in under 24 hours, soonest
 * first; (2) someone waiting on the member; (3) money waiting on the member;
 * (4) everything else, by date. Ties keep the list's order. Every to-do's tier
 * comes from the SAME status line its card shows, so Home never ranks a step
 * the card does not name.
 *
 * Tier 3 has no source among today's to-dos: its examples are Homes rent and
 * Shops pay-to-confirm, neither of which makes a to-do yet, and a Jobs
 * payment that failed is a never-paid job, which is never a to-do
 * (jobIsUnfundedDraft). The tier number is kept so a new source slots in.
 */
function rank(due: number | null, waiting: boolean, date: number, now: number): [number, number] {
  if (due !== null && due - now < 24 * HOUR) return [1, due];
  if (waiting) return [2, due ?? date];
  return [4, due ?? date];
}

/**
 * THE TO-DO LIST, ONE ENTRY PER JOB OR ORDER THAT NEEDS YOU (owner, 2026-10-20:
 * badge = To-do). Home's Next up / To do, the Explore badge and the sidebar
 * counts all read this, so they cannot disagree. A job with 21 new applicants
 * is ONE to-do ("Review 21 applicants"), never 21. Never-paid jobs are left
 * out exactly as My Posts leaves them out (jobIsUnfundedDraft, Q1734): a count
 * must point at something the member can open.
 */
export function deriveNeedsYouTodos(i: NeedsYouInputs, now: number = Date.now()): TodoItem[] {
  const posted = i.postedJobs.filter((j) => !jobIsUnfundedDraft(j)).map((j) => withBackout(j, i.backout));
  const applied = i.appliedApps.map((a) => (a.job ? { ...a, job: withBackout(a.job, i.backout) } : a));
  // Continue another day (Auditor 11, 11-01): a job under way with a day set or asked for is a to-do only when the
  // job page's own line is the member's move (confirm the day, confirm you'll be there), in those words; never
  // "Mark it done" before the day the server lets it be done.
  const cd = i.continueDays ?? {};
  const contStep = (jobId: string, side: "poster" | "helpr", other: string | null) => continueDayNextStep(cd[jobId], { side, otherFirst: other });
  const helprOther = (a: AppliedApp) => (a.posterName ? a.posterName.trim().split(/\s+/)[0] || null : null);
  const postedNeeds = posted.filter((j) => (cd[j.id] ? contStep(j.id, "poster", null)?.who === "you" : postedActivityBucket(j, i.pendingApplicantCounts[j.id] ?? 0) === "needs_you"));
  const appliedNeeds = applied.filter((a) => a.job && (cd[a.job.id] ? contStep(a.job.id, "helpr", helprOther(a))?.who === "you" : appliedActivityBucket(a) === "needs_you"));
  // Orders waiting for MY SHOP's answer, soonest deadline first: each one lapses at accept_by.
  const shopWaiting = i.shopOrders
    .filter((o) => o.status === "held")
    .slice()
    .sort((x, y) => new Date(x.accept_by ?? 0).getTime() - new Date(y.accept_by ?? 0).getTime());
  // Every side of every section in one list (never role-based), ranked by spec v2 §5.2 (rank above).
  // An order to answer lapses at accept_by (24 hours), so a live one is always tier 1.
  const ranked: { item: TodoItem; tier: number; at: number }[] = [];
  for (const o of shopWaiting) {
    const due = o.accept_by ? Date.parse(o.accept_by) : NaN;
    const [tier, at] = rank(Number.isFinite(due) && due >= now ? due : null, true, Infinity, now);
    ranked.push({
      tier,
      at,
      item: {
        id: `s-${o.id}`,
        section: "shops",
        title: `Answer an order for ${o.shop_order_lines?.[0]?.title ?? "your shop"}`,
        meta: "Your shop · waiting for your answer",
        to: "/shops/dashboard",
        action: "Answer order",
        money: formatCents(o.total_cents),
      },
    });
  }
  for (const d of declutterTodos(i.declutterCart ?? [], i.declutterOffers ?? [], now, i.declutterRefunds ?? [], i.declutterFreeAsks ?? [])) {
    const [tier, at] = rank(d.due, d.waiting, Infinity, now);
    ranked.push({ tier, at, item: d.item });
  }
  // The task is the job card's own status sentence (jobStatusLine), so Home and the
  // card never name a different step of one job (boards 7, 83, 165).
  for (const j of postedNeeds) {
    const n = i.pendingApplicantCounts[j.id] ?? 0;
    const line = posterStatusLine(j, n, new Date(now));
    const [tier, at] = rank(dueAt(line, j, now), n > 0 || POSTER_SOMEONE_WAITING.has(line.id), jobDateMs(j), now);
    ranked.push({
      tier,
      at,
      item: {
        id: `p-${j.id}`,
        section: "jobs",
        title: n > 0 ? (n === 1 ? "Review 1 applicant" : `Review ${n} applicants`) : continueDayWords(cd[j.id], { side: "poster", otherFirst: null }) ?? todoTask(j, "poster", line, now, { pendingApplicants: n }),
        meta: `${j.helper_id ? "You hired" : "You posted"} · ${j.title}`,
        // "Open job" opens THE job (audit #12, 2026-10-21); the applicant
        // review still lands on the Posted list where applicants are handled.
        to: n > 0 ? `/jobs?tab=posted&filter=needs_you` : `/jobs/${j.id}`,
        // A3-83: the approve step is named on its button ("Review work", the job page's approve section).
        action: n > 0 ? "See applicants" : POSTER_REVIEW_STEPS.has(line.id) ? REVIEW_WORK_ACTION : "Open job",
      },
    });
  }
  for (const a of appliedNeeds) {
    const line = helperStatusLine(a);
    const [tier, at] = rank(dueAt(line, a.job!, now), HELPER_SOMEONE_WAITING.has(line.id), jobDateMs(a.job!), now);
    ranked.push({
      tier,
      at,
      item: {
        id: `a-${a.id}`,
        section: "jobs",
        // JA-39 (Jobs audit 11-01): on the way is not working yet. The task is the arrival tap, and the side word
        // says where they are ("You're on the way · Haul off..."), never "You're working" before they arrive.
        title: continueDayWords(cd[a.job!.id], { side: "helpr", otherFirst: helprOther(a) }) ?? (line.id === "on_the_way" ? ON_THE_WAY_TASK : todoTask(a.job!, "helpr", line, now, { application: a.status })),
        meta: `${helprSide(a.job!, line.id)} · ${a.job!.title}`,
        // JA-39: the button IS the arrival step ("I've arrived"), run by the Working card's tracker (not a crew: a
        // member's steps are on the roster), instead of "Open job" and a second tap on the page.
        ...(line.id === "on_the_way" && !a.job!.is_group_job && !cd[a.job!.id]
          ? { to: `/jobs?tab=working&job=${encodeURIComponent(a.job!.id)}&open=1`, action: ARRIVED_ACTION, helperStep: { jobId: a.job!.id, key: "arrived" as const } }
          : { to: `/jobs/${a.job!.id}`, action: "Open job" }),
      },
    });
  }
  // Array.prototype.sort is stable: equal ranks keep the order above.
  return ranked.sort((x, y) => x.tier - y.tier || x.at - y.at).map((r) => r.item);
}

// The hook and todoTarget live in useNeedsYouTodos.ts, which Home imports statically; this file (the derivation and
// its job-status code) loads beside the data (B51). Re-exported for the callers and tests that read them here.
export { useNeedsYouTodos, todoTarget } from "./useNeedsYouTodos";
