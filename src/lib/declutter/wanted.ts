/**
 * Declutter wanted posts
 * (docs/specs/declutter-wanted-price-hint.md, W1-W14). Every call is a
 * declutter_* RPC that refuses server-side without its hidden switch, so this
 * file is never the protection. Refusals carry plain words on `userMessage`
 * (RPC_ERROR_COPY via rpcErrorMessage); screens show declutterErrorMessage().
 */
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { DECLUTTER_PHOTO_BUCKET, invokeAiBody, rpcData } from "@/lib/declutter/api";
import { cleanListingPhoto, LISTING_PHOTO_UPLOAD_TYPES } from "@/lib/declutter/photos";
import { IMMUTABLE_OBJECT_CACHE_CONTROL } from "@/lib/storageCacheControl";
import { report } from "@/lib/errorLogger";

/** The distances a wanted post can reach (W5; the Browse choices without "any"). */
export const WANTED_RADIUS_CHOICES = [5, 10, 25, 50] as const;
type WantedRadius = (typeof WANTED_RADIUS_CHOICES)[number];

export interface WantedPost {
  id: string;
  what: string;
  category: string;
  max_price_cents: number;
  radius_miles: number;
  /** 'expired' is computed by the server: open, past its 30 days (W2). */
  status: "open" | "closed" | "expired";
  expires_at: string;
  created_at: string;
  /** Live listings that match now at or under the price, cheapest first (public fields only). */
  matches: WantedMatch[];
  /** Q2267: sellers near the poster may see it and reply (absent before 20261021031757 is on prod). */
  public?: boolean;
  /** 20261030064727: up to 3 photos of what the poster wants (job-photos paths). */
  photo_paths: string[];
  /** 20261030064727: the sellers' replies to this post (each an offer to the poster), newest first. */
  replies: WantedReply[];
}

/** One seller's reply to your post: an offer from one of their listings. Never a seller id (First L. only). */
export interface WantedReply {
  offer_id: string;
  item_id: string;
  item_title: string;
  /** First L., or "A neighbor". */
  seller_name: string;
  amount_cents: number;
  status: "open" | "accepted" | "declined" | "expired" | "withdrawn" | "voided";
  awaiting: "buyer" | "seller";
  created_at: string;
  /** Audit 10-30 #19: the listing's first photo, or null; absent before the migration is on prod. */
  photo_path?: string | null;
}

/** Q2267: a public Wanted post near the reader. Never a user id or coordinates (declutter_wanted_browse). */
export interface WantedNear {
  id: string;
  what: string;
  category: string;
  max_price_cents: number;
  /** First L., or "A neighbor". */
  poster_name: string;
  /** Whole miles from a point snapped to a few miles. */
  miles: number;
  expires_at: string;
  /** The reader already answered it. */
  replied: boolean;
  /** 20261030064727: the post's first photo (job-photos path), or null; absent before it is on prod. */
  photo_path?: string | null;
  /** Audit 10-30 #19: all of the post's photos; absent before the migration is on prod. */
  photo_paths?: string[];
}

export interface WantedMatch {
  id: string;
  title: string;
  price_cents: number;
}


export interface WantedForm {
  what: string;
  category: string;
  maxPrice: string;
  radius: WantedRadius;
}

