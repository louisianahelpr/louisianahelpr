/**
 * THE NAV BADGE'S ONE READ (Blockers 7, 2026-11-03, lead PASS; "Nothing slow for users"). The To-do badge
 * (NeedsYouBridge, on every signed-in page after the page's own reads) used to make six reads on every page load:
 * declutter_my_cart, declutter_my_offers, declutter_my_refund_todos, declutter_free_requests, backout_notices and
 * shop_orders. public.my_badge_reads(p_keys) (migration 20261103111254) returns all six in one request, and this
 * seeds each section into the SAME React Query key its screens already read, so every screen and badge stays as it was.
 *
 * - p_keys: only the sections whose feature switch is on for the member (never an id).
 * - A section the server could not read comes back null: it is NOT seeded, and the caller makes that section's old
 *   single call (the badge never goes blank because one section broke).
 * - The RPC not deployed yet (PGRST202): returns null, and the caller makes all six old calls.
 * Proof: src/test/pglite/myBadgeReads.pglite.mjs. Guard: src/test/badgeReadsOneRequest.test.ts.
 */
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isMissingRpcNamed } from "@/lib/missingRpc";
import { backoutNoticesKey } from "@/lib/backoutNotices";
import { groupFreeAsks } from "@/lib/declutter/freeAsks";

export type BadgeSection = "cart" | "offers" | "refund_todos" | "free_asks" | "backout" | "shop_orders";

/** The React Query key each section is seeded into: the key its screens and the old single call use. */
export function badgeSectionKey(section: BadgeSection, uid: string): readonly unknown[] {
  switch (section) {
    case "cart":
      return ["declutter", "my-cart"];
    case "offers":
      return ["declutter", "my-offers"];
    case "refund_todos":
      return ["declutter", "my-refund-todos"];
    case "free_asks":
      return ["declutter", "free-asks-to-pick", uid];
    case "backout":
      return backoutNoticesKey(uid);
    case "shop_orders":
      return ["shops", "shop-orders", uid];
  }
}

/** Which sections the server answered (true) or could not read (false). null = the RPC is not deployed yet. */
export type BadgeAnswered = Partial<Record<BadgeSection, boolean>>;

/**
 * One request for the asked sections; seeds every answered one into its key. Returns which sections answered, or
 * null when the RPC is not deployed (the caller then falls back to every old call). Any other error throws, so
 * React Query retries it like the old reads, and the sections fall back meanwhile.
 */
export async function fetchBadgeReads(qc: QueryClient, uid: string, sections: BadgeSection[]): Promise<BadgeAnswered | null> {
  if (sections.length === 0) return {};
  const res = await supabase.rpc("my_badge_reads", { p_keys: sections });
  if (res.error) {
    if (isMissingRpcNamed(res.error, "my_badge_reads")) return null;
    throw res.error;
  }
  const data = (res.data ?? {}) as Partial<Record<BadgeSection, unknown[] | null>>;
  const answered: BadgeAnswered = {};
  for (const s of sections) {
    const rows = data[s];
    if (!Array.isArray(rows)) {
      answered[s] = false;
      continue;
    }
    const value = s === "free_asks" ? groupFreeAsks(rows as Parameters<typeof groupFreeAsks>[0]) : rows;
    qc.setQueryData(badgeSectionKey(s, uid), value);
    answered[s] = true;
  }
  return answered;
}
