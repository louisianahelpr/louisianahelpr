/**
 * declutter-ai-draft: the model's answer, whitelisted, typed and bounded
 * before it reaches the seller's form (the ai-job-builder A-002 rule: model
 * output is untrusted input). Dependency-free so vitest imports it
 * (src/test/declutterAiDraftSanitize.test.ts).
 */
/**
 * The same keys, in the same order, as src/lib/declutter/categoryIcons.ts CATEGORIES (the app's one category list;
 * this function cannot import from src/). src/test/declutterCategoryList.test.ts fails until the two agree. Owner
 * 2026-10-30: Pets and 18 more, Louisiana-specific plus general; "other" last.
 */
export const DECLUTTER_CATEGORIES = [
  "furniture", "appliances", "electronics", "kitchen", "home_decor", "bedding_bath", "storage_organization", "tools",
  "outdoor_garden", "sports_outdoors", "exercise_fitness", "hunting_fishing", "boats_marine", "camping", "bikes", "auto_parts",
  "baby_kids", "toys_games", "clothing", "jewelry_accessories", "health_beauty", "pets", "office_school",
  "books_media", "crafts_hobbies", "musical_instruments", "collectibles_antiques", "holiday_seasonal", "tailgating_game_day", "party_events",
  "moving_supplies", "other",
] as const;

export const DELIVERY_SIZES = ["small", "large", "xl"] as const;

export interface DeclutterDraft {
  title: string;
  description: string;
  category: (typeof DECLUTTER_CATEGORIES)[number];
  deliverySize: (typeof DELIVERY_SIZES)[number];
  conditionStars: number;
  flagged: boolean;
  /** Why the AI thinks the item may be banned (row 34); never shown to buyers. */
  flagReason: string | null;
  /** Claude's suggested starting price in whole dollars ($1-$1,000, the sell form's range), or null. */
  priceDollars: number | null;
  /** One plain line on why that price; null when there is no price or the line made a claim we cannot back. */
  priceReason: string | null;
  /**
   * Photo coach (owner 2026-10-29): which of the photos sent (0-based) makes the best cover, or null
   * when the caller did not say how many it sent (room / group modes) or the answer was not one of them.
   */
  coverPhoto: number | null;
  /** At most one "one more photo would help" tip (e.g. "A photo of the label"), or null. */
  photoTip: string | null;
}

/** Brand / model / size / measurements read from labels, as one line added to the details (never invented: blank when not readable). */
const DETAILS_MAX = 300;

/** The sell form's price range in whole dollars (formProblem: $1-$1,000). */
export const PRICE_MIN_DOLLARS = 1;
export const PRICE_MAX_DOLLARS = 1000;

/**
 * Owner 2026-10-29: never a "retail" claim. A reason that names a store
 * price, an original/new price or a marketplace is dropped (the price stays):
 * we cannot back it, and a buyer could read it as our promise.
 */
const UNBACKED_PRICE_CLAIM = /retail|msrp|\bnew (?:price|cost|one|ones)\b|brand[- ]new price|original(?:ly)? (?:price|cost|sold|paid)|list price|amazon|walmart|target\.com|home depot|lowe'?s|ebay|craigslist|facebook|marketplace|costs? \$\d+ new/i;

/** The model's price: a whole-dollar number in range, else null (the seller types one). */
function priceFrom(raw: unknown): number | null {
  const n = Math.round(Number(raw));
  if (raw === null || raw === undefined || raw === "" || !Number.isFinite(n)) return null;
  if (n < PRICE_MIN_DOLLARS) return null;
  return Math.min(PRICE_MAX_DOLLARS, n);
}

const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();

/**
 * null when the answer is unusable (no title). `photoCount` is how many photos the model was sent
 * (one item's draft); without it there is no cover pick.
 */