/** Whole dollars or dollars and cents ("80", "79.50") to cents, else null. */
export function dollarsToCents(v: string): number | null {
  const t = v.trim().replace(/^\$/, "");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/** Latin letters with accents (Spanish, French, Louisiana words); the server's declutter_wanted_text_problem says the same. */
const LETTER = "A-Za-zÀ-ÖØ-öø-ÿĀ-ſ";
const WANTED_ALLOWED_CHAR = new RegExp(`[${LETTER}0-9 .,'’&()/#+"“”-]`);
const WANTED_LINK = new RegExp(`[${LETTER}]\\.[${LETTER}]`);

function wantedWordsProblem(raw: string): string | null {
  const what = raw.trim().replace(/\s+/g, " ");
  if (what.length < 3 || what.length > 60) return "Say what you want in 3 to 60 letters, like \"crib\" or \"oak dresser\".";
  // Audit 10-30 #11: names the character, so the member knows what to change.
  const refused = [...what].find((c) => !WANTED_ALLOWED_CHAR.test(c));
  if (refused) return `Take out the "${refused}". Use letters and numbers only. No links, phone numbers or emails.`;
  if (WANTED_LINK.test(what)) return "Leave out web addresses, or put a space after the dot.";
  if (what.replace(/[^0-9]/g, "").length >= 7 || /(\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b[^a-z0-9]*){4,}/i.test(what)) {
    return "Leave out phone numbers.";
  }
  return null;
}

export type WantedFormProblems = Partial<Record<"what" | "category" | "maxPrice" | "radius", string>>;

/**
 * The same rules the server applies (declutter_create_wanted, W8), checked first so the member gets the words before a
 * round trip. Every problem at once, by field (audit 10-30 #22); empty when the form can be sent.
 */
export function wantedFormProblems(f: WantedForm): WantedFormProblems {
  const out: WantedFormProblems = {};
  const what = wantedWordsProblem(f.what);
  if (what) out.what = what;
  if (!f.category) out.category = "Pick a category.";
  const cents = dollarsToCents(f.maxPrice);
  if (cents === null || cents < 100 || cents > 100_000 || cents % 100 !== 0) out.maxPrice = "Set your highest price in whole dollars, $1 to $1,000.";
  if (!WANTED_RADIUS_CHOICES.includes(f.radius)) out.radius = "Pick how far you'd go.";
  return out;
}

/** The server's matches list (jsonb), keeping only well-formed entries. */
export function parseMatches(raw: unknown): WantedMatch[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (m): m is WantedMatch =>
      !!m && typeof m === "object" && typeof (m as WantedMatch).id === "string"
      && typeof (m as WantedMatch).title === "string" && Number.isInteger((m as WantedMatch).price_cents),
  );
}

/**
 * Post a Wanted. ALWAYS visible to sellers near the poster (owner 2026-10-30, via the lead: "Wanted exists so sellers
 * reply"), so p_public is always true: the "Let sellers near me reply" switch is gone, and what sellers see (first
 * name, what you want, your max price, never your address) is said as plain text under the form. The server's
 * p_public DEFAULT false (20261021031757) is left alone; this app is its only caller and always sends true.
 */
export async function createWanted(f: WantedForm, at: { lat: number; lng: number }): Promise<string> {
  const cents = dollarsToCents(f.maxPrice);
  return rpcData(
    await supabase.rpc("declutter_create_wanted", {
      p_what: f.what.trim(), p_category: f.category, p_max_price_cents: cents ?? 0, p_radius_miles: f.radius, p_lat: at.lat, p_lng: at.lng, p_public: true,
    }),
    (e) => rpcErrorMessage("declutter_create_wanted", e),
  ) as string;
}

/** Q2267: public Wanted posts near a point; [] before the migration is on prod. */
export async function fetchWantedNear(at: { lat: number; lng: number }): Promise<WantedNear[]> {
  const res = await supabase.rpc("declutter_wanted_browse", { p_lat: at.lat, p_lng: at.lng });
  if (res.error && isMissingRpcNamed(res.error, "declutter_wanted_browse")) return [];
  return (rpcData(res, (e) => rpcErrorMessage("declutter_wanted_browse", e)) ?? []) as WantedNear[];
}

export interface ReplyListing {
  id: string;
  title: string;
  current_price_cents: number;
  /** Audit 10-30 #12: what Send would refuse; null or absent when the listing can answer. */
  refuses?: "too_far" | "open_offer" | null;
}

/**
 * Q2267: your listings that can answer a Wanted post: any listing for sale now (audit W7, 20261030064727: no longer
 * only sale_mode 'offers'). The server also checks the listing is inside the post's distance (W6, listing_too_far).
 */
export async function fetchMyReplyListings(userId: string, wantedId: string): Promise<ReplyListing[]> {
  // Audit 10-30 #12: the server says which listings it would refuse, before Send. Until that is on prod: all of them.
  const res = await supabase.rpc("declutter_my_reply_listings", { p_wanted_id: wantedId });
  if (!res.error || !isMissingRpcNamed(res.error, "declutter_my_reply_listings")) {
    return (rpcData(res, (e) => rpcErrorMessage("declutter_my_reply_listings", e)) ?? []) as ReplyListing[];
  }
  const rows = unwrap(
    await supabase
      .from("declutter_items")
      .select("id, title, current_price_cents")
      .eq("seller_id", userId)
      .eq("status", "live")
      .order("created_at", { ascending: false }),
  );
  return (rows ?? []) as ReplyListing[];
}

