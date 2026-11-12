import { postedActivityBucket, appliedActivityBucket, jobIsUnfundedDraft } from "@/components/job-card/activityFilters";
import type { Job, AppliedApp } from "@/components/job-card/activityConstants";
import { backoutNoticeApplies, type BackoutNotice } from "@/lib/backoutNotices";
import type { ShopOrder } from "@/lib/shops/orders";
import type { CartLine, FreeAskToPick, MyOffer } from "@/lib/declutter/api";
import type { MyRefundTodo } from "@/lib/declutter/refundRequests";
import { declutterTodos } from "@/lib/declutter/declutterTodos";
import { formatCents } from "@/lib/shops/formatCents";
import { posterStatusLine, helperStatusLine, type JobStatusLine } from "@/components/job-card/jobStatusLine";
import { jobStartTarget } from "@/components/job-card/CountdownRows";
import { jobProgress } from "@/components/tracker/jobProgressState";
import { jobNextStep } from "@/components/tracker/jobNextStep";
import { continueDayNextStep, continueDayWords, type ContinueDay } from "@/lib/continueDayWords";
import "@/lib/i18n/enTodos";
import { t as tr, getLang } from "@/lib/i18n/language";

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
  /** F363 (owner 11-11): open problems on the member's purchases (a seller's report puts the order under Needs you). */
  declutterProblems?: readonly import("@/lib/declutter/declutterTodos").TodoProblem[];
  /** The active continue days of my jobs under way, by job id (useContinueDays). */
  continueDays?: Readonly<Record<string, ContinueDay>>;
}

/** An open back-out notice rides on its job, as useActivityData does it (Q1575). */
function withBackout<J extends { id: string; status?: string | null }>(j: J, backout: ReadonlyMap<string, BackoutNotice>): J {
  const open = backout.get(j.id);
  return open && backoutNoticeApplies(open.backout_kind, j.status) ? { ...j, backout_notice: open } : j;
}

// JA-39: the on-the-way Helpr's Next up task is todo.onTheWayTask; its button, todo.arrived, is the Working card's own
// step label (helperFaceAction.ts: key "arrived"). F260q: every word here is in enTodos / esTodos.
/**
 * JA-39: which side of the job the Helpr is on, by where the job stands (never "working" before they arrive).
 * A3-84 (audit 11-01): hired, offered, confirmed and confirm-due read "You're hired" (the confirm-due Home row said
 * "Confirm you'll be at the job · You're working"); "You're working" only from arrival.
 */
function helprSide(job: Job, lineId: string): string {
  if (!job.helper_id) return tr("todo.youApplied");
  if (lineId === "on_the_way") return tr("todo.onTheWay");
  return (job as { helper_arrived_at?: string | null }).helper_arrived_at ? tr("todo.working") : tr("todo.hired");
}
const HOUR = 3_600_000;
/** A3-83: the poster's step when the Helpr marked it done (or fixed what was asked): its Next up button is todo.reviewWork. */
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
    return tr("todo.left", { task, time: mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m` });
  }
  const day = new Date(at).toLocaleString(getLang() === "es" ? "es-US" : "en-US", { timeZone: "America/Chicago", weekday: "short", hour: "numeric", minute: "2-digit" });
  return tr("todo.by", { task, day: day.replace(",", "") });
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
/** The Home To-do list's Declutter Buying rows from the Buying tab's own reads (cart, offers, refund to-dos). */
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
        title: o.shop_order_lines?.[0]?.title ? tr("todo.answerOrderFor", { title: o.shop_order_lines[0].title }) : tr("todo.answerOrder"),
        meta: tr("todo.shopMeta"),
        to: "/shops/dashboard",
        action: tr("todo.answerOrderAction"),
        money: formatCents(o.total_cents),
      },
    });
  }
  for (const d of declutterTodos(i.declutterCart ?? [], i.declutterOffers ?? [], now, i.declutterRefunds ?? [], i.declutterFreeAsks ?? [], i.declutterProblems ?? [])) {
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
        title: n > 0 ? (n === 1 ? tr("todo.reviewOne") : tr("todo.reviewN", { n })) : continueDayWords(cd[j.id], { side: "poster", otherFirst: null }) ?? todoTask(j, "poster", line, now, { pendingApplicants: n }),
        meta: `${j.helper_id ? tr("todo.youHired") : tr("todo.youPosted")} · ${j.title}`,
        // "Open job" opens THE job (audit #12, 2026-10-21); the applicant
        // review still lands on the Posted list where applicants are handled.
        to: n > 0 ? `/jobs?tab=posted&filter=needs_you` : `/jobs/${j.id}`,
        // A3-83: the approve step is named on its button ("Review work", the job page's approve section).
        action: n > 0 ? tr("todo.seeApplicants") : POSTER_REVIEW_STEPS.has(line.id) ? tr("todo.reviewWork") : tr("todo.openJob"),
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
        title: continueDayWords(cd[a.job!.id], { side: "helpr", otherFirst: helprOther(a) }) ?? (line.id === "on_the_way" ? tr("todo.onTheWayTask") : todoTask(a.job!, "helpr", line, now, { application: a.status })),
        meta: `${helprSide(a.job!, line.id)} · ${a.job!.title}`,
        // JA-39: the button IS the arrival step ("I've arrived"), run by the Working card's tracker (not a crew: a
        // member's steps are on the roster), instead of "Open job" and a second tap on the page.
        ...(line.id === "on_the_way" && !a.job!.is_group_job && !cd[a.job!.id]
          ? { to: `/jobs?tab=working&job=${encodeURIComponent(a.job!.id)}&open=1`, action: tr("todo.arrived"), helperStep: { jobId: a.job!.id, key: "arrived" as const } }
          : { to: `/jobs/${a.job!.id}`, action: tr("todo.openJob") }),
      },
    });
  }
  // Array.prototype.sort is stable: equal ranks keep the order above.
  return ranked.sort((x, y) => x.tier - y.tier || x.at - y.at).map((r) => r.item);
}

// The hook and todoTarget live in useNeedsYouTodos.ts, which Home imports statically; this file (the derivation and
// its job-status code) loads beside the data (B51). Re-exported for the callers and tests that read them here.
export { useNeedsYouTodos, todoTarget } from "./useNeedsYouTodos";
