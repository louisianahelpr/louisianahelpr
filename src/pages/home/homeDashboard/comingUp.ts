import type { Job, AppliedApp } from "@/components/job-card/activityConstants";
import { postedActivityBucket, appliedActivityBucket } from "@/components/job-card/activityFilters";
import { jobStartDateTime, parseLocalDate } from "@/lib/dateUtils";
import { jobStartTimeLabel } from "@/lib/jobDate";
import type { CartLine } from "@/lib/declutter/api";
import type { MyBooking } from "@/lib/declutter/handover";
import type { ShopOrder } from "@/lib/shops/orders";
import { jobOnContinueDay, type ContinueDay } from "@/lib/continueDayWords";

/** Which side of which section a Coming up row is on (spec v2 §5.4: the role caption). */
export type ComingUpRole = "posted" | "working" | "buying" | "selling" | "ordered" | "shop";

/** Board 7 / spec v2 §5.4: each row says which side you are on, in plain words. */
export const COMING_UP_ROLE: Record<ComingUpRole, string> = {
  posted: "You hired",
  working: "You're working",
  buying: "You're buying",
  selling: "You're selling",
  ordered: "You ordered",
  shop: "Your shop",
};

export interface ComingUpItem {
  id: string;
  section: "jobs" | "declutter" | "shops";
  role: ComingUpRole;
  title: string;
  /** When it happens (ms), the sort key. A date-only row (a shop order's ready day) sits at that day's start. */
  at: number;
  /** Boards 7 and 11: "Today", "Tomorrow", "Sat" within the week, else "Sun, Nov 1". */
  day: string;
  /** "2:00 PM", or null when the row has a day but no time. */
  time: string | null;
  /** The exact item (spec v2 §4.3: every Coming up row opens it in one tap). */
  to: string;
}

interface ComingUpInputs {
  postedJobs: readonly Job[];
  appliedApps: readonly AppliedApp[];
  /** Declutter cart lines (declutter_my_cart): both sides, paid lines carry their order. */
  cart: readonly CartLine[];
  /** declutter_bookings for those orders: the 30-minute pickup slot, once booked. */
  bookings: readonly MyBooking[];
  /** Shops orders I placed (fetchMyOrders). */
  myOrders: readonly ShopOrder[];
  /** Orders to my shop (fetchShopOrders). */
  shopOrders: readonly ShopOrder[];
  /** The active continue days of my jobs under way, by job id (useContinueDays): a SET day is the job's next visit. */
  continueDays?: Readonly<Record<string, ContinueDay>>;
}

const timeOf = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

/**
 * The day words boards 7 and 11 use: "Today", "Tomorrow", the weekday ("Sat")
 * for the rest of this week, then the date ("Sun, Nov 1"). Short, so the
 * phone row's "<your side> · <day> <time>" fits 375 without cutting the time.
 */
