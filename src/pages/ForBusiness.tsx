import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Building2,
} from "lucide-react";
import PublicLayout from "@/components/marketing/PublicLayout";
import BackButton from "@/components/BackButton";
import { usePageMeta } from "@/hooks/usePageMeta";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resolveVariant, VARIANTS, type VariantKey } from "@/components/business/variants";
import TrustStrip from "@/components/business/TrustStrip";
import TrustedByBanner from "@/components/business/TrustedByBanner";
import ComplianceSection from "@/components/business/ComplianceSection";
import CaseStudyCarousel from "@/components/business/CaseStudyCarousel";
import PricingTiers from "@/components/business/PricingTiers";

/**
 * /for-business — marketing conversion page.
 *
 * Vertical-aware via `?v=<variant>`. See `src/components/business/variants.ts`
 * for the supported keys. SEO meta updates with the variant; OG image is
 * fixed to the default canonical so social-card previews still resolve.
 */
const ForBusiness = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const variantParam = searchParams.get("v");
  const variant = resolveVariant(variantParam);

  // Per-variant SEO. Canonical points at the default URL so search
  // engines don't fragment the indexable URL by variant; OG title /
  // description still swap so social shares are tailored.
  usePageMeta({
    title: variant.seo.title,
    description: variant.seo.description,
    canonical: "https://www.louisianahelpr.com/for-business",
    ogTitle: variant.seo.title,
    ogDescription: variant.seo.description,
  });

  const switchVariant = (next: VariantKey) => {
    const params = new URLSearchParams(searchParams);
    if (next === "generic") {
      params.delete("v");
    } else {
      params.set("v", next);
    }
    setSearchParams(params, { replace: true });
  };

  return (
    <PublicLayout showCtaBand={false}>
      <div className="relative container mx-auto px-5 py-6 lg:py-8 max-w-7xl space-y-6 lg:space-y-8">
        <div className="grid lg:grid-cols-5 gap-6 lg:gap-8 items-start">
          {/* LEFT — Pitch (3 cols) */}
          <div className="lg:col-span-3 space-y-5">
            <div className="flex items-center gap-3 flex-wrap">
              <BackButton to="/" />
              <span className="text-display-eyebrow">{variant.eyebrow}</span>
            </div>

            <TrustedByBanner />

            <h1
              className="font-display italic font-bold leading-[1.02] text-balance"
              style={{
                fontSize: "clamp(2.25rem, 5vw + 1rem, 4rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.03em",
              }}
            >
              {variant.heroLead}{" "}
              <span style={{ color: "hsl(var(--burnt-sienna))" }}>{variant.heroAccent}</span>
            </h1>

            <p className="subhead-serif text-foreground text-ds-17 lg:text-ds-20 leading-relaxed max-w-xl">
              {variant.subhead}
            </p>

            {/* Vertical switcher — small pill row. Keeps the URL as the source
             * of truth so refresh/back/share all work. */}
            <div
              role="tablist"
              aria-label="Industry"
              className="flex flex-wrap gap-2 pt-1"
            >
              {(Object.keys(VARIANTS) as VariantKey[]).map((key) => {
                const v = VARIANTS[key];
                const active = variant.key === key;
                return (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={active}
                    onClick={() => switchVariant(key)}
                    className="text-ds-11 font-semibold rounded-full px-3 py-1.5 transition-colors"
                    style={{
                      background: active
                        ? "hsl(var(--bark))"
                        : "hsl(var(--bark) / 0.08)",
                      color: active
                        ? "hsl(var(--parchment))"
                        : "hsl(var(--ink-deep))",
                      border: "1px solid hsl(var(--olivewood) / 0.12)",
                    }}
                  >
                    {v.eyebrow.replace(/^For /, "")}
                  </button>
                );
              })}
            </div>

            {/* Feature grid */}
            <div className="grid sm:grid-cols-2 gap-2.5 pt-1">
              {variant.features.map((row, i) => (
                <div
                  key={i}
                  className="liquid-glass flex items-center gap-3 px-4 py-3"
                >
                  <div
                    className="w-9 h-9 rounded-ds-md flex items-center justify-center shrink-0"
                    style={{ background: "hsl(var(--bark) / 0.1)" }}
                  >
                    <row.icon className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
                  </div>
                  <p className="text-ds-13 font-sans leading-snug" style={{ color: "hsl(var(--ink-deep))" }}>{row.text}</p>
                </div>
              ))}
            </div>

            {/* Built for */}
            <div className="liquid-glass p-5">
              <p className="text-ds-13 font-semibold mb-3 flex items-center gap-2" style={{ color: "hsl(var(--ink-deep))" }}>
                <span className="w-1 h-4 rounded-full" style={{ background: "hsl(var(--burnt-sienna))" }} />
                Built for
              </p>
              <ul className="text-ds-11 text-muted-foreground grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
                <li>
                  <span className="text-foreground font-medium">
                    Property managers
                  </span>{" "}
                  — turnovers
                </li>
                <li>
                  <span className="text-foreground font-medium">Realtors</span>{" "}
                  — staging, open houses
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    Event venues
                  </span>{" "}
                  — setup &amp; breakdown
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    Offices &amp; retail
                  </span>{" "}
                  — recurring cleans
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    Restaurants
                  </span>{" "}
                  — deep cleans, overflow
                </li>
                <li>
                  <span className="text-foreground font-medium">
                    Airbnb hosts
                  </span>{" "}
                  — same-day turnovers
                </li>
              </ul>
            </div>
          </div>

          {/* RIGHT — CTA card (2 cols) */}
          <div className="lg:col-span-2 lg:sticky lg:top-6">
            <div className="liquid-glass relative overflow-hidden">
              <div className="relative p-6 lg:p-7">
                <div className="text-center">
                  <div
                    className="w-14 h-14 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                    style={{
                      background: "hsl(var(--bark))",
                      color: "hsl(var(--parchment))",
                      boxShadow: "0 8px 20px -8px hsl(var(--bark) / 0.5)",
                    }}
                  >
                    <Building2 className="w-7 h-7" strokeWidth={1.75} />
                  </div>
                  <span className="text-display-eyebrow">Get started</span>
                  <h2
                    className="font-display italic font-bold mt-1.5 mb-2"
                    style={{
                      fontSize: "clamp(1.5rem, 2vw + 0.5rem, 1.85rem)",
                      color: "hsl(var(--ink-deep))",
                      letterSpacing: "-0.025em",
                    }}
                  >
                    Up and running in minutes.
                  </h2>
                  <p className="text-ds-11 font-sans mb-5" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                    Sign up, invite your team, start posting. No sales calls.
                  </p>

                  <Button
                    variant="bark"
                    size="xl"
                    className="group w-full rounded-ds-md"
                    onClick={() => navigate("/signup?type=business")}
                  >
                    <span>Sign up as a business</span>
                    <ArrowRight className="transition-transform duration-300 group-hover:translate-x-1" />
                  </Button>

                  <p className="text-ds-11 mt-3" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                    Already have an account?{" "}
                    <Link
                      to="/login"
                      className="font-semibold hover:underline"
                      style={{ color: "hsl(var(--bark))" }}
                    >
                      Sign in
                    </Link>
                  </p>
                </div>

                <div className="mt-6 pt-5 border-t" style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}>
                  <p className="text-ds-13 font-semibold mb-3 flex items-center gap-2" style={{ color: "hsl(var(--ink-deep))" }}>
                    <span className="w-1 h-4 rounded-full" style={{ background: "hsl(var(--burnt-sienna))" }} />
                    Team seats
                  </p>
                  <div className="grid grid-cols-1 gap-2">
                    {[
                      { name: "Starter", seats: "2", price: "Free", featured: false },
                      { name: "Crew", seats: "5", price: "$10", featured: false },
                      { name: "Team", seats: "10", price: "$20", featured: true },
                      { name: "Enterprise", seats: "15", price: "$40", featured: false },
                    ].map((tier) => (
                      <div
                        key={tier.name}
                        className={`flex items-center justify-between text-ds-11 rounded-ds-sm px-3 py-2 transition-colors ${
                          tier.featured
                            ? "border border-primary/40 bg-primary/10"
                            : "border border-border/50 bg-background/50 hover:border-border"
                        }`}
                      >
                        <span className="font-semibold">{tier.name}</span>
                        <span className="text-muted-foreground">
                          {tier.seats} ·{" "}
                          <span className="text-foreground font-bold">
                            {tier.price}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-ds-11 text-muted-foreground mt-3 leading-relaxed text-center">
                    Owner's card charged per job — no monthly fees on Starter.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Trust strip — quick scannable claims. */}
        <TrustStrip />

        {/* Demo video + ROI calculator pulled until the real video is
            recorded and the ROI baseline assumptions are validated. */}

        {/* Case studies — variant-aware highlight + 2 baseline cards. */}
        <CaseStudyCarousel highlight={variant.caseStudy} />

        {/* Compliance disclosure — identity verification, escrow, W-9/1099. */}
        <ComplianceSection />

        {/* Pricing tiers — marketing summary, leads back to /signup. */}
        <PricingTiers />
      </div>
    </PublicLayout>
  );
};

export default ForBusiness;
