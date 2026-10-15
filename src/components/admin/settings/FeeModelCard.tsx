import { Percent } from "lucide-react";
import { TIER_ORDER, TIER_PERKS, type SubscriptionTier } from "@/lib/subscriptionTiers";
import { AdminCard } from "../AdminViewShell";
import { HELPR_FLAT_FEE_CENTS, HELPR_FLAT_FEE_PERCENT } from "@/lib/helprFlatFee";

// The fee-ladder rungs an admin is shown, DERIVED from the tier config rather
// than restated. `TIER_PERKS` is the same table `tierFeePercent()` resolves a
// live payout against and the same one /subscription advertises, so the console
// can no longer quote a ladder the platform does not charge — which is exactly
// what the deleted editable inputs did (see the read-only card below).
// The rung ORDER comes from TIER_ORDER (the commission ladder) too, so a tier
// added there appears here without an edit.
const FEE_LADDER: { id: SubscriptionTier; name: string; percent: number }[] = TIER_ORDER.map((id) => ({
  id,
  name: TIER_PERKS[id].name,
  percent: TIER_PERKS[id].platformFeePercent,
}));

/** Admin -> Settings: the read-only Fee Model card (moved verbatim out of AdminSettings.tsx). */
export function FeeModelCard({ customerFee, helperFee }: { customerFee: string; helperFee: string }) {
  /*
   * ── Fee model — READ ONLY ──
   * This was two number inputs and a "Total platform take: 20%" calculator
   * with a Save button, and every part of it was wrong. The platform has
   * not charged one flat rate since the tier ladder shipped: a Helpr pays
   * their own tier's commission, resolved per job by `tierFeePercent()` from
   * the same TIER_PERKS table read below, and (owner, 2026-10-11) a poster
   * pays no platform percentage at all, only a service fee equal to Stripe's
   * card cost (`posterCardCostFeeCents`). So the console let an admin type a number
   * that would never be charged, then added two unrelated percentages
   * together and called the sum the platform's take — arithmetic that has
   * never described a single real job. Owner: "the 10% payout fee … also
   * not correct."
   *
   * The platform_settings COLUMNS stay exactly where they are. The payout
   * edge functions read customer_fee_percent / helper_fee_percent as a
   * fail-safe when a tier cannot be resolved, and release-payout 500s
   * without them — so the row is load-bearing infrastructure even though
   * it is not a control. It is shown here as what it is: a fallback, with
   * its live values, and no way to edit it by accident.
   */
  return (
    <AdminCard
      title={<span className="flex items-center gap-2"><Percent className="w-4 h-4 text-primary" /> Fee Model</span>}
      subtitle={`Jobs funded from Oct 15, 2026: ${HELPR_FLAT_FEE_PERCENT}% + $${(HELPR_FLAT_FEE_CENTS / 100).toFixed(2)} from each Helpr payout. Older jobs keep the tier commission below.`}
      contentClassName="space-y-4"
    >
      {/* The ladder speaks for itself — the paragraph that used to sit above
          it ("each job resolves its own rates from the tier ladder…") said
          what the card's own subtitle already says. */}
      <ul className="rounded-ds-sm bg-primary/5 p-3 space-y-1">
        {FEE_LADDER.map((t) => (
          <li key={t.id} className="flex items-center justify-between text-ds-11">
            <span className="text-muted-foreground">{t.name}</span>
            <span className="font-semibold text-foreground tabular-nums">{t.percent}%</span>
          </li>
        ))}
      </ul>

      {/* Absorbed from the separate "How the split fee model works" card that
          used to sit at the bottom of this screen. Two cards explaining one
          fee model, a page apart, is the duplication itself — not just the
          prose inside them. */}
      <ul className="text-ds-11 text-muted-foreground space-y-1.5 list-disc list-inside">
        {/* Roadmap F3 (owner 2026-10-14/15). The ladder above prices only jobs
            funded before the change (each job carries its own stamp). */}
        <li>Poster pays: the job price (urgent bonus included) + sales tax on taxable categories; no service fee and no card-cost line</li>
        <li>Helpr receives: job price − {HELPR_FLAT_FEE_PERCENT}% − ${(HELPR_FLAT_FEE_CENTS / 100).toFixed(2)}, rounded down to the whole dollar</li>
        <li>Platform keeps {HELPR_FLAT_FEE_PERCENT}% + ${(HELPR_FLAT_FEE_CENTS / 100).toFixed(2)} per Helpr payout; Stripe's card cost comes out of it</li>
        <li>Jobs funded before Oct 15, 2026 keep their old fees: the tier commission above and the poster's card-cost fee</li>
      </ul>

      <div className="space-y-1.5 border-t border-border/60 pt-3">
        <p className="text-ds-11 font-semibold text-foreground">Fallback rates</p>
        <p className="text-ds-11 text-muted-foreground">
          The Helpr rate is used only when a tier can't be read at payout time; the poster rate no longer prices anything. Stored in{" "}
          <code className="text-foreground">platform_settings</code>, where the payout edge functions read them.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-ds-11">
          <span className="text-muted-foreground">
            Poster service fee <span className="font-semibold text-foreground tabular-nums">{customerFee || "—"}%</span>
          </span>
          <span className="text-muted-foreground">
            Helpr commission <span className="font-semibold text-foreground tabular-nums">{helperFee || "—"}%</span>
          </span>
        </div>
      </div>
    </AdminCard>
  );
}