export function sanitizeDraft(raw: unknown, photoCount?: number): DeclutterDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? oneLine(r.title).slice(0, 80) : "";
  if (title.length < 3) return null;
  const baseDescription = typeof r.description === "string" ? r.description.trim() : "";
  // Photo coach: what the labels say, as its own line, unless the description already has it.
  const details = typeof r.details === "string" ? oneLine(r.details).slice(0, DETAILS_MAX) : "";
  const description = (details.length >= 3 && !baseDescription.toLowerCase().includes(details.toLowerCase())
    ? (baseDescription ? `${baseDescription}\n${details}` : details)
    : baseDescription).slice(0, 2000);
  const category = (DECLUTTER_CATEGORIES as readonly string[]).includes(r.category as string)
    ? (r.category as DeclutterDraft["category"])
    : "other";
  const deliverySize = (DELIVERY_SIZES as readonly string[]).includes(r.delivery_size as string)
    ? (r.delivery_size as DeclutterDraft["deliverySize"])
    : "large";
  const stars = Math.round(Number(r.condition_stars));
  const conditionStars = Number.isFinite(stars) ? Math.min(5, Math.max(1, stars)) : 3;
  // Fail closed: anything but an explicit `false` from the model is a flag,
  // so a malformed answer sends the listing to an admin, never straight live.
  const flagged = r.possibly_banned !== false;
  const reasonRaw = typeof r.banned_reason === "string" ? oneLine(r.banned_reason).slice(0, 300) : "";
  const flagReason = flagged ? (reasonRaw || "The photo check could not confirm the item is allowed.") : null;
  const priceDollars = priceFrom(r.price_dollars);
  const priceReasonRaw = typeof r.price_reason === "string" ? oneLine(r.price_reason).slice(0, 140) : "";
  const priceReason = priceDollars !== null && priceReasonRaw.length >= 3 && !UNBACKED_PRICE_CLAIM.test(priceReasonRaw) ? priceReasonRaw : null;
  const cover = Number(r.cover_photo);
  const coverPhoto = photoCount !== undefined && Number.isInteger(cover) && cover >= 0 && cover < photoCount ? cover : null;
  const tipRaw = typeof r.photo_tip === "string" ? oneLine(r.photo_tip).slice(0, 120) : "";
  const photoTip = tipRaw.length >= 3 ? tipRaw : null;
  return { title, description, category, deliverySize, conditionStars, flagged, flagReason, priceDollars, priceReason, coverPhoto, photoTip };
}

/** What declutter_price_hint answers: the middle of OUR past sales of the same category and condition nearby. */
export interface SoldRange {
  low_cents: number;
  high_cents: number;
  sales: number;
}

/**
 * Grounds Claude's price in our own sold prices (owner 2026-10-29): when the
 * fair-price hint has a real range (the same validity rule the app applies:
 * at least 10 sales, low at least $1, high >= low), the price is clamped into
 * it and the reason says so in our words. No range: Claude's price as is.
 * The range only bounds the price, and is never a figure to move toward: a price inside it stays. The hint is its
 * category's p10 to p90 at this condition (declutter_price_hint), not this item, so moving toward either end would
 * price a mug like the dearest or cheapest things in Household: the item's own garage-sale figure (owner 2026-11-01)
 * comes from the prompt (PRICE_RULE) or the used-price lookup.
 */
export function groundPrice(draft: DeclutterDraft, hint: SoldRange | null | undefined): DeclutterDraft {
  if (draft.priceDollars === null || !hint) return draft;
  const ok = Number.isInteger(hint.sales) && hint.sales >= 10 && Number.isFinite(hint.low_cents) && Number.isFinite(hint.high_cents)
    && hint.low_cents >= 100 && hint.high_cents >= hint.low_cents;
  if (!ok) return draft;
  const low = Math.max(PRICE_MIN_DOLLARS, Math.ceil(hint.low_cents / 100));
  const high = Math.min(PRICE_MAX_DOLLARS, Math.max(low, Math.floor(hint.high_cents / 100)));
  const price = Math.min(high, Math.max(low, draft.priceDollars));
  const range = low === high ? `$${low}` : `$${low}-$${high}`;
  return { ...draft, priceDollars: price, priceReason: `Items like this sold for ${range} on Declutter near you.` };
}

