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
import { rpcData } from "@/lib/declutter/api";

/** The distances a wanted post can reach (W5; the Browse choices without "any"). */
export const WANTED_RADIUS_CHOICES = [5, 10, 25, 50] as const;
export type WantedRadius = (typeof WANTED_RADIUS_CHOICES)[number];

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
  /** Q2267: "Let sellers near me reply" (owner 10-21: on by default in the form; the server's default is off). */
  public: boolean;
  radius: WantedRadius;
}

/** Whole dollars or dollars and cents ("80", "79.50") to cents, else null. */
export function dollarsToCents(v: string): number | null {
  const t = v.trim().replace(/^\$/, "");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

/**
 * The same rules the server applies (declutter_create_wanted, W8), checked
 * first so the member gets the words before a round trip. Returns the problem
 * in plain words, or null when the form can be sent.
 */
export function wantedFormProblem(f: WantedForm): string | null {
  const what = f.what.trim().replace(/\s+/g, " ");
  if (what.length < 3 || what.length > 60) return "Say what you want in 3 to 60 letters, like \"crib\" or \"oak dresser\".";
  if (!/^[A-Za-z0-9 .,'&()/-]+$/.test(what)) return "Use letters and numbers only. No links, phone numbers or emails.";
  if (/[A-Za-z]\.[A-Za-z]/.test(what)) return "Leave out web addresses.";
  if (what.replace(/[^0-9]/g, "").length >= 7 || /(\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b[^a-z0-9]*){4,}/i.test(what)) {
    return "Leave out phone numbers.";
  }
  if (!f.category) return "Pick a category.";
  const cents = dollarsToCents(f.maxPrice);
  if (cents === null || cents < 100 || cents > 100_000 || cents % 100 !== 0) return "Set your highest price in whole dollars, $1 to $1,000.";
  if (!WANTED_RADIUS_CHOICES.includes(f.radius)) return "Pick how far you'd go.";
  return null;
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
 * Post a Wanted. `repliesOn` is false when the post went up private: the member chose so, or (before migration
 * 20261021031757 reaches prod) the server had no p_public yet, so the post is sent without it and stays private.
 */
export async function createWanted(f: WantedForm, at: { lat: number; lng: number }): Promise<{ id: string; repliesOn: boolean }> {
  const cents = dollarsToCents(f.maxPrice);
  const base = { p_what: f.what.trim(), p_category: f.category, p_max_price_cents: cents ?? 0, p_radius_miles: f.radius, p_lat: at.lat, p_lng: at.lng };
  const send = (args: typeof base & { p_public?: boolean }) => supabase.rpc("declutter_create_wanted", args);
  let res = await send(f.public ? { ...base, p_public: true } : base);
  let repliesOn = f.public;
  if (f.public && res.error && isMissingRpcNamed(res.error, "declutter_create_wanted")) {
    console.warn("[declutter] Wanted replies not deployed yet; posting privately");
    repliesOn = false;
    res = await send(base);
  }
  return { id: rpcData(res, (e) => rpcErrorMessage("declutter_create_wanted", e)) as string, repliesOn };
}

/** Q2267: turn "Let sellers near me reply" on or off for one of your open posts. */
export async function setWantedPublic(id: string, on: boolean): Promise<boolean> {
  return rpcData(await supabase.rpc("declutter_set_wanted_public", { p_wanted_id: id, p_public: on }), (e) => rpcErrorMessage("declutter_set_wanted_public", e)) as boolean;
}

/** Q2267: public Wanted posts near a point; [] before the migration is on prod. */
export async function fetchWantedNear(at: { lat: number; lng: number }): Promise<WantedNear[]> {
  const res = await supabase.rpc("declutter_wanted_browse", { p_lat: at.lat, p_lng: at.lng });
  if (res.error && isMissingRpcNamed(res.error, "declutter_wanted_browse")) return [];
  return (rpcData(res, (e) => rpcErrorMessage("declutter_wanted_browse", e)) ?? []) as WantedNear[];
}

/** Q2267: your listings that can answer a Wanted post: for sale now and taking offers (the server checks the same). */
export async function fetchMyReplyListings(userId: string): Promise<{ id: string; title: string; current_price_cents: number }[]> {
  const rows = unwrap(
    await supabase
      .from("declutter_items")
      .select("id, title, current_price_cents")
      .eq("seller_id", userId)
      .eq("status", "live")
      .eq("sale_mode", "offers")
      .order("created_at", { ascending: false }),
  );
  return (rows ?? []) as { id: string; title: string; current_price_cents: number }[];
}

/** Q2267 "I have this": an offer from one of your live listings, awaiting the poster. Returns the offer id. */
export async function replyToWanted(wantedId: string, itemId: string, cents: number): Promise<string> {
  return rpcData(
    await supabase.rpc("declutter_wanted_reply", { p_wanted_id: wantedId, p_item_id: itemId, p_amount_cents: cents }),
    (e) => rpcErrorMessage("declutter_wanted_reply", e),
  ) as string;
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
  }));
}
