// ─── Status pill ──────────────────────────────────────────────────────────────
//
// The five values of `gift_cards.status`, plus a sixth derived one.
//
// `refunded` is NOT a status value — the column's CHECK allows only
// available/reserved/sent/redeemed/expired. It is derived by CreditCard from
// `payment_status`, because `revoke_gift_card_for_refund` deliberately revokes a
// charged-back gift by setting `payment_status='refunded'` and leaving `status`
// alone (inventing a status the CHECK rejects would fail the write, and the
// unknown-key fallback below used to render anything unrecognised as the most
// permissive label in the set).
// Spec v2 (rebuild 2026-10-21): a gift card is money, so its live states
// (spendable, reserved, waiting to be claimed) wear the money tint — rust ink
// on the rust wash, the one "held money" look. Spent or dead states are
// muted. No green, no amber: neither is in the palette.
const MONEY = { color: "hsl(var(--accent-ink))", bg: "hsl(var(--accent-ink) / 0.10)" };
const MUTED = { color: "hsl(var(--muted-foreground))", bg: "hsl(var(--muted))" };
const MAP: Record<string, { label: string; color: string; bg: string }> = {
  available: { label: "Available", ...MONEY },
  sent: { label: "Ready to use", ...MONEY },
  redeemed: { label: "Used", ...MUTED },
  reserved: { label: "Reserved", ...MONEY },
  expired: { label: "Expired", ...MUTED },
  refunded: { label: "Refunded", ...MUTED },
  // Not a DB value — CreditCard derives it for a gift that arrived by email and
  // has never been bound to an account. It is real money, so it must not read
  // as dead; it reads as "one tap away".
  unclaimed: { label: "Claim it", ...MONEY },
};

// An unrecognised status used to fall back to `available` — the most permissive
// label in the set — so any value added to the column later would silently
// render as spendable on a stored-value instrument. Unknown now reads as
// unavailable, which is the only safe direction for money.
const UNKNOWN = { label: "Unavailable", ...MUTED };

export function StatusPill({ status }: { status: string }) {
  const s = MAP[status] ?? UNKNOWN;
  return (
    <span
      className="shrink-0 text-ds-11 font-sans font-semibold px-2 py-0.5 rounded-full"
      style={{ color: s.color, background: s.bg }}
    >
      {s.label}
    </span>
  );
}
