import { Link } from "react-router-dom";
import { Building2, ArrowRight, Home, Wrench, HeartPulse, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Mid-page "For Business" band. Businesses and property managers previously
 * had to discover the offering through the nav menu or scroll all the way to
 * the footer — this in-content band gives them a prominent entry point right
 * in the landing scroll.
 */
const BusinessCTASection = () => (
  <section className="px-5 sm:px-8 lg:px-12 py-10 sm:py-14 lg:py-20">
    <div className="container mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]">
      <div
        className="observe-fade-up relative overflow-hidden rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10"
        style={{
          background: "hsl(var(--bark) / 0.07)",
          border: "1px solid hsl(var(--bark) / 0.20)",
          boxShadow:
            "inset 0 1px 1px 0 rgba(255,255,255,0.4), 0 12px 32px -12px hsl(var(--bark) / 0.18)",
        }}
      >
        {/* Centered stacked column. A left-hugging max-w-2xl block left the
            right ~45% of this wide band empty (a lopsided dead gutter);
            centering a slightly wider measure fills the band symmetrically so
            the CTA reads as one intentional focal block, not a half-used band.
            Words first, then the two CTAs directly under them — never a
            far-right action panel (that reintroduced a mid-band gap). */}
        <div className="max-w-3xl mx-auto space-y-2.5 text-center">
          <span className="text-display-eyebrow inline-flex items-center gap-2">
            <Building2 className="w-3.5 h-3.5" strokeWidth={1.75} />
            For business
          </span>
          <h2
            className="font-display font-bold leading-tight text-ds-24 sm:text-ds-32"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
          >
            One trusted crew for everything your business runs on.
          </h2>
          <p className="text-ds-13 sm:text-ds-15 leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
            Post jobs or find work — Helpr connects businesses with ID-verified local
            pros across every industry. Cleanings, turnovers, hauling, repairs, and
            the skilled trades, recurring or on-demand. Whatever your industry needs,
            we cover it.
          </p>
          <div className="flex flex-wrap justify-center gap-2 mt-4">
            {[
              { Icon: Home, label: "Property & rentals" },
              { Icon: Wrench, label: "Skilled trades" },
              { Icon: HeartPulse, label: "Healthcare" },
              { Icon: Plus, label: "Any industry" },
            ].map(({ Icon, label }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-ds-11 font-sans font-medium"
                style={{
                  backgroundColor: "hsl(var(--bark) / 0.08)",
                  color: "hsl(var(--olivewood))",
                  border: "1px solid hsl(var(--bark) / 0.15)",
                }}
              >
                <Icon className="w-3 h-3 shrink-0" strokeWidth={1.75} style={{ color: "hsl(var(--bark))" }} />
                {label}
              </span>
            ))}
          </div>
          {/* Two CTAs sit inline under the words (stack on mobile) — surfaces
              both sides of the marketplace: the Business hub AND browsing work. */}
          <div className="flex flex-col sm:flex-row justify-center gap-3 pt-5">
            <Button
              asChild
              size="lg"
              className="btn-grad-primary group rounded-2xl font-sans font-semibold transition-[transform,filter] duration-200 hover:brightness-110 active:scale-[0.98] !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))]"
              style={{
                color: "hsl(var(--parchment))",
                border: "1px solid hsl(66 25% 19%)",
                boxShadow:
                  "inset 0 1px 0 0 hsl(var(--parchment) / 0.22), 0 8px 24px -8px hsl(var(--bark) / 0.35)",
              }}
            >
              <Link to="/for-business">
                Helpr for Business
                <ArrowRight className="ml-2 w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.75} />
              </Link>
            </Button>
            <Link
              to="/jobs"
              className="group inline-flex items-center justify-center gap-1.5 rounded-2xl px-5 py-2.5 text-ds-13 font-sans font-semibold transition-colors hover:bg-[hsl(var(--bark)/0.08)]"
              style={{
                color: "hsl(var(--bark))",
                border: "1px solid hsl(var(--bark) / 0.25)",
              }}
            >
              Browse open jobs
              <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.75} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  </section>
);

export default BusinessCTASection;
