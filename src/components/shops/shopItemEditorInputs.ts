/**
 * ShopItemEditor's input readers (split out of ShopItemEditor.tsx for componentSizeRatchet, train 1112-i): the price in
 * cents, a whole-number box, the dollars label, and which field a server refusal is about (S041).
 */
export const cents = (s: string) => Math.round(Number(s.replace(/[$,\s]/g, "")) * 100);
/**
 * A whole number typed in a box, or the server's refusal code when the box is
 * empty or not a number (lh-silent-failure review should-fix 2: an empty box
 * must never quietly become 0, which publishes as "same day" or "sold out").
 */
export function wholeNumber(s: string, code: string): number {
  const t = s.trim();
  if (!/^\d+$/.test(t)) throw new Error(code);
  return Number(t);
}
export const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** The field a refusal is about, by its code as a whole word in the message (S041: lead time and stock too). */
export type ItemField = "title" | "price" | "lead" | "stock";
const FIELD_OF_CODE: Record<string, ItemField> = {
  invalid_title: "title", invalid_price: "price", invalid_lead_time: "lead", invalid_stock: "stock",
};
export function itemFieldOfError(err: unknown): ItemField | null {
  const msg = String((err as { message?: unknown } | null)?.message ?? "");
  for (const [code, field] of Object.entries(FIELD_OF_CODE)) {
    if (new RegExp(`(^|[^a-z_])${code}($|[^a-z_])`).test(msg)) return field;
  }
  return null;
}
