import { Crown } from "lucide-react";

/**
 * The note shown on return from a membership checkout (?pro=success|cancel).
 * Moved verbatim out of UserProfile (component-size ratchet).
 */
export function ProReturnBanner({ result }: { result: "success" | "cancel" | null }) {
  if (!result) return null;
  return (
    <div
      className="flex items-start gap-3 px-4 py-3 rounded-2xl"
      style={{ background: "hsl(var(--bark) / 0.06)", border: "1px solid hsl(var(--bark) / 0.16)" }}
      role="status"
    >
      <Crown className="w-5 h-5 shrink-0 mt-0.5" strokeWidth={1.75} style={{ color: "hsl(var(--bark))" }} />
      <p className="text-ds-13 leading-snug" style={{ color: "hsl(var(--ink-deep))" }}>
        {result === "success"
          ? "Membership upgrade confirmed — your new perks are live."
          : "Checkout canceled — no charge was made."}
      </p>
    </div>
  );
}
