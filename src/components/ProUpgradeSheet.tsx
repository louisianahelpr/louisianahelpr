import { useNavigate } from "react-router-dom";
import { type SubscriptionTier, TIER_PERKS } from "@/lib/subscriptionTiers";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogBody,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import { Sparkles, Crown, Star, Check, type LucideIcon } from "lucide-react";

interface ProUpgradeSheetProps {
  open: boolean;
  onClose: () => void;
  /** Lucide icon for the hero chip — pass the feature's own icon (Zap for
      instant payout, Rocket for boost, Send for direct offer, etc.). */
  icon: LucideIcon;
  /** Italic display headline — Title Case, no full stop, like every other
      popup title ("Unlock Instant Cash Out"). */
  title: string;
  /** One-sentence serif body explaining what they unlock. */
  body: string;
  /** Bullet list of perks the user gets at this tier and up. */
  perks: string[];
  /**
   * Cheapest tier that unlocks the feature. Determines copy + CTA destination.
   *
   * Typed from the tier ladder itself, not spelled out. This read
   * `"basic" | "pro" | "elite"` and so could not express PLUS — while
   * `featuredBadge` and `dedicatedSupport` both have plus as their cheapest
   * entitled tier (TIER_PERK_MATRIX, verified 2026-09-21). Nothing gates those
   * behind this sheet today, so it was a trap rather than a bug: the next
   * person to try would have been forced to name a tier that does not unlock
   * the thing, and upsell the user to a plan that leaves them still locked
   * out.
   *
   * `free` is excluded because a sheet that tells you to upgrade to free is
   * nonsense; everything else comes from the ladder and grows with it.
   */
  requiredTier?: Exclude<SubscriptionTier, "free">;
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
  // `icon` is still accepted so no caller breaks, and deliberately NOT
  // destructured: the header tile it fed is gone (see the Hero below).
  title,
  body,
  perks,
  requiredTier = "pro",
}: ProUpgradeSheetProps) {
  const navigate = useNavigate();

  // Branded name, from TIER_PERKS — this string reaches the user in the sheet
  // body and on the CTA ("See Helpr Pro Plans"), and must read the same as
  // the plan card it sends them to.
  // DERIVED, not a ternary chain. The chain here named elite and basic and let
  // everything else fall through to Pro — so a `plus` requirement would have
  // been LABELLED "Pro" and sent the user to buy the wrong plan.
  const tierLabel = TIER_PERKS[requiredTier].name;
  const TierIcon =
    requiredTier === "elite" ? Crown
    : requiredTier === "basic" ? Star
    : requiredTier === "plus" ? Crown
    : Sparkles;
  // `accent` / `accentSoft` are gone with the header icon tile they painted.
  // Nothing else in this sheet was tinted per tier — the tier reads from the
  // title and the CTA label.

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        {/* NO ICON TILE, and no second DialogHeader around the Hero.
            This was the app's LAST popup header with a decoration in it: a
            48px accent-tinted rounded square holding the tier's Lucide icon,
            sitting in a hand-rolled `<DialogHeader>` that wrapped the Hero
            (which renders its own DialogHeader — so the header was nested
            inside a header).
            PermissionRationaleDialog's 56px tile was removed earlier the same
            day for the same reason: the canonical popup header is the Hero's
            single title line with the X beside it, and a tile beside or above
            the title stops the X being aligned to a heading. If popup headers
            are ever to have icons, they belong in the Hero as ONE slot every
            popup uses — not rebuilt per dialog. The tier is still named in the
            title and on the CTA ("See Helpr Pro Plans"), so nothing is lost
            but the ornament. */}
        <DialogHero title={title} />

        {/* `body` was accepted, documented, and passed by its caller — and
            never rendered. The one sentence explaining what the paywall
            actually unlocks was dropped on the floor, leaving a bare perk list
            under the headline. This is where a hero subtitle's copy belongs
            under the "one main title" rule anyway: in the body, not stacked
            under the title. */}
        <DialogBody>
          <p>{body}</p>
        </DialogBody>

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
                className="font-sans flex items-start gap-2 text-ds-14"
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

        {/* Plain DialogFooter — the className restated its own
            `flex-col-reverse sm:flex-row`, and `flex-1` made this the only
            dialog whose primary grew to fill the footer row. */}
        <DialogFooter>
          <DialogSecondaryAction onClick={onClose}>
            Maybe Later
          </DialogSecondaryAction>
          <DialogPrimaryAction
            onClick={() => {
              onClose();
              navigate("/profile?tab=subscription");
            }}
          >
            <TierIcon className="w-4 h-4 mr-1.5" />
            See {tierLabel} Plans
          </DialogPrimaryAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ProUpgradeSheet;
