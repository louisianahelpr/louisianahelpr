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
import { storedSession } from "./storedSession";
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
];
export const DECLUTTER_PREFETCH_KEY = "__lhDeclutterPrefetch";

/** Called by the entry. No-op unless this is a cold load of /declutter with a live session. */
export function startDeclutterPrefetch(pathname: string): void {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path !== "/declutter" || typeof fetch !== "function") return;
  const base = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  const session = storedSession(Date.now() / 1000);
  if (!base || !key || !session) return;
  const answer = fetch(`${base.replace(/\/$/, "")}/rest/v1/rpc/declutter_first_screen`, {
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
  if (opensOnBrowse) void answer.then((a) => {
    for (const p of firstCardPhotoPreloads(base, a, session.userId)) {
      const link = document.createElement("link");
      link.rel = "preload";
      link.setAttribute("as", "image");
      link.href = p.href;
      link.setAttribute("imagesrcset", p.srcset);
      link.setAttribute("imagesizes", CARD_SIZES);
      link.setAttribute("fetchpriority", "high");
      document.head.appendChild(link);
    }
  });
  // B81: the tab row's three reads (every tab waits on them), beside this one.
  startDeclutterMinePrefetch(base, key, session);
}

/** Copies of src/lib/declutter (api.ts DECLUTTER_PHOTO_BUCKET, CARD_PHOTO_PX; photoSizes.ts CARD_PHOTO_SMALL_PX, CARD_PHOTO_SIZES): the test pins them. */
const BUCKET = "job-photos";
const CARD_PX = 480;
const SMALL_PX = 340;
export const CARD_SIZES = "(min-width: 640px) 250px, calc(50vw - 26px)";
/** The first row of Browse's grid at 375 (two cards); the card asks for these with loading eager + fetchpriority high. */
const FIRST_ROW = 2;

/**
 * The photos of the first cards Browse draws from this answer: its items in order, less the member's own (the grid
 * leaves them out), each with its first photo (the answer's photos come by position, as DeclutterItemCard's firstPhotos
 * picks). The URLs are the card's own src and srcSet (photoCardUrl, cardPhotoSrcSet), so the browser picks the same
 * candidate and the card's request is answered from the preload. Anything not in the expected shape: none.
 */
export function firstCardPhotoPreloads(supabaseUrl: string, answer: unknown, userId: string): { href: string; srcset: string }[] {
  const a = answer as { items?: unknown; photos?: unknown } | null;
  if (!a || !Array.isArray(a.items) || !Array.isArray(a.photos)) return [];
  const first = new Map<string, string>();
  for (const p of a.photos as { item_id?: unknown; storage_path?: unknown }[]) {
    if (typeof p?.item_id === "string" && typeof p.storage_path === "string" && !first.has(p.item_id)) first.set(p.item_id, p.storage_path);
  }
  const root = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/render/image/public/${BUCKET}/`;
  const out: { href: string; srcset: string }[] = [];
  for (const i of a.items as { id?: unknown; seller_id?: unknown }[]) {
    if (out.length >= FIRST_ROW) break;
    if (typeof i?.id !== "string" || i.seller_id === userId) continue;
    const path = first.get(i.id);
    if (!path || path.includes("?")) continue;
    const at = (px: number) => `${root}${path}?width=${px}&height=${px}&resize=cover&quality=70`;
    out.push({ href: at(CARD_PX), srcset: `${at(SMALL_PX)} ${SMALL_PX}w, ${at(CARD_PX)} ${CARD_PX}w` });
  }
  return out;
}
