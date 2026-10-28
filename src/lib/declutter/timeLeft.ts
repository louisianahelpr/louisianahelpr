/**
 * "19 hours left" / "5 minutes left" / "time is up": a Declutter deadline (a cart line's checkout_by, an offer's
 * respond_by) in the words the cart and the seller's waiting sales show. Moved out of DeclutterTradeViews.tsx
 * unchanged (componentSizeRatchet: that file is held at 600 lines).
 */
export function timeLeft(iso: string, now = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "time is up";
  const h = Math.floor(ms / 3_600_000);
  if (h >= 1) return `${h} hour${h === 1 ? "" : "s"} left`;
  const m = Math.max(1, Math.floor(ms / 60_000));
  return `${m} minute${m === 1 ? "" : "s"} left`;
}
