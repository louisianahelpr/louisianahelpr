/**
 * Start /declutter's first screen from the ENTRY, beside the app's own download (same idea as guestJobsPrefetch.ts).
 *
 * Measured 2026-10-30 (local build, 412 wide, 1.6 Mbps / 150 ms, x4 CPU, signed-in test account): the first item
 * photo waited on a chain, page chunk -> profile -> switches -> items -> photos, so 91% of its time was waiting
 * to start. Reading items and photos at boot alone gained nearly nothing, because cards also wait for drops and
 * watching. So one read, public.declutter_first_screen (SECURITY INVOKER: the row policies decide), answers them all.
 *
 * Uses the session the app would use, sent only to the app's own Supabase, as supabase-js sends it. No usable session,
 * not deployed yet (404), or any failure: nothing is handed over and the page runs today's reads.
 *
 * NOTHING outside the entry may import this file (see guestJobsPrefetch.ts). So the switch keys are a COPY of
 * FEATURE_SWITCH_KEYS, and src/boot/declutterPrefetch.test.ts holds the two equal.
 */
import { anyStoredSession, storedSession } from "./storedSession";
import { startGuestDeclutterPrefetch } from "./guestDeclutterPrefetch";
import { startDeclutterMinePrefetch } from "./declutterMinePrefetch";

/** Copy of FEATURE_SWITCH_KEYS in src/config/featureSwitches.ts (see above). */
export const FIRST_SCREEN_SWITCH_KEYS = [
  "instant_book",
  "switch_canary",
  "declutter",
  "declutter_moving_out",
  "suggest_category",
  "memberships",
  "quotes",
  "declutter_wanted",
  "declutter_price_hint",
  "shops",
  "declutter_haul_away",
  "declutter_add_helpr",
  "declutter_manager",
  "rentals",
  "jobs_poster_fee",
  "applicant_proof",
  "job_reach",
  "price_guidance",
  "declutter_seller_delivery",
  "come_back_emails",
  "refund_requests",
  "sms_alerts",
  "payout_setup",
  "identity_check",
  "paypal_payments",
  "payout_after_hire",
  "checkout_nudge",
  "confirm_reminders",
  "scanner_safe_confirm_links",
  "declutter_refund_requests",
  "card_hold_at_post",
  "declutter_shipping",
  "ai_support_answers",
  "sponsor_25days",
];
export const DECLUTTER_PREFETCH_KEY = "__lhDeclutterPrefetch";

/** Same string as index.html's member /declutter script uses (src/boot/memberDeclutterEarly.test.ts pins it). */
export const MEMBER_DECLUTTER_EARLY_KEY = "__lhMemberDeclutterEarly";
/** An early answer older than this is not used (the page's own freshness rule for the hand-over is longer). */
const EARLY_MAX_AGE_MS = 30_000;

/**
 * Q2705 (lead 11-09): index.html's member /declutter script already fired declutter_first_screen from the HTML, before
 * this file arrived. Its answer (parsed JSON or null, never a rejection) is taken ONCE instead of asking again, only
 * when it was asked as this member, with exactly these switch keys, and recently. Otherwise null: the entry asks.
 */
export function takeEarlyMemberRead(userId: string, now: number = Date.now()): Promise<unknown> | null {
  const w = window as unknown as Record<string, unknown>;
  const e = w[MEMBER_DECLUTTER_EARLY_KEY] as { at?: unknown; userId?: unknown; keys?: unknown; answer?: unknown } | undefined;
  delete w[MEMBER_DECLUTTER_EARLY_KEY];
  if (!e || typeof e.at !== "number" || now - e.at > EARLY_MAX_AGE_MS) return null;
  if (e.userId !== userId || e.keys !== FIRST_SCREEN_SWITCH_KEYS.join(",")) return null;
  const a = e.answer as Promise<unknown> | undefined;
  return a && typeof a.then === "function" ? a : null;
}

/** Called by the entry. No-op unless this is a cold load of /declutter; a visitor with no live session gets the guest reads. */
export function startDeclutterPrefetch(pathname: string): void {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path !== "/declutter" || typeof fetch !== "function") return;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!base || !key) return;
  const session = storedSession(Date.now() / 1000);
  if (!session) {
    // Q2705: a guest's first screen from the entry too (guestDeclutterPrefetch.ts). Only a provable guest (no session
    // stored at all, readable storage): an expiring member's page waits for its refresh and reads as the member.
    if (!anyStoredSession()) startGuestDeclutterPrefetch(base, key, location.search);
    return;
  }
  const answer =
    takeEarlyMemberRead(session.userId) ??
    fetch(`${base.replace(/\/$/, "")}/rest/v1/rpc/declutter_first_screen`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_switch_keys: FIRST_SCREEN_SWITCH_KEYS }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      // A failed prefetch is not an error: the page runs today's reads.
      .catch(() => null);
  (window as unknown as Record<string, unknown>)[DECLUTTER_PREFETCH_KEY] = { at: Date.now(), userId: session.userId, answer };
  // B96 (Q2705/Q2708): the first cards' photos start from the answer, not after the app draws and renders the grid.
  // Only when the link opens on Browse (no ?tab= or tab=browse, no ?view= other than browse: useSectionTab and
  // DeclutterHomeView's rule); another tab never draws these cards, so their photos would only take its bandwidth.
  const q = new URLSearchParams(location.search);
  const opensOnBrowse = (q.get("tab") ?? "browse") === "browse" && (q.get("view") ?? "browse") === "browse";
  // Not when index.html already drew them into the skeleton (its handler on the same answer ran first).
  if (opensOnBrowse) {
    void answer.then((a) => {
      if (document.getElementById("lh-declutter-shell")?.hasAttribute("data-lh-photos")) return;
      preloadFirstCardPhotos(firstCardPhotoPreloads(base, a, session.userId));
    });
  }
  // B81: the tab row's three reads (every tab waits on them), beside this one.
  startDeclutterMinePrefetch(base, key, session);
}

