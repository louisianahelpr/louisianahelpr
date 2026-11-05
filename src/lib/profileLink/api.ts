/**
 * The member's shareable profile link (LEAD-PROFILE-LINK, owner 2026-10-31 ~10:50 PM:
 * "Every member gets one shareable profile link (e.g. louisianahelpr.com/u/<handle>)").
 *
 * The handle is server-owned (20261101034834): made from the member's public name the first time
 * it is needed (rpc_ensure_my_handle), and changeable once (rpc_set_my_handle). Both calls read
 * their refusals' words through ./errorCopy.
 */
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { shareNative, type ShareOutcome } from "@/lib/nativeShare";
import { rpcErrorMessage } from "./errorCopy";

/** What a caller shows when a call fails: the code's words, or a plain fallback. */
type HandleResult = { handle: string; error?: undefined } | { handle?: undefined; error: string };

/** The published site (same origin as the Book me and shop links): a link copied in the app opens the website. */
const SITE_ORIGIN = "https://www.louisianahelpr.com";

const NOT_YET = "Profile links aren't available yet. Try again soon.";
const GENERIC = "We couldn't load your profile link. Check your connection and try again.";

/** The same rule the server checks (profiles_handle_format), so the field can say so before a round trip. */
export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$/;

/** "eli-b" -> "https://www.louisianahelpr.com/u/eli-b". */
export function profileLinkUrl(handle: string): string {
  return `${SITE_ORIGIN}/u/${encodeURIComponent(handle)}`;
}

/** "eli-b" -> "louisianahelpr.com/u/eli-b": the link as a person reads it. */
export function profileLinkLabel(handle: string): string {
  return `louisianahelpr.com/u/${handle}`;
}

/** One cache entry for the signed-in member's handle (every member has one from sign-up, 20261104142602). */
export const MY_HANDLE_KEY = ["profile-link", "my-handle"] as const;

/** The caller's handle (made at sign-up; made from their name here for a member who has none). */
export async function ensureMyHandle(): Promise<HandleResult> {
  const { data, error } = await supabase.rpc("rpc_ensure_my_handle");
  if (error) {
    if (isMissingRpcNamed(error, "rpc_ensure_my_handle")) return { error: NOT_YET };
    return { error: rpcErrorMessage("rpc_ensure_my_handle", error) ?? GENERIC };
  }
  return typeof data === "string" && data ? { handle: data } : { error: GENERIC };
}

/** Pick your own handle (once). */
export async function setMyHandle(next: string): Promise<HandleResult> {
  const { data, error } = await supabase.rpc("rpc_set_my_handle", { p_handle: next });
  if (error) {
    if (isMissingRpcNamed(error, "rpc_set_my_handle")) return { error: NOT_YET };
    return { error: rpcErrorMessage("rpc_set_my_handle", error) ?? "We couldn't save that link. Try again." };
  }
  return typeof data === "string" && data ? { handle: data } : { error: GENERIC };
}

/**
 * Share my profile: the OS share sheet on iOS/Android, the Web Share API where a browser has one,
 * else the link is copied with a visible confirmation (shareNative's ladder).
 */
export function shareMyProfile(handle: string, name?: string | null): Promise<ShareOutcome> {
  const who = (name ?? "").trim();
  return shareNative({
    title: who ? `${who} on Louisiana Helpr` : "My Louisiana Helpr profile",
    text: who ? `See what ${who} posts and does on Louisiana Helpr.` : "See what I post and do on Louisiana Helpr.",
    url: profileLinkUrl(handle),
    dialogTitle: "Share my profile",
  });
}

/**
 * Share MY page from any own-profile Share button (owner 2026-11-05, share-profile audit H5: one profile link,
 * /u/<handle>; never the old /book/<id> or members-only /user/<id>). Reads the handle the same way YourPageLink
 * does; a failed read says why in a toast and shares nothing.
 */
