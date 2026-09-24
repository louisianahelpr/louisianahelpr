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
const MAP: Record<string, { label: string; color: string; bg: string }> = {
  available: { label: "Available", color: "hsl(var(--success-ink))", bg: "hsl(var(--gift-tint) / 0.12)" },
  sent: { label: "Ready to use", color: "hsl(var(--success-ink))", bg: "hsl(var(--gift-tint) / 0.12)" },
  redeemed: { label: "Redeemed", color: "hsl(var(--bark))", bg: "hsl(var(--bark) / 0.10)" },
  // `--amber-ink` ("label & body text"), NOT `--amber-tint` ("base hue, used at
  // low alpha for fills/borders", index.css:811). Using the fill hue as ink put
  // this pill at 2.32:1 on the gift-card gradient in light mode — the only one of
  // the five that failed AA, and structurally invisible to
  // lowAlphaForegroundContrast.test.ts, which only matches `hsl(var(--x) / a)`
  // foregrounds. Every sibling pill already pairs a `-ink` token this way.
  reserved: { label: "Reserved", color: "hsl(var(--amber-ink))", bg: "hsl(var(--amber-tint) / 0.12)" },
  expired: { label: "Expired", color: "hsl(var(--olivewood) / 0.8)", bg: "hsl(var(--olivewood) / 0.08)" },
  refunded: { label: "Refunded", color: "hsl(var(--olivewood) / 0.8)", bg: "hsl(var(--olivewood) / 0.08)" },
  // Not a DB value — CreditCard derives it for a gift that arrived by email and
  // has never been bound to an account. It is real money, so it must not read
  // as dead; it reads as "one tap away".
  unclaimed: { label: "Claim it", color: "hsl(var(--amber-ink))", bg: "hsl(var(--amber-tint) / 0.12)" },
};

// An unrecognised status used to fall back to `available` — the most permissive
// label in the set — so any value added to the column later would silently
// render as spendable on a stored-value instrument. Unknown now reads as
// unavailable, which is the only safe direction for money.
const UNKNOWN = {
  label: "Unavailable",
  color: "hsl(var(--olivewood) / 0.8)",
  bg: "hsl(var(--olivewood) / 0.08)",
};

export function StatusPill({ status }: { status: string }) {
  const s = MAP[status] ?? UNKNOWN;
  return (
    <span
      className="text-ds-10 font-sans font-semibold uppercase px-1.5 py-0.5 rounded-ds-sm"
      style={{ color: s.color, background: s.bg, letterSpacing: "0.06em" }}
    >
      {s.label}
    </span>
  );
}