/** A lat/lng the app sent for the price hint, or null when missing or out of range. */
export function hintPointFromBody(raw: unknown): { lat: number; lng: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const { lat, lng } = raw as { lat?: unknown; lng?: unknown };
  if (typeof lat !== "number" || typeof lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
}

/** Moving-out mode (docs/specs/declutter-moving-out.md): items the model found in room photos. */
const ROOM_MAX_PHOTOS = 4;
export const ROOM_MAX_ITEMS = 15;
/** Decoded bytes per room photo (the app sends 1280px JPEGs, well under this). */
export const ROOM_MAX_PHOTO_BYTES = 1_500_000;

/**
 * The room photos as the app sent them: 1 to ROOM_MAX_PHOTOS base64 JPEGs,
 * each under ROOM_MAX_PHOTO_BYTES once decoded. null when any is not.
 * The photos are only passed to the model; they are never stored.
 */
export function roomPhotosFromBody(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > ROOM_MAX_PHOTOS) return null;
  const out: string[] = [];
  for (const p of raw) {
    if (typeof p !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(p)) return null;
    const bytes = Math.floor((p.length * 3) / 4) - (p.endsWith("==") ? 2 : p.endsWith("=") ? 1 : 0);
    if (bytes < 100 || bytes > ROOM_MAX_PHOTO_BYTES) return null;
    // A JPEG starts FF D8 FF, which is "/9j/" in base64.
    if (!p.startsWith("/9j/")) return null;
    out.push(p);
  }
  return out;
}

/**
 * Each item the model listed, through sanitizeDraft (so each one fails closed
 * on the banned check), unusable ones dropped, at most ROOM_MAX_ITEMS.
 */
export function sanitizeRoom(raw: unknown): DeclutterDraft[] {
  if (!raw || typeof raw !== "object") return [];
  const items = (raw as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const out: DeclutterDraft[] = [];
  for (const it of items) {
    const d = sanitizeDraft(it);
    if (d) out.push(d);
    if (out.length >= ROOM_MAX_ITEMS) break;
  }
  return out;
}

/**
 * "Sell a bunch" (owner 2026-10-29: "upload all pictures for everything they
 * want to sell, ai does the forms and they review all at once"): mode 'group'
 * takes up to GROUP_MAX_PHOTOS photos of SEVERAL items in one call (the app
 * sends more in batches), each a real JPEG under the room cap, all together
 * under GROUP_MAX_TOTAL_BYTES. The photos are only passed to the model.
 */
export const GROUP_MAX_PHOTOS = 8;
const GROUP_MAX_TOTAL_BYTES = 6_000_000;

/** The photos as the app sent them, or null when any is not a valid photo or there are too many or too much. */
export function groupPhotosFromBody(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > GROUP_MAX_PHOTOS) return null;
  const out: string[] = [];
  let total = 0;
  for (const p of raw) {
    const one = roomPhotosFromBody([p]);
    if (!one) return null;
    total += Math.floor((one[0].length * 3) / 4);
    if (total > GROUP_MAX_TOTAL_BYTES) return null;
    out.push(one[0]);
  }
  return out;
}

/** One item the model grouped: its photos (indexes into the photos sent) and its draft. */
export interface GroupedDraft extends DeclutterDraft {
  photos: number[];
}

/**
 * The model's grouping, untrusted: each item through sanitizeDraft (so each
 * fails closed on the banned check), photo indexes kept only when they are
 * whole numbers in range and not already used by an earlier item, items left
 * with no photo dropped. Every photo the model did not place comes back in
 * `leftover`, so the app never loses one.
 */
export function sanitizeGroups(raw: unknown, photoCount: number): { items: GroupedDraft[]; leftover: number[] } {
  const used = new Set<number>();
  const items: GroupedDraft[] = [];
  const list = raw && typeof raw === "object" ? (raw as { items?: unknown }).items : null;
  for (const it of Array.isArray(list) ? list : []) {
    if (items.length >= GROUP_MAX_PHOTOS) break;
    const d = sanitizeDraft(it);
    const idx = it && typeof it === "object" ? (it as { photos?: unknown }).photos : null;
    if (!d || !Array.isArray(idx)) continue;
    const photos: number[] = [];
    for (const n of idx) {
      if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n >= photoCount || used.has(n)) continue;
      used.add(n);
      photos.push(n);
    }
    if (photos.length > 0) items.push({ ...d, photos });
  }
  const leftover: number[] = [];
  for (let i = 0; i < photoCount; i++) if (!used.has(i)) leftover.push(i);
  return { items, leftover };
}
