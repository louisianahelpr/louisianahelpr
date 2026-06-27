import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

/**
 * Pricing tiers — the same four seat plans as the sticky CTA card, kept in
 * lockstep so the page never shows two conflicting price tables. Prices and
 * seat counts mirror the seat-plan grid that's wired to checkout.
 */
const TIERS = [
  {
    name: "Starter",
    price: "$0",
    cadence: "/mo",
    headline: "No monthly fee",
    sub: "For DIY teams getting started.",
    features: [
      "2 team seats included",
      "Pay per job, no subscription",
      "Standard Stripe escrow",
      "Email support",
    ],
    cta: "Start free",
    href: "/signup?type=business",
    featured: false,
  },
  {
    name: "Crew",
    price: "$10",
    cadence: "/mo",
    headline: "For small crews",
    sub: "For growing teams posting regularly.",
    features: [
      "5 team seats included",
      "Job templates",
      "Standard Stripe escrow",
      "Email support",
    ],
    cta: "Choose Crew",
    href: "/signup?type=business&plan=crew",
    featured: false,
  },
  {
    name: "Team",
    price: "$20",
    cadence: "/mo",
    headline: "Most popular",
    sub: "For teams that post weekly.",
    features: [
      "10 team seats included",
      "Priority support response",
      "Recurring schedules &amp; templates",
      "Per-property billing splits",
    ],
    cta: "Choose Team",
    href: "/signup?type=business&plan=team",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "$40",
    cadence: "/mo",
    headline: "For multi-location operators",
    sub: "Scale across properties and crews.",
    features: [
      "15 team seats included",
      "SSO (SAML / Google Workspace)",
      "Dedicated success manager",
      "Custom invoicing &amp; net-30 terms",
    ],
    cta: "Choose Enterprise",
    href: "/signup?type=business&plan=enterprise",
    featured: false,
  },
] as const;

export function PricingTiers() {
  const navigate = useNavigate();

  return (
    <section
      aria-labelledby="pricing-heading"
      className="liquid-glass p-6 lg:p-8"
    >
      <div className="text-center mb-7">
        <span className="text-display-eyebrow">Pricing</span>
        <h2
          id="pricing-heading"
          className="font-display italic font-bold leading-tight mt-2"
          style={{
            fontSize: "clamp(1.5rem, 2.5vw + 0.5rem, 2rem)",
            color: "hsl(var(--ink-deep))",
            letterSpacing: "-0.025em",
          }}
        >
          Simple plans. Cancel anytime.
        </h2>
        <p className="text-ds-13 text-muted-foreground mt-2">
          Starter is free forever. Upgrade only when you're ready.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {TIERS.map((tier) => (
          <div
            key={tier.name}
            className="relative rounded-ds-md p-5 flex flex-col"
            style={{
              background: tier.featured ? "hsl(var(--bark) / 0.08)" : "hsl(var(--bark) / 0.03)",
              border: tier.featured
                ? "2px solid hsl(var(--burnt-sienna))"
                : "1px solid hsl(var(--olivewood) / 0.12)",
            }}
          >
            {tier.featured && (
              <div
                className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-ds-11 font-semibold flex items-center gap-1"
                style={{
                  background: "hsl(var(--burnt-sienna))",
                  color: "hsl(var(--parchment))",
                }}
              >
                <Sparkles className="w-3 h-3" strokeWidth={2} />
                Most popular
              </div>
            )}

            <div className="mb-4">
              <p
                className="text-ds-13 font-semibold mb-1"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {tier.name}
              </p>
              <div className="flex items-baseline gap-1">
                <span
                  className="font-display italic font-bold tabular-nums"
                  style={{
                    fontSize: "clamp(1.75rem, 3vw + 0.5rem, 2.25rem)",
                    color: "hsl(var(--ink-deep))",
                    letterSpacing: "-0.03em",
                  }}
                >
                  {tier.price}
                </span>
                <span
                  className="text-ds-13"
                  style={{ color: "hsl(var(--olivewood))" }}
                >
                  {tier.cadence}
                </span>
              </div>
              <p className="text-ds-11 text-muted-foreground mt-1.5 leading-snug">
                {tier.sub}
              </p>
            </div>

            <ul className="space-y-2 mb-5 flex-1">
              {tier.features.map((feature) => (
                <li
                  key={feature}
                  className="flex items-start gap-2 text-ds-11"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  <Check
                    className="w-3.5 h-3.5 mt-0.5 shrink-0"
                    strokeWidth={2.5}
                    style={{ color: "hsl(var(--burnt-sienna))" }}
                  />
                  <span
                    /* features list contains HTML entities (&amp;) — keep
                     * them as plain text via dangerouslySetInnerHTML so we
                     * don't ship `&amp;` literally to the DOM. */
                    dangerouslySetInnerHTML={{ __html: feature }}
                  />
                </li>
              ))}
            </ul>

            <Button
              variant={tier.featured ? "bark" : "outline"}
              size="lg"
              className="w-full rounded-ds-md"
              onClick={() => {
                if (tier.href.startsWith("mailto:")) {
                  window.location.href = tier.href;
                } else {
                  navigate(tier.href);
                }
              }}
            >
              {tier.cta}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

export default PricingTiers;
