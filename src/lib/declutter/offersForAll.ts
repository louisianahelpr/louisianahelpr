/**
 * LEAD-OFFERS-CHOICE (3), owner 2026-10-31: "Turn offers off / on for all my listings". The same server call as each
 * listing's own switch (declutter_set_offer_rules), once per listing that is up (live or paused) and not already set
 * that way, 3 at a time. Each refusal is counted, never dropped.
 */
import { setOfferRules, type DeclutterItem } from "@/lib/declutter/api";

type Listing = Pick<DeclutterItem, "id" | "status"> & { accepts_offers?: boolean };

const AT_ONCE = 3;

/** The listings this would change: up (live or paused) and not already taking offers that way. */
export function listingsToSwitch(items: readonly Listing[], on: boolean): Listing[] {
  return items.filter((it) => (it.status === "live" || it.status === "paused") && (it.accepts_offers !== false) !== on);
}

export async function setOffersForAll(
  items: readonly Listing[],
  on: boolean,
  set: (id: string, accepts: boolean, auto: boolean) => Promise<void> = setOfferRules,
): Promise<{ changed: number; failed: number }> {
  const todo = listingsToSwitch(items, on);
  let next = 0;
  let changed = 0;
  let failed = 0;
  const worker = async () => {
    while (next < todo.length) {
      const it = todo[next++];
      try {
        // Turning on: a listing that took no offers had its auto answers off with them (the server keeps
        // auto = accepts AND auto), so false leaves nothing behind. A listing already on is never touched.
        await set(it.id, on, false);
        changed += 1;
      } catch (err) {
        // Not silent: counted, and the screen says how many were not changed.
        console.warn("[declutter] could not change offers on a listing", it.id, err);
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, todo.length) }, worker));
  return { changed, failed };
}
