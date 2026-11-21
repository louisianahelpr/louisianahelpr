/**
 * Declutter selling boost (owner 11-20): the pure parts of sharing a listing, kept apart from React so they are tested
 * on their own (src/test/declutterSellingBoost.test.tsx).
 *
 *  - listingUrl / facebookShareUrl: the item's public page, and Facebook's share dialog for it. The preview Facebook
 *    shows is built server-side for /declutter/item/<id> (api/share.ts; train-1120e's api/og-item.ts restyles it).
 *  - shareToFacebookPath: which way one tap on "Share to Facebook" goes. On a phone (the app, or a touch browser with
 *    the share sheet) it is the share sheet, where Facebook, Messenger and the groups are; on a computer it is
 *    Facebook's own share dialog in a new tab. A blocked pop-up falls back to copying the link (the component).
 *  - groupPostText: the suggested words for a local buy/sell group post. Short and plain; no affiliate wording.
 *  - trackShareClick: the share-click event. Only the method and the screen it came from: no item id, title, price,
 *    town, name or link (the row's user_id is analytics.ts's usual one, nothing added here).
 */
import { track } from "@/lib/analytics";
import { itemPriceLabel } from "./distance";

export type ShareMethod = "facebook" | "native" | "copy";
/** Where the tap was: the item page, the sheet right after listing, or a row in Selling's list. */
export type ShareSurface = "item" | "listed" | "listings";

export const SHARE_CLICK_EVENT = "declutter_share_click";

export function listingUrl(origin: string, itemId: string): string {
  return `${origin.replace(/\/+$/, "")}/declutter/item/${encodeURIComponent(itemId)}`;
}

export function facebookShareUrl(itemUrl: string): string {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(itemUrl)}`;
}

export interface ShareEnv {
  /** Running inside the iOS/Android app (Capacitor's share sheet). */
  native: boolean;
  /** navigator.share exists. */
  webShare: boolean;
  /** A touch screen (matchMedia("(pointer: coarse)")): a phone or tablet, not a computer with Safari's share menu. */
  coarse: boolean;
}

/** One tap on "Share to Facebook": the phone's share sheet, else Facebook's own share dialog. */
export function shareToFacebookPath(env: ShareEnv): "native" | "facebook" {
  return env.native || (env.webShare && env.coarse) ? "native" : "facebook";
}

/** What the plain Share button does: the share sheet when there is one, else it copies the link. */
export function plainSharePath(env: Pick<ShareEnv, "native" | "webShare">): "native" | "copy" {
  return env.native || env.webShare ? "native" : "copy";
}

/** The browser's share environment, read at tap time. Never throws (a missing matchMedia is a computer). */
export function readShareEnv(native: boolean): ShareEnv {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  let coarse = false;
  try {
    coarse = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  } catch {
    // An old WebView whose matchMedia throws: coarse stays false, so it is treated as a computer (Facebook's dialog).
  }
  return { native, webShare: typeof nav?.share === "function", coarse };
}

export interface GroupPostListing {
  title: string;
  current_price_cents: number;
  area_label?: string | null;
}

/** The suggested group post: "Selling my oak rocking chair for $85 in Delcambre. Message me here: <link>". */
export function groupPostText(it: GroupPostListing, url: string): string {
  const what = it.title.trim();
  const where = it.area_label?.trim() ? ` in ${it.area_label.trim()}` : "";
  if (it.current_price_cents === 0) return `Giving away my ${what}${where}, free to a good home. Grab it here: ${url}`;
  return `Selling my ${what} for ${itemPriceLabel(it.current_price_cents)}${where}. Message me here: ${url}`;
}

export function trackShareClick(method: ShareMethod, surface: ShareSurface): void {
  track(SHARE_CLICK_EVENT, { method, surface });
}
