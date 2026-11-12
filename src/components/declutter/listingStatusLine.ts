/**
 * A listing row's status words on Selling (moved out of DeclutterHomeView.tsx to keep it under the component-size
 * threshold; behaviour unchanged).
 */
import type { DeclutterItem } from "@/lib/declutter/api";
import type { MyPayout } from "@/lib/declutter/handover";
import { soldPayoutWords } from "@/lib/declutter/soldPayout";
import { nextStepWords, type NextStepValue } from "@/lib/nextStepWords";
import { sellerStatusLabel } from "./declutterUi";
import "@/lib/i18n/enDeclutter";
import "@/lib/i18n/enDeclPanels";
import type { MsgKey } from "@/lib/i18n/en";
import { t } from "@/lib/i18n/language";

/**
 * A listing row's ONE status line (owner 2026-10-28: "Not listed yet" + "Finish the listing to put it up for sale."
 * read as two statuses). Where the old help line said what to do, its few words ride on the same line.
 */
const SELLER_STATUS_LINE: Partial<Record<DeclutterItem["status"], MsgKey>> = {
  // NIGHT-SELL-Sellinglist-5: only a failed automatic check holds a listing (owner); "Waiting for a review" read as a person.
  pending_review: "decl.line.pending_review",
  paused: "decl.line.paused",
};

const WAY_ORDER = ["porch", "meetup", "seller_delivery", "delivery"] as const;

/**
 * The next-step line on a listing row (owner 2026-11-01: "people aren't told what to do next"): a listing that waits on
 * the seller reads "Next: <step>" (finish it, approve it, see why it was not approved), in the shared NextStep words
 * (nextStepWords) and the row's own size; every other row says where it stands, as before.
 */
const SELLER_MOVE: Partial<Record<DeclutterItem["status"], MsgKey>> = {
  draft: "decl.move.draft",
  rejected: "decl.move.rejected",
  pending_seller_approval: "decl.move.pending_seller_approval",
};

export function listingNextStep(item: DeclutterItem, saleCents?: number, payout?: MyPayout | null, problemOpen = false, tradedFor: string | null = null): NextStepValue {
  const move = SELLER_MOVE[item.status];
  if (move) return { who: "you", text: t(move) };
  return { who: item.status === "pending_review" ? "them" : "info", text: listingStatusLine(item, saleCents, payout, problemOpen, tradedFor) };
}

/** The Selling row's one line: "May drop tonight" when tonight's price drop may run, else the next-step words. */
export function listingRowLine(next: NextStepValue, drop: boolean): string {
  return drop ? t("decl.mayDrop") : nextStepWords(next);
}

function listingStatusLine(item: DeclutterItem, saleCents?: number, payout?: MyPayout | null, problemOpen = false, tradedFor: string | null = null): string {
  // B48 live check 2026-10-29: porch + meetup read only "Porch pickup". Every ticked way, in checkout's order and words.
  const ways = WAY_ORDER.filter((w) => item.handovers?.includes(w));
  // F359b (audit 11-10): a free listing read "For sale · Porch pickup"; it is Free, as on its card.
  const live = t(item.current_price_cents === 0 ? "decl.line.free" : "decl.line.forSale");
  if (item.status === "live" && ways.length) return [live, ...ways.map((w) => t(`ho.title.${w}` as MsgKey))].join(" · ");
  if (item.status === "live" && item.porch_ok) return `${live} · ${t("ho.title.porch")}`;
  const line = SELLER_STATUS_LINE[item.status];
  const base = line ? t(line) : sellerStatusLabel(item, tradedFor);
  // Lead 11-08: a trade moves no money, so no payout words follow "Traded for <item>".
  if (tradedFor && (item.status === "reserved" || item.status === "sold" || item.status === "completed")) return base;
  // Deep audit #60: a sold listing's line also says where its payout stands (soldPayout.ts); D2-2: held while a problem is open.
  const paid = item.status === "sold" || item.status === "completed" ? soldPayoutWords(item.status, saleCents, payout, undefined, problemOpen) : null;
  return paid ? `${base} · ${paid}` : base;
}
