/**
 * The reports queue's half for a reported shop or shop item (Shops H2, 20261105182210). `reported_id` is a shops or
 * shop_items id, never a person: the name or title, owner, status and test flag are read through
 * shops_admin_reported (members and admins can't read the shop tables directly).
 */
import type { ReportedShop } from "@/lib/shops/reports";
import { report } from "@/lib/errorLogger";

// Q1947 (20261105225245): shop_talk_message, a message in a shop chat.
const SHOP_REPORTS: readonly string[] = ["shop", "shop_item", "shop_talk_message"];
/** A report about a shop, one of its items, or a message in a shop chat. */
export const isShopReport = (t: string) => SHOP_REPORTS.includes(t);

/** Shops and items by id. A failed read is reported and yields an empty map (each row then reads "… unavailable"). */
export async function hydrateReportedShops(rows: { reported_type: string; reported_id: string }[]): Promise<{
  shops: Map<string, ReportedShop>;
  failed: boolean;
}> {
  const ids = [...new Set(rows.filter((r) => isShopReport(r.reported_type)).map((r) => r.reported_id))];
  const shops = new Map<string, ReportedShop>();
  if (ids.length === 0) return { shops, failed: false };
  try {
    const { fetchReportedShops } = await import("@/lib/shops/reports");
    for (const s of await fetchReportedShops(ids)) shops.set(s.reported_id, s);
    return { shops, failed: false };
  } catch (err) {
    // Never blank the queue over a name read: reported, and the rows say the name is unavailable.
    report(err, { severity: "warning", tags: { source: "AdminReports.hydrateShops" } });
    return { shops, failed: true };
  }
}

/** What the card calls it. */
export function shopSubject(type: string, s: ReportedShop | undefined, failed: boolean): string {
  if (type === "shop_talk_message") {
    // The chat's shop, and which side wrote the message (the writer is the report's person).
    if (s) return `Message from ${s.status === "shop" ? "the shop" : "a shopper"} in "${s.label}"`;
    return failed ? "Shop message unavailable" : "Deleted shop message";
  }
  const noun = type === "shop_item" ? "Shop item" : "Shop";
  if (s) return `${noun} "${s.label}"`;
  return failed ? `${noun} unavailable` : `Deleted ${noun.toLowerCase()}`;
}

/** Still up, so the card offers the take-down: a shop not hidden, an item live or waiting. */
export function shopCanComeDown(s: ReportedShop | undefined): boolean {
  // A chat message has nothing to take down: the admin acts on the person who wrote it (the queue's person actions).
  if (!s || s.kind === "shop_talk_message") return false;
  return s.kind === "shop" ? !s.shop_hidden : ["live", "pending_review"].includes(s.status);
}
