import { useNavigate } from "react-router-dom";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import { Dialog, DialogContent, DialogHeader, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Crown, Star, Check, type LucideIcon } from "lucide-react";

interface ProUpgradeSheetProps {
  open: boolean;
  onClose: () => void;
  /** Lucide icon for the hero chip — pass the feature's own icon (Zap for
      instant payout, Rocket for boost, Send for direct offer, etc.). */
  icon: LucideIcon;
  /** Italic display headline — the value prop ("Cash out instantly."). */
  title: string;
  /** One-sentence serif body explaining what they unlock. */
  body: string;
  /** Bullet list of perks the user gets at this tier and up. */
  perks: string[];
  /** Cheapest tier that unlocks the feature — "basic", "pro" or "elite".
      Determines copy + CTA destination. */
  requiredTier?: "basic" | "pro" | "elite";
}

/**
 * Reusable paywall sheet — shown when a free helper/poster tries to use a
 * subscription-gated feature (Instant Payout, Boost, Direct Offers, etc.).
 * Brand-aligned: italic display headline, parchment-gold
 * "what you unlock" card, brand bark Upgrade CTA. Routes to Subscription
 * tab where the user can choose a billing cycle.
 */
export function ProUpgradeSheet({
  open,
  onClose,
  icon: Icon,
  title,
  body,
  perks,
  requiredTier = "pro",
}: ProUpgradeSheetProps) {
  const navigate = useNavigate();

  // Branded name, from TIER_PERKS — this string reaches the user in the sheet
  // body and on the CTA ("See Helpr Pro Plans"), and must read the same as
  // the plan card it sends them to.
  const tierLabel =
    requiredTier === "elite" ? TIER_PERKS.elite.name : requiredTier === "basic" ? TIER_PERKS.basic.name : TIER_PERKS.pro.name;
  const TierIcon =
    requiredTier === "elite" ? Crown : requiredTier === "basic" ? Star : Sparkles;
  // Basic's accent is bark — the same treatment its badge preview and the
  // in-app tier card use.
  const accent =
    requiredTier === "elite"
      ? "hsl(var(--gold-warm))"
      : requiredTier === "basic"
        ? "hsl(var(--bark))"
        : "hsl(var(--burnt-sienna))";
  const accentSoft =
    requiredTier === "elite"
      ? "hsl(var(--gold-warm) / 0.14)"
      : requiredTier === "basic"
        ? "hsl(var(--bark) / 0.10)"
        : "hsl(var(--burnt-sienna) / 0.12)";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader className="!text-left space-y-0">
          {/* Tier chip + DialogHero title. The chip is a Pro/Elite-tier
              decoration (accent-tinted rounded square with the tier's Lucide
              icon) — sits BESIDE the shared header text so this dialog reads
              as a sibling of every other DialogHero popup. */}
          <div className="flex items-center gap-3 mb-2">
            <div
              className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
              style={{
                background: accentSoft,
                color: accent,
                border: `0.5px solid ${accent.replace(")", " / 0.36)")}`,
                boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.55)",
              }}
            >
              <Icon className="w-5 h-5" strokeWidth={1.75} />
            </div>
            {/* No `titleStyle` size override. This was the last popup title in
                the app on its own scale — clamp(1.25rem, 2vw + 0.4rem, 1.55rem)
                against the shared clamp(1.2rem, 1.6vw + 0.4rem, 1.45rem) — so
                the upgrade sheet's heading ran ~7% larger than every dialog and
                sheet beside it. The inert `eyebrow`/`eyebrowStyle` props went
                with the ones stripped from the sheet call sites. */}
            <div className="flex-1 min-w-0">
              <DialogHero title={title} />
            </div>
          </div>
        </DialogHeader>

        {/* `body` was accepted, documented, and passed by its caller — and
            never rendered. The one sentence explaining what the paywall
            actually unlocks was dropped on the floor, leaving a bare perk list
            under the headline. This is where a hero subtitle's copy belongs
            under the "one main title" rule anyway: in the body, not stacked
            under the title. */}
        <p
          className="font-serif italic leading-relaxed text-ds-14"
          style={{ color: "hsl(var(--olivewood) / 0.9)" }}
        >
          {body}
        </p>

        {/* What you unlock — parchment-gold card, matches the JobDetailDialog
            take-home pill so it reads as a "this is the value" surface. */}
        <div
          className="rounded-2xl p-4"
          style={{
            background:
              "radial-gradient(circle at 20% 0%, hsla(0, 0%, 100%, 0.55) 0%, transparent 60%), " +
              "var(--surface-premium)",
            border: "0.5px solid hsl(var(--bark) / 0.22)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255, 255, 255, 0.6), " +
              "inset 0 0 0 0.5px hsl(var(--gold-warm) / 0.22)",
          }}
        >
          <ul className="space-y-1.5">
            {perks.map((perk) => (
              <li
                key={perk}
                className="font-serif italic flex items-start gap-2 text-ds-14"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                <Check
                  className="w-3.5 h-3.5 shrink-0 mt-0.5"
                  style={{ color: "hsl(var(--bark))" }}
                  strokeWidth={2.5}
                />
                <span>{perk}</span>
              </li>
            ))}
          </ul>
        </div>

        <DialogFooter className="!flex-col-reverse sm:!flex-row">
          <Button variant="ghost" onClick={onClose} className="rounded-ds-md">
            Maybe Later
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              navigate("/profile?tab=subscription");
            }}
            className="rounded-ds-md flex-1 sm:flex-initial"
          >
            <TierIcon className="w-4 h-4 mr-1.5" />
            See {tierLabel} Plans
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ProUpgradeSheet;