/**
 * Audit 10-30 #5: the post a seller's alert points at, read from their listing's own area (the distance the alert was
 * measured by), since the reader may be somewhere else today. Null when it is closed, gone or no longer in reach.
 */
export async function fetchWantedFromAlert(wantedId: string, itemId: string): Promise<WantedNear | null> {
  const row = unwrap(await supabase.from("declutter_items").select("area_lat, area_lng").eq("id", itemId).maybeSingle());
  if (!row || row.area_lat === null || row.area_lng === null) return null;
  const near = await fetchWantedNear({ lat: Number(row.area_lat), lng: Number(row.area_lng) });
  return near.find((w) => w.id === wantedId) ?? null;
}

/** Audit 10-30 #12: a free listing has no price to offer (the server takes at least $1), so it can't answer a post. */
export function canAnswerWanted(item: { current_price_cents: number }): boolean {
  return item.current_price_cents >= 100;
}

/** Q2267 "I have this": an offer from one of your live listings, awaiting the poster. Returns the offer id. */
export async function replyToWanted(wantedId: string, itemId: string, cents: number): Promise<string> {
  return rpcData(
    await supabase.rpc("declutter_wanted_reply", { p_wanted_id: wantedId, p_item_id: itemId, p_amount_cents: cents }),
    (e) => rpcErrorMessage("declutter_wanted_reply", e),
  ) as string;
}

/**
 * Quick-list from "I have this" (owner 2026-10-30): a seller with nothing listed that fits lists it right from the
 * post. The sell flow is the shared one (photos, Claude's draft, the automatic photo check); this link only tells it
 * which post to answer once the listing is live. Nothing in it is trusted: the server re-checks every rule
 * (declutter_wanted_reply: the post, the distance, the amount at most their price and the listing's price).
 */
export interface WantedAnswer { wantedId: string; maxCents: number; what: string }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function quickListHref(post: { id: string; max_price_cents: number; what: string }): string {
  const q = new URLSearchParams({ answer: post.id, max: String(post.max_price_cents), what: post.what });
  return `/declutter/sell?${q.toString()}`;
}

/** The post a new listing answers, from the sell page's address; null when absent or malformed. */
export function readWantedAnswer(params: URLSearchParams): WantedAnswer | null {
  const wantedId = params.get("answer") ?? "";
  const maxCents = Number(params.get("max"));
  if (!UUID_RE.test(wantedId) || !Number.isInteger(maxCents) || maxCents < 100) return null;
  return { wantedId, maxCents, what: (params.get("what") ?? "").slice(0, 60) };
}

/**
 * After Post: a listing that went LIVE (a clean automatic check) answers the post at once, at the lower of their
 * Wanted price and the listing's price. A listing waiting for review cannot answer yet (the server takes only a live
 * listing), and a free one has no price to offer: both say so instead of sending.
 */
export async function answerAfterListing(
  a: WantedAnswer, itemId: string, status: "live" | "pending_review", priceCents: number | null,
): Promise<{ kind: "sent"; cents: number } | { kind: "checking" } | { kind: "free" }> {
  if (status !== "live") return { kind: "checking" };
  const cents = priceCents === null ? 0 : Math.min(a.maxCents, priceCents);
  if (cents < 100) return { kind: "free" };
  await replyToWanted(a.wantedId, itemId, cents);
  return { kind: "sent", cents };
}

/** Audit 10-30 #9: change your own open post. The server checks everything again and matches it again. */
export async function updateWanted(id: string, f: WantedForm): Promise<string> {
  return rpcData(
    await supabase.rpc("declutter_update_wanted", {
      p_wanted_id: id, p_what: f.what.trim(), p_category: f.category, p_max_price_cents: dollarsToCents(f.maxPrice) ?? 0, p_radius_miles: f.radius,
    }),
    (e) => rpcErrorMessage("declutter_update_wanted", e),
  ) as string;
}

