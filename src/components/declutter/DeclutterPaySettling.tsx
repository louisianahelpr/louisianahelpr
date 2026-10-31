/**
 * B-1 (deep audit 2026-10-28, CRITICAL): after paying, the checkout returns to
 * /declutter?view=cart&paid=1, and the cart showed the UNPAID cart with a live
 * "Pay $34.30" for 10+ seconds (all 3 payments; the order was already paid in the
 * database). The cart read came from the saved cache (60 s fresh, kept on disk), and
 * the order only turns paid when Stripe's webhook lands, so a buyer could pay twice.
 *
 * On the return, then:
 *   - the page says "Payment received" at once (the checkout takes cards only, so
 *     Stripe sends the buyer to the success address only after the card was charged);
 *   - every Declutter read is asked again, never trusted from the cache, and the cart
 *     is read every 2 seconds until the checkout just paid has left it;
 *   - Pay for that checkout is off meanwhile. Which checkout it was is remembered at the
 *     Pay tap (this tab's session storage). If that is unknown, every Pay waits, for at
 *     most a minute.
 */
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchMyCart, type CartLine } from "@/lib/declutter/api";

const KEY = "declutter:paying-seller";
/** How often the cart is read while the payment settles. */
const SETTLE_POLL_MS = 2_000;
/** After this, an unknown checkout stops holding every Pay, and the notice says it is slow. */
const SETTLE_SLOW_MS = 60_000;

/** Called on the Pay tap, just before the payment page opens. */
export function rememberPaying(sellerId: string) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ sellerId, at: Date.now() }));
  } catch {
    // Storage blocked (a private window): the return then holds every Pay until the cart settles.
  }
}

function payingSeller(): string | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as { sellerId?: unknown; at?: unknown } | null;
    // A payment page lives 31 minutes; an older note is about some other visit.
    if (v && typeof v.sellerId === "string" && typeof v.at === "number" && Date.now() - v.at < 2 * 3_600_000) return v.sellerId;
  } catch {
    // Unreadable or blocked storage: treated as "which checkout is unknown".
  }
  return null;
}

function forgetPaying() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Blocked storage: nothing was stored either.
  }
}

/** True once a read made AFTER the return shows no unpaid line left for the checkout just paid. */
function settledBy(lines: CartLine[] | undefined, updatedAt: number, returnedAt: number, sellerId: string | null): boolean {
  if (!lines || updatedAt < returnedAt) return false;
  const now = Date.now();
  return !lines.some((l) => l.my_side === "buyer" && l.status === "in_cart" && new Date(l.checkout_by).getTime() > now
    && (sellerId === null || l.seller_id === sellerId));
}

export type PaySettling = {
  /** Pay is held for this seller's checkout (or every checkout, when `sellerId` is null). */
  settling: boolean;
  sellerId: string | null;
  /** Past SETTLE_SLOW_MS without the cart catching up. */
  slow: boolean;
  check: () => void;
};

export function usePaySettling(): PaySettling {
  const location = useLocation();
  const paid = new URLSearchParams(location.search).get("paid") === "1";
  // Latched: closing the "What next" sheet drops ?paid=1, but the cart must still catch up.
  const [returnedAt, setReturnedAt] = useState<number | null>(() => (paid ? Date.now() : null));
  const [sellerId, setSellerId] = useState<string | null>(() => (paid ? payingSeller() : null));
  useEffect(() => {
    if (paid && returnedAt === null) {
      setReturnedAt(Date.now());
      setSellerId(payingSeller());
    }
  }, [paid, returnedAt]);
  const qc = useQueryClient();
  useEffect(() => {
    // Never the saved cache: the cart, the orders and their handovers are all read again.
    if (returnedAt !== null) void qc.invalidateQueries({ queryKey: ["declutter"] });
  }, [qc, returnedAt]);
  const cart = useQuery({
    queryKey: ["declutter", "my-cart"],
    queryFn: fetchMyCart,
    enabled: returnedAt !== null,
    refetchInterval: (q) =>
      returnedAt !== null && !settledBy(q.state.data, q.state.dataUpdatedAt, returnedAt, sellerId) ? SETTLE_POLL_MS : false,
  });
  const settled = returnedAt === null || settledBy(cart.data, cart.dataUpdatedAt, returnedAt, sellerId);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (returnedAt === null || settled) return;
    const t = setTimeout(() => setSlow(true), Math.max(0, returnedAt + SETTLE_SLOW_MS - Date.now()));
    return () => clearTimeout(t);
  }, [returnedAt, settled]);
  useEffect(() => {
    if (returnedAt !== null && settled) forgetPaying();
  }, [returnedAt, settled]);
  return {
    // An unknown checkout never holds every Pay past the slow mark; a known one waits until the cart shows it paid.
    settling: !settled && !(slow && sellerId === null),
    sellerId,
    slow,
    check: () => void cart.refetch(),
  };
}

/** What the buyer sees on the return while the payment settles. */
export function PaySettlingNotice({ s }: { s: PaySettling }) {
  if (!s.settling) return null;
  return (
    <div role="status" data-pay-settling={s.slow ? "slow" : ""} className="rounded-2xl border border-border bg-card p-4 text-sm">
      <p className="font-semibold">Payment received.</p>
      <p className="mt-1 text-muted-foreground">
        {s.slow
          ? "Confirming it is taking longer than usual. Don't pay again: the order moves to Buying once it's confirmed."
          : "We're confirming your order. This takes a few seconds."}
      </p>
      {/* Not an error screen (nothing failed; the card was charged): a plain notice with a way to look again. */}
      {s.slow && (
        <button type="button" onClick={s.check} className="mt-3 inline-flex h-11 items-center rounded-full border border-border px-4 text-sm font-semibold">
          Check again
        </button>
      )}
    </div>
  );
}
