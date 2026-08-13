import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, Crown, Check, type LucideIcon } from "lucide-react";

interface ProUpgradeSheetProps {
  open: boolean;
  onClose: () => void;
  /** Lucide icon for the hero chip — pass the feature's own icon (Zap for
      instant payout, Rocket for boost, Send for direct offer, etc.). */
  icon: LucideIcon;
  /** Short eyebrow phrase shown in sienna italic above the title (e.g.,
      "Pro perk", "Locked feature"). */
  eyebrow: string;
  /** Italic display headline — the value prop ("Cash out instantly."). */
  title: string;
  /** One-sentence serif body explaining what they unlock. */
  body: string;
  /** Bullet list of perks the user gets at this tier and up. */
  perks: string[];
  /** Required tier — "pro" or "elite". Determines copy + CTA destination. */
  requiredTier?: "pro" | "elite";
}

/**
 * Reusable paywall sheet — shown when a free helper/poster tries to use a
 * subscription-gated feature (Instant Payout, Boost, Direct Offers, etc.).
 * Brand-aligned: italic display headline, sienna eyebrow, parchment-gold
 * "what you unlock" card, brand bark Upgrade CTA. Routes to Subscription
 * tab where the user can choose a billing cycle.
 */
export function ProUpgradeSheet({
  open,
  onClose,
  icon: Icon,
  eyebrow,
  title,
  body,
  perks,
  requiredTier = "pro",
}: ProUpgradeSheetProps) {
  const navigate = useNavigate();

  const tierLabel = requiredTier === "elite" ? "Elite" : "Pro";
  const TierIcon = requiredTier === "elite" ? Crown : Sparkles;
  const accent =
    requiredTier === "elite"
      ? "hsl(var(--gold-warm))"
      : "hsl(var(--burnt-sienna))";
  const accentSoft =
    requiredTier === "elite"
      ? "hsl(var(--gold-warm) / 0.14)"
      : "hsl(var(--burnt-sienna) / 0.12)";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="!gap-4">
        <DialogHeader className="!text-left space-y-0">
          {/* Tier chip + DialogHero eyebrow/title/subtitle stack. The chip
              is a Pro/Elite-tier decoration (accent-tinted rounded square
              with the tier's Lucide icon) — sits BESIDE the shared header
              text so this dialog reads as a sibling of every other
              DialogHero popup. Eyebrow is a React node so the tier icon
              still renders inline before the eyebrow text. */}
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
            <DialogHero
              className="flex-1 min-w-0"
              eyebrow={
                <span className="inline-flex items-center gap-1.5">
                  <TierIcon className="w-3 h-3" /> {eyebrow}
                </span>
              }
              eyebrowStyle={{ color: accent }}
              title={title}
              titleStyle={{ fontSize: "clamp(1.25rem, 2vw + 0.4rem, 1.55rem)" }}
            />
          </div>
        </DialogHeader>

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
                className="font-serif italic flex items-start gap-2"
                style={{ fontSize: "0.85rem", color: "hsl(var(--ink-deep))" }}
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

        <DialogFooter className="!gap-2 !flex-col-reverse sm:!flex-row">
          <Button variant="ghost" onClick={onClose} className="rounded-ds-md">
            Maybe later
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
            See {tierLabel} plans
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ProUpgradeSheet;
