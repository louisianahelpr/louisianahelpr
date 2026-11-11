import "@/lib/i18n/enDeclPanels";
import { getLang, t } from "@/lib/i18n/language";

/** The viewer's locale for clock words (F260q). */
const locale = () => (getLang() === "es" ? "es-US" : "en-US");

/**
 * "19 hours left" / "5 minutes left" / "time is up": a Declutter deadline (a cart line's checkout_by, an offer's
 * respond_by) in the words the cart and the seller's waiting sales show. Moved out of DeclutterTradeViews.tsx
 * unchanged (componentSizeRatchet: that file is held at 600 lines).
 */
export function timeLeft(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return t("dp.timeUp");
  const h = Math.floor(ms / 3_600_000);
  // Audit 11-10 F368: "118 hours left" became days from 48 hours up.
  if (h >= 48) return t("dp.daysLeft", { n: Math.floor(h / 24) });
  if (h >= 1) return h === 1 ? t("dp.hourLeft") : t("dp.hoursLeft", { n: h });
  const m = Math.max(1, Math.floor(ms / 60_000));
  return m === 1 ? t("dp.minuteLeft") : t("dp.minutesLeft", { n: m });
}

/**
 * "by 7:45 PM" (today) / "by Mon 7:45 PM" (another day) / "time is up": a hold's end as a clock time, for the next-step
 * line (A3-24, audit 11-01: the seller's "Waiting on the buyer to pay · by <hold end>"). The viewer's own zone, like
 * every other Declutter time on a card.
 */
export function byClock(iso: string, now = Date.now()): string {
  const at = new Date(iso);
  if (at.getTime() <= now) return t("dp.timeUp");
  const time = at.toLocaleTimeString(locale(), { hour: "numeric", minute: "2-digit" });
  const sameDay = at.toDateString() === new Date(now).toDateString();
  return t("dp.byTime", { time: sameDay ? time : `${at.toLocaleDateString(locale(), { weekday: "short" })} ${time}` });
}

/** Louisiana Helpr's own clock (Central), so every order date reads the same on every device. */
const CENTRAL = "America/Chicago";

/**
 * Audit 11-10 F367/F376: one date format for order deadlines: "Wed, Nov 11, 3:00 PM" (weekday, month name, day,
 * 12-hour time, Central time).
 */
export function orderWhen(iso: string): string {
  return new Date(iso).toLocaleString(locale(), { timeZone: CENTRAL, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const PAYOUT_SEND_MARGIN_MS = 10 * 60_000;

/**
 * F360b (lh-money-escrow review): a payout day, date only ("Thu, Nov 12", Central). The run sends a final sale within
 * about 10 minutes of the time it allows and the bank shows it later, so the minute would claim more than is known.
 */
export function payoutDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { timeZone: CENTRAL, weekday: "short", month: "short", day: "numeric" });
}

/** The day an unsent payout goes, from the end of the buyer's window: declutter_sale_final allows the send 10 minutes
 *  after the 24 hours, so a window ending 11:55 PM pays the next day (lh-money-escrow re-review). */
export function payoutDayAfterWindow(windowEnds: string): string {
  return payoutDay(new Date(Date.parse(windowEnds) + PAYOUT_SEND_MARGIN_MS).toISOString());
}

/** The buyer's time to check an item after the handover: 24 hours (declutter_sale_final / declutter_problem_window_open). */
const CHECK_WINDOW_MS = 24 * 3_600_000;

/**
 * Audit 11-10 F376/F365: when the buyer's 24 hours to check a handed-over item end, or null once they are over (or
 * before the handover row has answered). `handedOverAt` is the handover row's confirmed_at, written in the same
 * statement as declutter_orders.handed_over_at.
 */
export function checkWindowEnds(handedOverAt: string | null | undefined, now = Date.now()): string | null {
  if (!handedOverAt) return null;
  const ends = new Date(handedOverAt).getTime() + CHECK_WINDOW_MS;
  return Number.isFinite(ends) && ends > now ? new Date(ends).toISOString() : null;
}