/** Copies of src/lib/declutter (api.ts DECLUTTER_PHOTO_BUCKET, CARD_PHOTO_PX; photoSizes.ts CARD_PHOTO_SMALL_PX, CARD_PHOTO_SIZES): the test pins them. */
const BUCKET = "job-photos";
const CARD_PX = 480;
const SMALL_PX = 340;
export const CARD_SIZES = "(min-width: 640px) 250px, calc(50vw - 26px)";

/**
 * COPY of declutterAboveFoldCount and declutterFirstRowCount (src/components/declutter/DeclutterSkeletons.tsx) for the
 * map-shown grid (the entry cannot know the desktop map choice; a wider map-hidden grid only preloads fewer than it
 * draws). The test holds the copy equal to the original at every width and height it tries.
 */
export function bootFirstRowCount(width: number): number {
  return width < 640 ? 2 : width < 1536 ? 3 : 4;
}
export function bootAboveFoldCount(width: number, height: number): number {
  const photo = width < 640 ? ((width - 40) / 2) * (4 / 3) : 250;
  let rows = 1;
  while (rows < 4 && 338 + rows * (photo + 68) + photo / 2 < height) rows++;
  return bootFirstRowCount(width) * rows;
}

export type CardPhotoPreload = { href: string; srcset: string; high: boolean };

/**
 * The photos of the cards Browse draws above the fold from this answer (Q2705, 11-07: the 3rd card, on the second row
 * at 375x812, was the largest paint and waited until the grid rendered, 8.6 s live). Its items in order, less the
 * member's own (the grid leaves them out), one grid slot each; a slot whose item has a photo gives its first photo (the
 * answer's photos come by position, as DeclutterItemCard's firstPhotos picks). `high`: the first row, which the card
 * asks for with fetchpriority high. The URLs are the card's own src and srcSet (photoCardUrl, cardPhotoSrcSet), so the
 * browser picks the same candidate and the card's request is answered from the preload. Anything not in the expected
 * shape: none.
 */
export function firstCardPhotoPreloads(
  supabaseUrl: string,
  answer: unknown,
  userId: string,
  view: { width: number; height: number } = { width: window.innerWidth, height: window.innerHeight },
): CardPhotoPreload[] {
  const a = answer as { items?: unknown; photos?: unknown } | null;
  if (!a || !Array.isArray(a.items) || !Array.isArray(a.photos)) return [];
  const first = new Map<string, string>();
  for (const p of a.photos as { item_id?: unknown; storage_path?: unknown }[]) {
    if (typeof p?.item_id === "string" && typeof p.storage_path === "string" && !first.has(p.item_id)) first.set(p.item_id, p.storage_path);
  }
  const slots = bootAboveFoldCount(view.width, view.height);
  const firstRow = bootFirstRowCount(view.width);
  const root = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/render/image/public/${BUCKET}/`;
  const out: CardPhotoPreload[] = [];
  let slot = 0;
  for (const i of a.items as { id?: unknown; seller_id?: unknown }[]) {
    if (slot >= slots) break;
    if (typeof i?.id !== "string" || i.seller_id === userId) continue;
    const at = slot++;
    const path = first.get(i.id);
    if (!path || path.includes("?")) continue;
    const url = (px: number) => `${root}${path}?width=${px}&height=${px}&resize=cover&quality=55`;
    out.push({ href: url(CARD_PX), srcset: `${url(SMALL_PX)} ${SMALL_PX}w, ${url(CARD_PX)} ${CARD_PX}w`, high: at < firstRow });
  }
  return out;
}

/** Adds the image preloads, the first row's at high priority (the rest at the browser's own). */
export function preloadFirstCardPhotos(preloads: CardPhotoPreload[]): void {
  for (const p of preloads) {
    const link = document.createElement("link");
    link.rel = "preload";
    link.setAttribute("as", "image");
    link.href = p.href;
    link.setAttribute("imagesrcset", p.srcset);
    link.setAttribute("imagesizes", CARD_SIZES);
    if (p.high) link.setAttribute("fetchpriority", "high");
    document.head.appendChild(link);
  }
}
