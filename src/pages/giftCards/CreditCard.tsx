import { Button } from "@/components/ui/button";
import { StatusPill } from "./StatusPill";
import { formatShortDate, formatPrice } from "@/lib/format";
import type { GiftCardRow } from "./types";

// ─── Credit card ──────────────────────────────────────────────────────────────
export function CreditCard({
  credit,
  onRedeem,
  onClaim,
  claiming = false,
  currentUserId,
  perspective = "received",
}: {
  credit: GiftCardRow;
  onRedeem?: (id: string) => void;
  /** Bind an emailed-but-unclaimed gift to this account. */
  onClaim?: (token: string) => void;
  claiming?: boolean;
  /** The signed-in user, so redeemability can check OWNERSHIP like the server does. */
  currentUserId?: string | null;
  /** "received" shows who it's from; "sent" shows who it went to. */
  perspective?: "received" | "sent";
}) {
  // AL-011: split the NAME, never the fallback ("A neighbor" split to "from A").
  const donorFirst = credit.donor?.full_name?.trim().split(" ")[0] || "a neighbor";
  const subline =
    perspective === "sent"
      ? `to ${credit.recipient_email ?? "your recipient"}`
      : `from ${donorFirst}`;

  // Gift cards expire (gift_cards.expires_at defaults to +90 days) and
  // `redeem_gift_card` hard-rejects a lapsed one. The row's `status` is NOT
  // flipped by a background job, so a card can sit at "sent" with a date in
  // the past — surfacing that as "Ready to use" with a live button walks the
  // recipient into a server-side refusal. Derive expiry from the date and let
  // the pill, the date line, and the button all agree.
  const parsedExpiry = credit.expires_at ? new Date(credit.expires_at) : null;
  const expiresAt = parsedExpiry && !isNaN(parsedExpiry.getTime()) ? parsedExpiry : null;
  const isExpired = expiresAt !== null && expiresAt.getTime() < Date.now();
  // Directed gifts are redeemable while in the "sent" (paid, unredeemed) state;
  // the legacy pool used "available". Accept either so the button surfaces
  // correctly during the model transition.
  const spendableStatus = credit.status === "sent" || credit.status === "available";
  // The FUNDING gate. `redeem_gift_card` refuses anything that is not 'paid',
  // and `revoke_gift_card_for_refund` revokes a refunded/charged-back donation
  // by setting payment_status='refunded' while deliberately leaving `status`
  // alone — so a revoked gift still reads 'sent' and, without this, still
  // rendered "Ready to use" with a live button.
  const isFunded = credit.payment_status === "paid";
  // The OWNERSHIP gate. `redeem_gift_card` raises 42501 unless recipient_id IS
  // the caller. A gift that reached this list by the RLS email clause but was
  // never claimed has recipient_id = null and would be refused.
  const isMine = !!currentUserId && credit.recipient_id === currentUserId;
  // Funded, live, addressed to me — but never bound to my account. That is not
  // a dead gift, it is an unclaimed one, and it is one tap from working. Before
  // this, the card offered "Use This Gift", sent the user through the whole
  // post-a-job form, and only at checkout said the gift "may already be used,
  // expired, or sent to a different account" — none of which was true.
  // Scoped to the RECEIVED perspective. On the donor's "Gift cards you've sent"
  // list the same row is unbound too, and without this the pill would tell the
  // SENDER to "Claim it" — a gift they bought for somebody else.
  const needsClaim =
    perspective === "received" &&
    !isExpired && isFunded && spendableStatus && !credit.recipient_id && !!credit.claim_token;
  const effectiveStatus = isExpired
    ? "expired"
    : !isFunded && spendableStatus
      ? "refunded"
      : needsClaim
        ? "unclaimed"
        : credit.status;
  // All four conditions the server checks, in the same order. Anything less
  // offers a button that is going to be refused.
  const redeemable = !isExpired && isFunded && isMine && spendableStatus;
  // Moot once the money is spent — only unredeemed cards can still lapse.
  const showExpiry = expiresAt !== null && credit.status !== "redeemed";
  return (
    <div
      className="rounded-ds-md p-4"
      style={{
        background:
          "radial-gradient(circle at 15% 0%, var(--gift-sheen) 0%, transparent 55%), " +
          "linear-gradient(180deg, hsl(var(--gift-card-from)) 0%, hsl(var(--gift-card-to)) 100%)",
        border: "0.5px solid hsl(var(--gift-tint) / 0.22)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255,255,255,0.5), " +
          "0 1px 3px hsl(var(--gift-tint) / 0.08)",
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p
            className="font-display italic font-bold leading-tight text-ds-22"
            style={{ color: "hsl(var(--gift-ink))", letterSpacing: "-0.02em" }}
          >
            ${formatPrice(Number(credit.amount))}
          </p>
          <p
            className="font-sans mt-0.5 text-ds-12"
            style={{ color: "hsl(var(--gift-green-soft))" }}
          >
            {subline}
          </p>
        </div>
        <StatusPill status={effectiveStatus} />
      </div>

      {showExpiry && (
        <p
          className="font-sans text-ds-11 font-semibold uppercase mb-2"
          style={{
            color: isExpired
              ? "hsl(var(--burnt-sienna))"
              : "hsl(var(--gift-green-soft))",
            letterSpacing: "0.06em",
          }}
        >
          {isExpired ? "Expired" : "Expires"} {formatShortDate(expiresAt)}
        </p>
      )}

      {credit.message && (
        <p
          className="font-sans text-ds-13 leading-relaxed mb-3"
          style={{ color: "hsl(var(--ink-deep) / 0.75)" }}
        >
          "{credit.message}"
        </p>
      )}

      {onRedeem && redeemable && (
        <Button
          size="sm"
          onClick={() => onRedeem(credit.id)}
          className="w-full rounded-ds-sm font-sans font-semibold text-ds-13"
          style={{
            background: "hsl(var(--success-ink))",
            color: "hsl(var(--parchment))",
            border: "none",
          }}
        >
          Use This Gift
        </Button>
      )}

      {onClaim && needsClaim && credit.claim_token && (
        <Button
          size="sm"
          disabled={claiming}
          onClick={() => onClaim(credit.claim_token as string)}
          className="w-full rounded-ds-sm font-sans font-semibold text-ds-13"
          style={{
            background: "hsl(var(--success-ink))",
            color: "hsl(var(--parchment))",
            border: "none",
          }}
        >
          {claiming ? "Claiming…" : "Claim This Gift"}
        </Button>
      )}
    </div>
  );
}