export async function shareMyPage(name?: string | null): Promise<ShareOutcome | "no_handle"> {
  const out = await ensureMyHandle();
  if (!out.handle) {
    toast.error(out.error ?? GENERIC);
    return "no_handle";
  }
  return shareMyProfile(out.handle, name);
}

/** The public /u/<handle> page's data (public_profile_by_handle, 20261101041833): public fields only. */
export interface PublicProfile {
  handle: string;
  name: string;
  photo_url: string | null;
  member_since: string;
  stats: {
    review_count?: number | null;
    avg_rating?: number | null;
    completed_jobs_as_helper?: number | null;
    completed_jobs_total?: number | null;
    posted_jobs_total?: number | null;
    on_time_rate?: number | null;
    repeat_hire_percent?: number | null;
    is_id_verified?: boolean | null;
    is_background_checked?: boolean | null;
  };
  /** Owner request 11-05 ("a full profile"): the fields get_safe_profiles already gives anyone (20261105_public_profile_full). */
  bio?: string | null;
  town?: string | null;
  skills?: string | null;
  portfolio_urls?: string[];
  licensed?: boolean | null;
  insured?: boolean | null;
  business_name?: string | null;
  /** L7: the member's own "Show my profile in search engines" switch (default false = noindex). */
  show_in_search?: boolean;
  /** Every live listing comes back (500 at most); this is their true count. */
  listing_count?: number;
  job_count?: number;
  listings: { id: string; title: string; price_cents: number; area_label: string | null; photo_id: string | null; live_at: string }[];
  jobs: { id: string; title: string; category: string; town: string | null; budget: number; date_needed: string }[];
  helpr: {
    jobs_done: number;
    categories: string[];
    /** Every review under the list's own rules (20261105165059; one person's own accounts left out, L4). The list holds the newest 100. */
    review_total?: number;
    reviews: { rating: number; feedback: string | null; created_at: string; reviewer_name: string; job_category: string | null; response_text: string | null; response_at: string | null }[];
  };
  wanted: { id: string; what: string; category: string; max_price_cents: number; created_at: string }[];
}

/** The page for a handle, or null when there is none to show (unknown, hidden or a test member). Throws on a network fault. */
export async function fetchPublicProfile(handle: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase.rpc("public_profile_by_handle", { p_handle: handle });
  if (error) {
    if (isMissingRpcNamed(error, "public_profile_by_handle")) return null;
    throw new Error(GENERIC);
  }
  return (data as unknown as PublicProfile | null) ?? null;
}

/**
 * H5 (share-profile audit 11-05, one public profile link): a member's current /u handle from their user id, for the
 * old /user/<id> and /book/<id> links. `none` = they have no public page (handle_for_user is NULL under exactly
 * public_profile_by_handle's rules, 20261105171316); `not_deployed` = the read is not live yet, so the caller keeps the
 * old page. Throws on any other fault (the caller shows a retry).
 */
export type HandleForUser = { state: "found"; handle: string } | { state: "none" } | { state: "not_deployed" };
export async function handleForUser(userId: string): Promise<HandleForUser> {
  const { data, error } = await supabase.rpc("handle_for_user", { p_user_id: userId });
  if (error) {
    if (isMissingRpcNamed(error, "handle_for_user")) return { state: "not_deployed" };
    throw new Error(GENERIC);
  }
  return typeof data === "string" && HANDLE_PATTERN.test(data) ? { state: "found", handle: data } : { state: "none" };
}

/** A Declutter item's cover through the shop-photo edge function (kind=declutter): by photo id, never a storage path. */
export function listingPhotoUrl(photoId: string, width = 480): string {
  const base = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${base}/functions/v1/shop-photo?id=${encodeURIComponent(photoId)}&kind=declutter&w=${width}`;
}

/** A handle from the URL, normalised as the server does; null when it can never be one (no request is made). */
export function handleFromPath(raw: string | undefined): string | null {
  const h = (raw ?? "").trim().toLowerCase();
  return HANDLE_PATTERN.test(h) ? h : null;
}
