import { Button } from "@/components/ui/button";
import { StatusPill } from "./StatusPill";
import { formatCategory } from "@/lib/format";
import type { PifCredit } from "./types";

// ─── Credit card ──────────────────────────────────────────────────────────────
export function CreditCard({
  credit,
  onRedeem,
  redeeming,
  perspective = "received",
}: {
  credit: PifCredit;
  onRedeem?: (id: string) => void;
  redeeming?: boolean;
  /** "received" shows who it's from; "sent" shows who it went to. */
  perspective?: "received" | "sent";
}) {
  const donorFirst = (credit.donor?.full_name ?? "A neighbor").split(" ")[0];
  const subline =
    perspective === "sent"
      ? `to ${credit.recipient_email ?? "your recipient"}`
      : `from ${donorFirst}`;
  // Directed gifts are redeemable while in the "sent" (paid, unredeemed) state;
  // the legacy pool used "available". Accept either so the button surfaces
  // correctly during the model transition.
  const redeemable = credit.status === "sent" || credit.status === "available";
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
            ${Number(credit.amount).toFixed(0)}
          </p>
          <p
            className="font-serif italic mt-0.5"
            style={{ fontSize: "0.75rem", color: "hsl(var(--pif-green-soft))" }}
          >
            {subline}
          </p>
        </div>
        <StatusPill status={credit.status} />
      </div>

      {credit.category && credit.category !== "Any" && (
        <p
          className="font-sans text-ds-11 font-semibold uppercase mb-2"
          style={{ color: "hsl(var(--pif-green-soft))", letterSpacing: "0.06em" }}
        >
          For: {formatCategory(credit.category).toUpperCase()}
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
          disabled={redeeming}
          onClick={() => onRedeem(credit.id)}
          className="w-full rounded-ds-sm font-display italic font-semibold text-ds-13"
          style={{
            background: "hsl(var(--pif-green))",
            color: "#fff",
            border: "none",
          }}
        >
          {redeeming ? "Opening…" : "Use this gift"}
        </Button>
      )}
    </div>
  );
}
