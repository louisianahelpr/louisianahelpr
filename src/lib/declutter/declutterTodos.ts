import type { CartLine, FreeAskToPick, MyOffer } from "@/lib/declutter/api";
import { openCheckouts } from "@/lib/declutter/tabs";
import { isDeclutterBuyingTodo } from "@/lib/declutter/buyingTodo";
import type { MyRefundTodo } from "@/lib/declutter/refundRequests";
import { formatCents } from "@/lib/shops/formatCents";
import type { TodoItem } from "@/pages/home/homeDashboard/needsYouTodos";

/*
 * The Declutter half of the Home To-do list, on its own so the Declutter pages can read the same rows (owner 11-11,
 * F363: every Declutter badge and the Buying "Needs you" group are the Home To-do rows) without pulling the Jobs
 * tracker, status lines and job-card filters that needsYouTodos.ts imports onto the /declutter critical path
 * (Q178 budget, lead 2026-11-11). TodoItem is a type-only import, erased at build.
 */

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
export function declutterTodos(
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
  // F363: the same one-per-seller rule the Buying badge counts (tabs.ts openCheckouts), so the two numbers agree.
  for (const [k, lines] of openCheckouts(cart, now)) {
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

export function declutterBuyingTodos(
  cart: readonly CartLine[], offers: readonly MyOffer[], refunds: readonly MyRefundTodo[], now: number = Date.now(),
): TodoItem[] {
  return declutterTodos(cart, offers, now, refunds).map((x) => x.item).filter(isDeclutterBuyingTodo);
}
