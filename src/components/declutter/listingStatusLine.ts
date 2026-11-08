/**
 * A listing row's status words on Selling (moved out of DeclutterHomeView.tsx to keep it under the component-size
 * threshold; behaviour unchanged).
 */
import type { DeclutterItem } from "@/lib/declutter/api";
import type { MyPayout } from "@/lib/declutter/handover";
import { soldPayoutWords } from "@/lib/declutter/soldPayout";
import type { NextStepValue } from "@/components/ui/NextStep";
import { sellerStatusLabel } from "./declutterUi";
import { HANDOVER_TITLE } from "./handoverCopy";

/**
 * A listing row's ONE status line (owner 2026-10-28: "Not listed yet" + "Finish the listing to put it up for sale."
 * read as two statuses). Where the old help line said what to do, its few words ride on the same line.
 */
const SELLER_STATUS_LINE: Partial<Record<DeclutterItem["status"], string>> = {
  // NIGHT-SELL-Sellinglist-5: only a failed automatic check holds a listing (owner); "Waiting for a review" read as a person.
  pending_review: "Being checked. We'll send you a notice when it's done.",
  paused: "Paused. Hidden from buyers.",
};

const WAY_ORDER = ["porch", "meetup", "seller_delivery", "delivery"] as const;

/**
 * The next-step line on a listing row (owner 2026-11-01: "people aren't told what to do next"): a listing that waits on
 * the seller reads "Next: <step>" (finish it, approve it, see why it was not approved), in the shared NextStep words
 * (nextStepWords) and the row's own size; every other row says where it stands, as before.
 */
const SELLER_MOVE: Partial<Record<DeclutterItem["status"], string>> = {
  draft: "Finish it to sell it",
  rejected: "Open it to see why it wasn't approved",
  pending_seller_approval: "Approve it above to sell it",
};

export function listingNextStep(item: DeclutterItem, saleCents?: number, payout?: MyPayout | null, problemOpen = false): NextStepValue {
  const move = SELLER_MOVE[item.status];
  if (move) return { who: "you", text: move };
  return { who: item.status === "pending_review" ? "them" : "info", text: listingStatusLine(item, saleCents, payout, problemOpen) };
}

function listingStatusLine(item: DeclutterItem, saleCents?: number, payout?: MyPayout | null, problemOpen = false): string {
  // B48 live check 2026-10-29: porch + meetup read only "Porch pickup". Every ticked way, in checkout's order and words.
  const ways = WAY_ORDER.filter((w) => item.handovers?.includes(w));
  if (item.status === "live" && ways.length) return ["For sale", ...ways.map((w) => HANDOVER_TITLE[w])].join(" · ");
  if (item.status === "live" && item.porch_ok) return "For sale · Porch pickup";
  const base = SELLER_STATUS_LINE[item.status] ?? sellerStatusLabel(item);
  // Deep audit #60: a sold listing's line also says where its payout stands (soldPayout.ts); D2-2: held while a problem is open.
  const paid = item.status === "sold" || item.status === "completed" ? soldPayoutWords(item.status, saleCents, payout, undefined, problemOpen) : null;
  return paid ? `${base} · ${paid}` : base;
}
