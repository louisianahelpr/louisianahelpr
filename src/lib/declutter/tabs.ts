/**
 * Declutter's tabs (owner, 2026-10-18): Browse · Buying · Selling · Deliver · Wanted · Free (Free: OWN-FREE, 2026-10-30).
 *   Buying  = your cart (one checkout per seller), the offers you sent, and your purchases.
 *   Selling = your listings, the offers on your items, sales waiting for the buyer to pay,
 *             and paid sales (pickup, handover, payout).
 * Pure pieces only (no React, no network), so the tab row and its tests share one rule.
 *
 * The old tabs (My listings, Offers, Cart) live on in links already sent:
 * notifications and emails carry /declutter?view=offers|cart|mine, for BOTH
 * sides (a seller is sent ?view=cart when the buyer pays, a buyer when a sale
 * is accepted). oldDeclutterView maps each to the tab that holds it.
 */
import type { CartLine, MyOffer } from "./api";

export type DeclutterTab = "browse" | "buying" | "selling" | "deliver" | "wanted" | "free";

/**
 * The tabs before 2026-10-18, still in links already sent; plus "sales" and
 * "bought", which notices have linked since slice 4 and the safe-meetup
 * notices (the seller's paid sales, the buyer's purchases) but which no tab
 * ever read, so they opened Browse (measured on prod 2026-10-28: 11 live SQL
 * functions write ?view=sales, 1 writes ?view=bought).
 * src/test/declutterNoticeLinksOpenATab.test.ts keeps every ?view= a notice
 * writes on this list or on a tab.
 */
export type OldDeclutterView = "mine" | "offers" | "cart" | "sales" | "bought";
export const OLD_DECLUTTER_VIEWS: readonly OldDeclutterView[] = ["mine", "offers", "cart", "sales", "bought"];

/** What needs the member, per side. Each number is a count of things to act on. */
export interface DeclutterTodo {
  /** Buyer: items in the cart still inside their 48 hours (check out and pay). */
  toPay: number;
  /** Buyer: open offers waiting for the buyer's answer (a seller's counter). */
  buyerOffers: number;
  /** Buyer: paid pickup orders not handed over yet (book, collect, "I got it"). */
  purchasesOpen: number;
  /** Seller: open offers on the member's items waiting for their answer. */
  sellerOffers: number;
  /** Seller: paid pickup orders not handed over yet (set it out, confirm the handover). */
  salesOpen: number;
  /** Seller: accepted sales waiting for the buyer to pay. Nothing to do (not in `selling`), but it is the seller's. */
  salesAwaitingPayment: number;
  /**
   * Paid Helpr-delivery orders not handed over yet, per side. Nothing for the
   * member to do (not in `buying` / `selling`; the Helpr does the handover), but
   * they say which side an old ?view=cart link meant: the seller's "A Helpr will
   * pick it up", "Helpr pickup booked", "Picked up" (audit 2026-10-28 #37, SE2-4)
   * and the buyer's "Your item is on its way" all link there.
   */
  purchasesDelivering: number;
  salesDelivering: number;
  buying: number;
  selling: number;
}

/**
 * A paid order still in its handover, where the member has a step to take.
 * A Helpr delivery is left out: the Helpr does the handover, the order card
 * only shows its progress.
 */
function openPickupOrders(cart: readonly CartLine[], side: "buyer" | "seller", helprDelivery = false): number {
  const orders = new Set<string>();
  for (const l of cart) {
    if (l.my_side !== side || l.status !== "paid" || !l.order_id) continue;
    if (l.order_status !== "paid" || (l.handover === "delivery") !== helprDelivery) continue;
    orders.add(l.order_id);
  }
  return orders.size;
}

export function declutterTodo(cart: readonly CartLine[], offers: readonly MyOffer[], now = Date.now()): DeclutterTodo {
  const toPay = cart.filter((l) => l.my_side === "buyer" && l.status === "in_cart" && new Date(l.checkout_by).getTime() > now).length;
  const myTurn = (o: MyOffer) => o.status === "open" && o.awaiting === o.my_side;
  const buyerOffers = offers.filter((o) => o.my_side === "buyer" && myTurn(o)).length;
  const sellerOffers = offers.filter((o) => o.my_side === "seller" && myTurn(o)).length;
  const purchasesOpen = openPickupOrders(cart, "buyer");
  const salesOpen = openPickupOrders(cart, "seller");
  const salesAwaitingPayment = cart.filter((l) => l.my_side === "seller" && l.status === "in_cart").length;
  return {
    toPay,
    buyerOffers,
    purchasesOpen,
    sellerOffers,
    salesOpen,
    salesAwaitingPayment,
    purchasesDelivering: openPickupOrders(cart, "buyer", true),
    salesDelivering: openPickupOrders(cart, "seller", true),
    buying: toPay + buyerOffers + purchasesOpen,
    selling: sellerOffers + salesOpen,
  };
}

/**
 * Where an old link lands. ?view=mine and ?view=sales were always the seller's
 * (Selling), ?view=bought the buyer's (Buying). ?view=offers
 * and ?view=cart were sent to both sides, so they open the side that has
 * something waiting; with both or neither, the side the link usually meant:
 * offers -> Selling (a new offer is the common one), cart -> Buying (check out).
 */
export function oldDeclutterView(view: OldDeclutterView, todo: DeclutterTodo | null): DeclutterTab {
  if (view === "mine" || view === "sales") return "selling";
  if (view === "bought") return "buying";
  if (view === "offers") {
    return todo && todo.buyerOffers > 0 && todo.sellerOffers === 0 ? "buying" : "selling";
  }
  const buyerWaiting = todo ? todo.toPay + todo.purchasesOpen + todo.purchasesDelivering : 0;
  const sellerWaiting = todo ? todo.salesOpen + todo.salesAwaitingPayment + todo.salesDelivering : 0;
  return sellerWaiting > 0 && buyerWaiting === 0 ? "selling" : "buying";
}
