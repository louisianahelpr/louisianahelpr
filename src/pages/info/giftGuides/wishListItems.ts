import { useEffect, useState, useSyncExternalStore } from "react";
import { GUIDES, guideBySlug, guidePicksVersion, loadGuidePicks, picksReady, subscribeGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";
import { DEALS_SLUG, type Deal } from "@/content/giftGuideDeals.mjs";
import { SMALL_BIZ_SLUG, type SmallBiz } from "@/content/giftGuideSmallBiz.mjs";
import { loadModule } from "@/lib/loadModule";
import { itemId, type WishRef } from "./giftList";
import { storeLabel } from "./GiftGuideView";

/**
 * A wish list's refs ({guide slug, item id}) turned back into gifts to draw (My Wish List and a shared list's page).
 * Only the sources the refs name are fetched: each named guide's picks chunk, the deals file, the Small Business file.
 * A ref the guides no longer carry is left out (never a dead row or link). Every Shop link is the guide's own link, so
 * an affiliate link stays an affiliate link on a shared list too.
 */
export interface WishItem {
  /** The item id (the ref's `i`). */
  id: string;
  name: string;
  /** Where it is sold ("Amazon", a brand), for the row's small line. */
  store: string;
  image?: string;
  href: string;
  /** "affiliate": opened through GiftOut (sponsored); "plain": a small business's own page (Small Business Saturday). */
  out: "affiliate" | "plain";
  /** The catalog pick, when it is one (its photo tile and price draw from it). */
  pick?: CatalogPick;
}

// The deals and Small Business files, fetched once per visit and shared by every list on the page.
let deals: Deal[] | null = null;
let biz: SmallBiz[] | null = null;
let dealsLoad: Promise<void> | null = null;
let bizLoad: Promise<void> | null = null;
let version = 0;
const listeners = new Set<() => void>();
const bump = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const loadDeals = () =>
  (dealsLoad ??= loadModule(() => import("@/content/giftGuideDeals.json")).then((m) => {
    if (m) {
      deals = m.default as Deal[];
      bump();
    }
  }));
const loadBiz = () =>
  (bizLoad ??= loadModule(() => import("@/content/giftGuideSmallBiz.json")).then((m) => {
    if (m) {
      biz = m.default as SmallBiz[];
      bump();
    }
  }));

/** A pick's item id (its link). */
const pickItemId = (p: { href: string }) => itemId(p.href);
/** A deal card's item id (its link). */
export const dealItemId = (d: Deal) => itemId(d.href);
/** A business's item id (its slug: its Visit link can change between website and Facebook). */
export const bizItemId = (b: SmallBiz) => itemId(`biz:${b.slug}`);

/**
 * A deal card's name on a list: the product, led by the brand unless the product's own name already starts with it
 * (UX audit L2: "ELEMIS: ELEMIS Pro-Collagen..."), else the brand and the sale.
 */
export const dealName = (d: Deal) => {
  if (!d.item) return `${d.brand}: ${d.deal}`;
  return d.item.toLowerCase().startsWith(d.brand.toLowerCase()) ? d.item : `${d.brand}: ${d.item}`;
};

const fromPick = (p: CatalogPick): WishItem => ({ id: pickItemId(p), name: p.name, store: storeLabel(p), image: p.image, href: p.href, out: "affiliate", pick: p });

/** One ref as a gift, or undefined while its source is not in (or when it is gone). */
function resolve(r: WishRef): WishItem | undefined {
  if (r.g === DEALS_SLUG) {
    const d = deals?.find((x) => dealItemId(x) === r.i);
    return d && { id: r.i, name: dealName(d), store: d.store ?? d.brand, image: d.image, href: d.href, out: "affiliate" };
  }
  if (r.g === SMALL_BIZ_SLUG) {
    const b = biz?.find((x) => bizItemId(x) === r.i);
    // UX audit L6: a business with no link can be saved too; its row then has no Visit button.
    return b && { id: r.i, name: b.name, store: b.town || "Louisiana", image: b.logo, href: b.href ?? "", out: "plain" };
  }
  const own = guideBySlug(r.g)?.picks.find((p) => pickItemId(p) === r.i);
  if (own) return fromPick(own);
  // The same gift saved from another guide (or a guide that has since been folded): any loaded guide holding it.
  for (const g of GUIDES) {
    const hit = g.picks.find((p) => pickItemId(p) === r.i);
    if (hit) return fromPick(hit);
  }
  return undefined;
}

/** True when every source these refs name is in (or failed): the list is drawn complete. */
const settled = (refs: WishRef[], failed: Set<string>) =>
  refs.every((r) =>
    r.g === DEALS_SLUG ? deals !== null || failed.has(DEALS_SLUG)
    : r.g === SMALL_BIZ_SLUG ? biz !== null || failed.has(SMALL_BIZ_SLUG)
    : !guideBySlug(r.g) || picksReady(r.g) || failed.has(r.g));

/**
 * The gifts for these refs, in order, each once, plus whether every source they need is in yet (`loading`).
 * `refs` with an empty guide (an old save) are looked up in every loaded guide.
 */
export function useWishItems(refs: WishRef[]): { items: WishItem[]; loading: boolean; missing: number; missingIds: string[] } {
  useSyncExternalStore(subscribeGuidePicks, guidePicksVersion, guidePicksVersion);
  useSyncExternalStore(subscribe, () => version, () => version);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const need = [...new Set(refs.map((r) => r.g))].sort().join(" ");
  useEffect(() => {
    for (const g of need.split(" ").filter(Boolean)) {
      const fail = (e: unknown) => {
        // A failed chunk only leaves that source's gifts off the list this visit.
        console.warn("gift wish list: source failed", g, e);
        setFailed((s) => new Set(s).add(g));
      };
      if (g === DEALS_SLUG) loadDeals().catch(fail);
      else if (g === SMALL_BIZ_SLUG) loadBiz().catch(fail);
      else if (guideBySlug(g)) loadGuidePicks(g).catch(fail);
    }
  }, [need]);
  const seen = new Set<string>();
  const items = refs.map(resolve).filter((x): x is WishItem => x !== undefined && !seen.has(x.id) && !!seen.add(x.id));
  const loading = !settled(refs, failed);
  // UX audit M7: gifts the guides no longer carry (counted once everything they need is in), never silently gone.
  const missingIds = loading ? [] : [...new Set(refs.map((r) => r.i))].filter((i) => !seen.has(i));
  return { items, loading, missing: missingIds.length, missingIds };
}
