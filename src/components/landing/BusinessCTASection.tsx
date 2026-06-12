import { Link } from "react-router-dom";
import { Building2, ArrowRight, RefreshCw, Home, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Mid-page "For Business" band. Businesses and property managers previously
 * had to discover the offering through the nav menu or scroll all the way to
 * the footer — this in-content band gives them a prominent entry point right
 * in the landing scroll.
 */
const BusinessCTASection = () => (
  <section className="px-5 sm:px-8 lg:px-12 py-10 sm:py-12">
    <div className="container mx-auto max-w-5xl">
      <div
        className="observe-fade-up relative overflow-hidden rounded-[2rem] px-6 py-8 sm:px-10 sm:py-10"
        style={{
          background: "hsl(var(--bark) / 0.07)",
          border: "1px solid hsl(var(--bark) / 0.20)",
          boxShadow:
            "inset 0 1px 1px 0 rgba(255,255,255,0.4), 0 12px 32px -12px hsl(var(--bark) / 0.18)",
        }}
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-xl space-y-2.5">
            <span
              className="inline-flex items-center gap-2 font-serif italic uppercase text-[0.66rem] tracking-[0.18em]"
              style={{ color: "hsl(var(--burnt-sienna))" }}
            >
              <Building2 className="w-3.5 h-3.5" strokeWidth={1.75} />
              For business
            </span>
            <h2
              className="font-display font-bold leading-tight text-ds-24 sm:text-ds-32"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
            >
              Running a business or rental property?
            </h2>
            <p className="text-ds-13 sm:text-ds-15 leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
              Helpr handles your recurring tasks — cleanings, hauling, repairs, and
              turnovers — on demand, with ID-verified local help.
            </p>
            <div className="flex flex-wrap gap-2 mt-4">
              {[
                { Icon: RefreshCw, label: "Recurring cleanings" },
                { Icon: Home, label: "Property turnovers" },
                { Icon: Truck, label: "On-demand hauling" },
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
          </div>
          <Button
            asChild
            size="lg"
            className="btn-liquid-fill group shrink-0 rounded-2xl font-sans font-semibold !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))]"
            style={{
              color: "hsl(var(--parchment))",
              backgroundColor: "hsl(var(--bark))",
              backgroundImage: "none",
              border: "1px solid hsl(var(--bark))",
              boxShadow:
                "inset 0 1px 0 0 rgba(255,255,255,0.25), 0 8px 24px -8px rgba(0,0,0,0.18)",
            }}
          >
            <Link to="/for-business">
              Helpr for Business
              <ArrowRight className="ml-2 w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.75} />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  </section>
);

export default BusinessCTASection;
