/**
 * Declutter wanted posts
 * (docs/specs/declutter-wanted-price-hint.md, W1-W14). Every call is a
 * declutter_* RPC that refuses server-side without its hidden switch, so this
 * file is never the protection. Refusals carry plain words on `userMessage`
 * (RPC_ERROR_COPY via rpcErrorMessage); screens show declutterErrorMessage().
 */
import { supabase } from "@/integrations/supabase/client";
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

export async function createWanted(f: WantedForm, at: { lat: number; lng: number }): Promise<string> {
  const cents = dollarsToCents(f.maxPrice);
  return rpcData(
    await supabase.rpc("declutter_create_wanted", {
      p_what: f.what.trim(),
      p_category: f.category,
      p_max_price_cents: cents ?? 0,
      p_radius_miles: f.radius,
      p_lat: at.lat,
      p_lng: at.lng,
    }),
    (e) => rpcErrorMessage("declutter_create_wanted", e),
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
