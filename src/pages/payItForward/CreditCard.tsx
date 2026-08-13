import { Button } from "@/components/ui/button";
import { StatusPill } from "./StatusPill";
import { formatShortDate, formatPrice } from "@/lib/format";
import type { PifCredit } from "./types";

// ─── Credit card ──────────────────────────────────────────────────────────────
export function CreditCard({
  credit,
  onRedeem,
  perspective = "received",
}: {
  credit: PifCredit;
  onRedeem?: (id: string) => void;
  /** "received" shows who it's from; "sent" shows who it went to. */
  perspective?: "received" | "sent";
}) {
  const donorFirst = (credit.donor?.full_name ?? "A neighbor").split(" ")[0];
  const subline =
    perspective === "sent"
      ? `to ${credit.recipient_email ?? "your recipient"}`
      : `from ${donorFirst}`;

  // Gift cards expire (pif_credits.expires_at defaults to +90 days) and
  // `redeem_pif_credit` hard-rejects a lapsed one. The row's `status` is NOT
  // flipped by a background job, so a card can sit at "sent" with a date in
  // the past — surfacing that as "Ready to use" with a live button walks the
  // recipient into a server-side refusal. Derive expiry from the date and let
  // the pill, the date line, and the button all agree.
  const parsedExpiry = credit.expires_at ? new Date(credit.expires_at) : null;
  const expiresAt = parsedExpiry && !isNaN(parsedExpiry.getTime()) ? parsedExpiry : null;
  const isExpired = expiresAt !== null && expiresAt.getTime() < Date.now();
  const effectiveStatus = isExpired ? "expired" : credit.status;
  // Directed gifts are redeemable while in the "sent" (paid, unredeemed) state;
  // the legacy pool used "available". Accept either so the button surfaces
  // correctly during the model transition.
  const redeemable =
    !isExpired && (credit.status === "sent" || credit.status === "available");
  // Moot once the money is spent — only unredeemed cards can still lapse.
  const showExpiry = expiresAt !== null && credit.status !== "redeemed";
  return (
    <div
      className="rounded-ds-md p-4"
      style={{
        background:
          "radial-gradient(circle at 15% 0%, var(--pif-sheen) 0%, transparent 55%), " +
          "linear-gradient(180deg, hsl(var(--pif-card-from)) 0%, hsl(var(--pif-card-to)) 100%)",
        border: "0.5px solid hsl(var(--pif-tint) / 0.22)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255,255,255,0.5), " +
          "0 1px 3px hsl(var(--pif-tint) / 0.08)",
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p
            className="font-display italic font-bold leading-tight"
            style={{ fontSize: "1.35rem", color: "hsl(var(--pif-ink))", letterSpacing: "-0.02em" }}
          >
            ${formatPrice(Number(credit.amount))}
          </p>
          <p
            className="font-serif italic mt-0.5"
            style={{ fontSize: "0.75rem", color: "hsl(var(--pif-green-soft))" }}
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
              : "hsl(var(--pif-green-soft))",
            letterSpacing: "0.06em",
          }}
        >
          {isExpired ? "Expired" : "Expires"} {formatShortDate(expiresAt)}
        </p>
      )}

      {credit.message && (
        <p
          className="font-serif italic text-ds-13 leading-relaxed mb-3"
          style={{ color: "hsl(var(--ink-deep) / 0.75)" }}
        >
          "{credit.message}"
        </p>
      )}

      {onRedeem && redeemable && (
        <Button
          size="sm"
          onClick={() => onRedeem(credit.id)}
          className="w-full rounded-ds-sm font-display italic font-semibold text-ds-13"
          style={{
            background: "hsl(var(--success-ink))",
            color: "hsl(var(--parchment))",
            border: "none",
          }}
        >
          Use this gift
        </Button>
      )}
    </div>
  );
}
