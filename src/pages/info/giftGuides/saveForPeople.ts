import { useEffect, useSyncExternalStore } from "react";
import type { CatalogPick } from "@/content/giftGuideCatalog";
import { PLAN_MAX_IDEAS, type GiftPlan, type PlanPerson } from "@/content/giftGuideFun1120";
import { showsPrice } from "@/components/giftGuides/PickPrice";
import { planActions } from "./fun/plannerStore";
import type { ShareRef } from "@/lib/giftWishListApi";
import { itemId } from "./giftList";

/**
 * Save for someone (owner 2026-11-21: "they should also be able to save items per person, like add a list or
 * something, and it shows the total amount they have added, and they can add/remove stuff as they are browsing the
 * guides"). A person's list IS that person's ideas in the gift planner (plannerStore.ts: on the device, and on the
 * account when signed in), so the guides, the "My lists" panel and the planner always show the same gifts. The guide
 * cards' heart asks for whom (requestSaveFor); "Me" stays the existing My Wish List (giftList.tsx), so every wish list
 * link already sent keeps working. Guard: src/test/savePerPerson1121.test.tsx.
 */

/** A gift as it goes on a person's list: the same shape as the planner's "From our guides" ideas. */
export interface SaveItem { href: string; name: string; guide?: string; image?: string; price?: number }

/** The price a guide pick adds to a list: the one its guide shows today, or none. */
export const plannerPrice = (p: CatalogPick) => (showsPrice(p) ? p.price : undefined);

/** A guide pick as a list item (name, photo, the shown price, its shop link, the guide it came from). */
export const saveItemOf = (p: CatalogPick, guide?: string): SaveItem => {
  const price = plannerPrice(p);
  return { href: p.href, name: p.name, ...(guide ? { guide } : {}), ...(p.image ? { image: p.image } : {}), ...(price !== undefined ? { price } : {}) };
};

/** True when this person's list holds the gift (by its link). */
export const onPersonList = (p: PlanPerson, href: string) => p.ideas.some((i) => i.href === href);
/** True when anyone's list holds the gift (the heart shows filled). */
export const onAnyList = (plan: GiftPlan, href: string) => plan.people.some((p) => onPersonList(p, href));

/** One list's count and the sum of its prices (what has been added, bought or not). */
export const listTotal = (p: PlanPerson) => ({
  gifts: p.ideas.length,
  amount: Math.round(p.ideas.reduce((t, i) => t + (i.price ?? 0), 0) * 100) / 100,
});
/** Every list's count and amount added up. */
export const allTotals = (plan: GiftPlan) => plan.people.map(listTotal).reduce((a, b) => ({ gifts: a.gifts + b.gifts, amount: Math.round((a.amount + b.amount) * 100) / 100 }), { gifts: 0, amount: 0 });

/** A tap on a person: the gift goes on their list, or comes off when it is already there. "full": 30 already. */
export function togglePersonItem(plan: GiftPlan, personId: string, item: SaveItem): "added" | "removed" | "full" | "gone" {
  const p = plan.people.find((x) => x.id === personId);
  if (!p) return "gone";
  const have = p.ideas.find((i) => i.href === item.href);
  if (have) {
    planActions.removeIdea(personId, have.id);
    return "removed";
  }
  if (p.ideas.length >= PLAN_MAX_IDEAS) return "full";
  planActions.addIdea(personId, { name: item.name, href: item.href, ...(item.guide ? { guide: item.guide } : {}), ...(item.image ? { image: item.image } : {}), ...(item.price !== undefined ? { price: item.price } : {}) });
  return "added";
}

/**
 * A person's list as a share holds it (owner 11-21: "share all lists"): the name and the gifts from our guides as
 * refs. A typed idea (no guide) has no ref and stays private; so do the budget and the Bought marks.
 */
export const shareListOf = (p: PlanPerson): { n: string; items: ShareRef[] } => ({
  n: p.name.trim() || "Someone",
  // Owner 11-21: a gift from any store goes as its link request ({r}): the list shows its words and our link once made.
  items: p.ideas.flatMap((i): ShareRef[] => (i.guide && i.href ? [{ g: i.guide, i: itemId(i.href) }] : i.req ? [{ r: i.req }] : [])),
});
/** How many of a person's ideas a share leaves out (typed before they could be sent to us, with no guide). */
export const privateIdeas = (people: PlanPerson[]) => people.reduce((t, p) => t + p.ideas.filter((i) => !(i.guide && i.href) && !i.req).length, 0);

// ---------------------------------------------------------------------------------------------------------------
// The heart's request: one picker per page (SaveForSomeone), opened for one gift.

let request: SaveItem | null = null;
let hosts = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/**
 * A heart's tap: open the picker for this gift. False when no picker is on the page (the heart then keeps its old
 * job and saves to My Wish List).
 */
export function requestSaveFor(item: SaveItem): boolean {
  if (hosts === 0) return false;
  request = item;
  notify();
  return true;
}
export const closeSaveFor = () => {
  request = null;
  notify();
};
/** The gift the picker is open for, or null. */
export const useSaveForRequest = () => useSyncExternalStore(subscribe, () => request, () => null);
/** The picker's host registers while it is mounted. */
export function useSaveForHost() {
  useEffect(() => {
    hosts++;
    return () => {
      hosts--;
      if (hosts === 0) request = null;
    };
  }, []);
}