/** Audit 10-30 #9: post a closed or expired post again, for another 30 days. */
export async function reopenWanted(id: string): Promise<string> {
  return rpcData(await supabase.rpc("declutter_reopen_wanted", { p_wanted_id: id }), (e) => rpcErrorMessage("declutter_reopen_wanted", e)) as string;
}

/** Audit 10-30 #9: take a post off your list for good, and delete its photos (best effort: it no longer holds them). */
export async function removeWanted(id: string): Promise<void> {
  const paths = rpcData(await supabase.rpc("declutter_remove_wanted", { p_wanted_id: id }), (e) => rpcErrorMessage("declutter_remove_wanted", e)) as string[] | null;
  if (paths && paths.length > 0) await deleteWantedObjects(paths);
}

/** Audit 10-30 #8: block a post's poster. The post is the handle, so the app never holds their id. */
export async function blockWantedPoster(id: string): Promise<string> {
  return rpcData(await supabase.rpc("declutter_block_wanted_poster", { p_wanted_id: id }), (e) => rpcErrorMessage("declutter_block_wanted_poster", e)) as string;
}

export async function closeWanted(id: string): Promise<string> {
  return rpcData(await supabase.rpc("declutter_close_wanted", { p_wanted_id: id }), (e) => rpcErrorMessage("declutter_close_wanted", e)) as string;
}

export async function fetchMyWanted(): Promise<WantedPost[]> {
  const rows = rpcData(await supabase.rpc("declutter_my_wanted"), (e) => rpcErrorMessage("declutter_my_wanted", e));
  return (rows ?? []).map((w) => ({
    ...w,
    status: w.status as WantedPost["status"],
    matches: parseMatches(w.matches),
    // 20261030064727: absent before it reaches prod, so both read as none.
    photo_paths: Array.isArray(w.photo_paths) ? w.photo_paths : [],
    replies: parseReplies(w.replies),
  }));
}

/** The replies on one of your posts (declutter_my_wanted.replies); anything malformed is dropped. */
function parseReplies(raw: unknown): WantedReply[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is WantedReply =>
    !!r && typeof r === "object" && typeof (r as WantedReply).offer_id === "string" && typeof (r as WantedReply).item_id === "string"
    && typeof (r as WantedReply).amount_cents === "number" && typeof (r as WantedReply).status === "string");
}

/** At most this many photos on a Wanted post (declutter_wanted_photo_paths_max3). */
export const WANTED_PHOTO_MAX = 3;

/** Where a Wanted photo lives: the poster's own folder for THIS post (declutter_add_wanted_photo checks each part). */
function wantedPhotoPath(userId: string, wantedId: string, nonce: string): string {
  return `${userId}/wanted/${wantedId}/${nonce}.jpg`;
}

/**
 * Clean (EXIF and location stripped, shrunk, re-encoded: cleanListingPhoto, as for listings), upload and attach one
 * photo to your own open post. The object is uploaded first (the server attaches only an object that exists and is
 * yours); when the attach is refused the object is deleted again, best effort, and the refusal is thrown.
 */
export async function addWantedPhoto(userId: string, wantedId: string, file: File): Promise<number> {
  const cleaned = await cleanListingPhoto(file);
  if (!LISTING_PHOTO_UPLOAD_TYPES.includes(cleaned.type)) throw new Error("photo_not_uploaded");
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const path = wantedPhotoPath(userId, wantedId, nonce);
  const bucket = supabase.storage.from(DECLUTTER_PHOTO_BUCKET);
  const { error: upErr } = await bucket.upload(path, cleaned, { contentType: "image/jpeg", upsert: false, cacheControl: IMMUTABLE_OBJECT_CACHE_CONTROL });
  if (upErr) throw new Error("photo_not_uploaded");
  const { data, error } = await supabase.rpc("declutter_add_wanted_photo", { p_wanted_id: wantedId, p_storage_path: path });
  if (error) {
    const { error: rmErr } = await bucket.remove([path]);
    if (rmErr) console.warn("[declutter] could not remove a refused Wanted photo upload", rmErr.message);
    const words = rpcErrorMessage("declutter_add_wanted_photo", error);
    throw Object.assign(new Error(error.message), error, words ? { userMessage: words } : {});
  }
  return data as number;
}

/**
 * Audit 10-30 #8: the automatic check on a post's new photos, the one listings get. Members see a photo only once it
 * passes (declutter_wanted_browse), so nothing here can show one early, and the post's words are up either way. Asked
 * twice; a check that never comes back reaches an admin through the sweep after an hour. Says whether a photo was held.
 */
