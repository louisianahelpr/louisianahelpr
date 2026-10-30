/**
 * Audit DB-5 (owner 2026-10-30): "Buy now goes straight to checkout, with no strike for backing out before paying."
 * Pure helpers, kept out of api.ts so the screens' tests (which stub api.ts whole) run the real rule.
 */
import type { CartLine } from "./api";

/**
 * True only when the server says every line is Buy now or free (declutter_my_cart's source, 20261030064929), so
 * letting the 48 hours run out is no strike. An accepted offer ("offer") still carries one, and before that deploy
 * source is absent: read as "may carry a strike", which is what the server still did then.
 */
export function holdHasNoStrike(lines: readonly Pick<CartLine, "source" | "price_cents">[]): boolean {
  return lines.length > 0 && lines.every((l) => l.price_cents === 0 || l.source === "buy");
}

/** Buy now opens this seller's checkout in Buying (CartView scrolls to it). */
export function checkoutLinkFor(sellerId: string | null): string {
  return sellerId ? `/declutter?tab=buying&checkout=${encodeURIComponent(sellerId)}` : "/declutter?tab=buying";
}