function comingUpDay(day: Date, now: number): string {
  const days = Math.round((startOfDay(day.getTime()) - startOfDay(now)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1 && days < 7) return day.toLocaleDateString("en-US", { weekday: "short" });
  return day.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** "Oak rocking chair", or "Oak rocking chair + 2 more" for a several-item order. */
function itemsTitle(titles: readonly string[]): string {
  const first = titles[0] ?? "your item";
  return titles.length > 1 ? `${first} + ${titles.length - 1} more` : first;
}

function jobRow(job: Job, role: "posted" | "working", id: string, now: number): ComingUpItem | null {
  if (!job.date_needed) return null;
  // The job's own day and start time (its zone, as every job clock reads it); no time = the day's start.
  const at = jobStartDateTime(job.date_needed, job.start_time ?? null);
  if (!at) return null;
  // The shared rule (jobStartTimeClass, TRAIN24): a malformed or "flexible" column value never prints raw.
  const time = jobStartTimeLabel(job.start_time, job.is_flexible_schedule);
  return { id, section: "jobs", role, title: job.title, at: at.getTime(), day: comingUpDay(parseLocalDate(job.date_needed), now), time, to: `/jobs/${job.id}` };
}

/**
 * COMING UP (spec v2 §5.4, board 7): ONE agenda from every section and both
 * sides, sorted by when. Only things with a REAL date (spec §1.5): a job's
 * day, a booked Declutter pickup slot, a Shops order's ready day. Nothing is
 * guessed: a paid Declutter sale with no booked slot, a Helpr delivery (its
 * own task holds the time) and a shop order not yet accepted are left out.
 * Rows from before today are left out too (the agenda looks forward).
 */
export function deriveComingUp(i: ComingUpInputs, now: number = Date.now()): ComingUpItem[] {
  const rows: ComingUpItem[] = [];
  // Continue another day (Auditor 11, 11-01): a job under way with a SET day comes back on that day, so it is on
  // the agenda at the new day and time (it was missing, and Home said "Nothing else booked").
  const setDay = (jobId: string) => (i.continueDays?.[jobId]?.status === "set" ? i.continueDays[jobId] : null);
  for (const job of i.postedJobs) {
    const day = job.status === "in_progress" ? setDay(job.id) : null;
    if (!day && postedActivityBucket(job, 0) !== "scheduled") continue;
    const r = jobRow(jobOnContinueDay(job, day), "posted", `p-${job.id}`, now);
    if (r) rows.push(r);
  }
  for (const a of i.appliedApps) {
    if (!a.job) continue;
    const day = a.job.status === "in_progress" && a.job.helper_id === a.helper_id ? setDay(a.job.id) : null;
    if (!day && appliedActivityBucket(a) !== "scheduled") continue;
    const r = jobRow(jobOnContinueDay(a.job, day), "working", `a-${a.id}`, now);
    if (r) rows.push(r);
  }

  // Declutter: a paid order still in its handover, with its pickup slot booked.
  const orders = new Map<string, CartLine[]>();
  for (const l of i.cart) {
    if (l.status !== "paid" || !l.order_id || l.order_status === "handed_over" || l.handover === "delivery") continue;
    orders.set(l.order_id, [...(orders.get(l.order_id) ?? []), l]);
  }
  for (const [orderId, lines] of orders) {
    const slot = i.bookings.find((b) => b.order_id === orderId)?.slot_start;
    const at = slot ? new Date(slot) : null;
    if (!at || Number.isNaN(at.getTime())) continue;
    const buyer = lines[0].my_side === "buyer";
    const what = itemsTitle(lines.map((l) => l.item_title));
    const verb = buyer ? "Pick up" : lines[0].handover === "porch" ? "Put out" : "Hand over";
    rows.push({
      id: `d-${orderId}`,
      section: "declutter",
      role: buyer ? "buying" : "selling",
      title: `${verb} ${what}`,
      at: at.getTime(),
      day: comingUpDay(at, now),
      time: timeOf(at),
      to: `/declutter?tab=${buyer ? "buying" : "selling"}`,
    });
  }

  // Shops: an ACCEPTED order on its ready day (a date, no time), from either side.
  const shopRow = (o: ShopOrder, side: "ordered" | "shop"): ComingUpItem | null => {
    if (o.status !== "accepted" || !/^\d{4}-\d{2}-\d{2}$/.test(o.ready_date ?? "")) return null;
    const what = itemsTitle((o.shop_order_lines ?? []).map((l) => l.title));
    return {
      id: `${side === "ordered" ? "o" : "s"}-${o.id}`,
      section: "shops",
      role: side,
      title: side === "ordered" ? `Pick up ${what}` : `Get ${what} ready`,
      at: new Date(`${o.ready_date}T00:00:00`).getTime(),
      day: comingUpDay(parseLocalDate(o.ready_date), now),
      time: null,
      to: side === "ordered" ? "/shops/orders" : "/shops/dashboard",
    };
  };
  for (const o of i.myOrders) { const r = shopRow(o, "ordered"); if (r) rows.push(r); }
  for (const o of i.shopOrders) { const r = shopRow(o, "shop"); if (r) rows.push(r); }

  const from = startOfDay(now);
  return rows.filter((r) => r.at >= from).sort((x, y) => x.at - y.at);
}