export async function checkWantedPhotos(wantedId: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const answer = (await invokeAiBody({ mode: "wanted_check", wantedId })) as { flagged?: boolean };
      return answer.flagged === true;
    } catch (err) {
      console.warn("[declutter] Wanted photo check did not finish", err);
    }
  }
  return false;
}

/** Take a photo off your own post, then delete its object (the storage rule allows it once no post holds it). */
export async function removeWantedPhoto(wantedId: string, path: string): Promise<number> {
  const left = rpcData(
    await supabase.rpc("declutter_remove_wanted_photo", { p_wanted_id: wantedId, p_storage_path: path }),
    (e) => rpcErrorMessage("declutter_remove_wanted_photo", e),
  ) as number;
  await deleteWantedObjects([path]);
  return left;
}

/** Where a Wanted photo object that could not be deleted yet waits for the next try (this device only). */
export const WANTED_PURGE_KEY = "lh.declutter.wantedPhotoPurge.v1";
/** Tries per delete before the paths are kept for later; the pause before each retry, in ms. */
const WANTED_PURGE_TRIES = 3;
export const wantedPurgeTiming = { retryMs: 800 };

function readPurgeQueue(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(WANTED_PURGE_KEY) ?? "[]") as unknown;
    return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === "string") : [];
  } catch (e) {
    // No storage (private mode) or a damaged value: nothing is waiting here.
    console.warn("[declutter] Wanted photo retry list unreadable", e instanceof Error ? e.message : String(e));
    return [];
  }
}

function writePurgeQueue(paths: string[]): void {
  try {
    if (paths.length === 0) localStorage.removeItem(WANTED_PURGE_KEY);
    else localStorage.setItem(WANTED_PURGE_KEY, JSON.stringify([...new Set(paths)].slice(-50)));
  } catch (e) {
    // Storage full or blocked: the failure was already reported to ops with the paths, so it is not lost.
    console.warn("[declutter] Wanted photo retry list not saved", e instanceof Error ? e.message : String(e));
  }
}

/** One delete through the Storage API; a network failure may come back as an error OR be thrown. */
async function tryRemove(paths: string[]): Promise<string | null> {
  try {
    const { error } = await supabase.storage.from(DECLUTTER_PHOTO_BUCKET).remove(paths);
    return error ? error.message : null;
  } catch (e) {
    // Not swallowed: the failure is returned, retried, and reported by deleteWantedObjects.
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * B67: delete a Wanted post's photo objects from the poster's own folder (the storage rule allows it once no post
 * holds them). The post already let go of them, so a failure must not undo or block that, but it must not vanish
 * either: the object would stay public by URL. Retried, then reported to ops (error_logs, with the paths) and kept
 * on this device; the next visit to Wanted (fetchMyWanted) tries again. Says whether the objects are gone.
 */
export async function deleteWantedObjects(paths: string[]): Promise<boolean> {
  if (paths.length === 0) return true;
  let failure: string | null = null;
  for (let attempt = 1; attempt <= WANTED_PURGE_TRIES; attempt++) {
    if (attempt > 1) await new Promise((r) => setTimeout(r, wantedPurgeTiming.retryMs * (attempt - 1)));
    failure = await tryRemove(paths);
    if (failure === null) {
      writePurgeQueue(readPurgeQueue().filter((p) => !paths.includes(p)));
      return true;
    }
  }
  writePurgeQueue([...readPurgeQueue(), ...paths]);
  report(new Error(`Wanted photo objects not deleted: ${failure}`), {
    severity: "warning",
    tags: { area: "declutter", op: "wanted_photo_delete" },
    context: { paths: paths.join(","), tries: WANTED_PURGE_TRIES },
  });
  return false;
}

/** B67: retry the Wanted photo deletes kept on this device; only the signed-in poster's own folder is tried. */
export async function retryWantedPhotoDeletes(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  const mine = readPurgeQueue().filter((p) => p.startsWith(`${userId}/wanted/`));
  if (mine.length === 0) return;
  if ((await tryRemove(mine)) === null) writePurgeQueue(readPurgeQueue().filter((p) => !mine.includes(p)));
}
