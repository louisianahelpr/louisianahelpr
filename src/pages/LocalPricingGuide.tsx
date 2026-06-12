import { useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { getCategoryIcon } from "@/lib/categoryIcons";
import type { LucideIcon } from "lucide-react";
import { Cloud, CalendarCheck } from "lucide-react";

interface PricingRow {
  category: string;
  label: string;
  low: number;
  high: number;
  note: string;
  /** Override icon when category doesn't map to standard slug */
  customIcon?: LucideIcon;
}

const PRICING_DATA: PricingRow[] = [
  { category: "cleaning",  label: "Cleaning",   low: 60,  high: 150, note: "Standard home; deep clean higher" },
  { category: "yard_work", label: "Yard Work",   low: 40,  high: 120, note: "Lawn mowing; large yards + trimming higher" },
  { category: "moving",    label: "Moving",      low: 80,  high: 300, note: "Local moves; full-home moves at the high end" },
  { category: "errands",   label: "Errands",     low: 25,  high: 60,  note: "Shopping, pickups, drop-offs" },
  { category: "handyman",  label: "Handyman",    low: 50,  high: 200, note: "Simple fixes; complex repairs higher" },
  { category: "painting",  label: "Painting",    low: 100, high: 400, note: "Per room; whole-home higher" },
  { category: "delivery",  label: "Delivery",    low: 30,  high: 80,  note: "Local delivery; heavy items higher" },
  { category: "pet_care",  label: "Pet Care",    low: 25,  high: 75,  note: "Dog walking/sitting; boarding higher" },
  { category: "assembly",  label: "Assembly",    low: 40,  high: 100, note: "Furniture assembly; large projects higher" },
  { category: "storm_prep",label: "Storm Prep",  low: 80,  high: 350, note: "Boarding up, debris removal, tarping", customIcon: Cloud },
  { category: "events",    label: "Events",      low: 60,  high: 250, note: "Setup/breakdown crews; per event", customIcon: CalendarCheck },
];

const LocalPricingGuide = () => {
  usePageTitle("Pricing Guide — Helpr");
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-premium-page pb-safe-nav">
      <PageHeader
        title="Local Pricing Guide"
        eyebrow="What help costs in Louisiana"
        meta="Real price ranges based on jobs posted across Louisiana parishes."
        onBack={() => navigate(-1)}
      />

      <div className="mx-auto max-w-5xl lg:max-w-6xl 2xl:max-w-7xl px-5 lg:px-8 xl:px-12 pb-10 space-y-3">
        {/* Category cards */}
        {PRICING_DATA.map((row) => {
          const Icon = row.customIcon ?? getCategoryIcon(row.category);
          return (
            <div
              key={row.category}
              className="flex items-center gap-4 rounded-ds-md px-4 py-4"
              style={{
                background: "hsl(var(--parchment) / 0.85)",
                boxShadow:
                  "inset 0 1px 0 hsl(255 255% 255% / 0.5), 0 1px 3px hsl(var(--olivewood) / 0.07), 0 4px 12px -4px hsl(var(--olivewood) / 0.09)",
              }}
            >
              {/* Icon tile */}
              <div
                className="w-11 h-11 rounded-ds-sm flex items-center justify-center shrink-0"
                style={{
                  background: "hsl(var(--bark) / 0.08)",
                }}
              >
                <Icon
                  className="w-5 h-5"
                  aria-hidden={true}
                  style={{ color: "hsl(var(--bark))" }}
                />
              </div>

              {/* Label + note */}
              <div className="flex-1 min-w-0">
                <p
                  className="font-semibold text-sm leading-tight"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {row.label}
                </p>
                <p
                  className="text-xs mt-0.5 leading-snug"
                  style={{ color: "hsl(var(--olivewood) / 0.75)" }}
                >
                  {row.note}
                </p>
              </div>

              {/* Price range */}
              <div className="text-right shrink-0">
                <p
                  className="font-display font-bold tabular-nums leading-none"
                  style={{
                    color: "hsl(var(--bark))",
                    fontSize: "1.125rem",
                    letterSpacing: "-0.02em",
                  }}
                >
                  ${row.low}–${row.high}
                </p>
                <p
                  className="text-[10px] mt-0.5"
                  style={{ color: "hsl(var(--olivewood) / 0.6)" }}
                >
                  typical range
                </p>
              </div>
            </div>
          );
        })}

        {/* Disclaimer */}
        <p
          className="text-xs text-center leading-relaxed pt-2"
          style={{ color: "hsl(var(--olivewood) / 0.65)" }}
        >
          Final prices are set by you when posting. These ranges reflect typical budgets on Helpr.
        </p>

        {/* CTA */}
        <div className="pt-2">
          <Button
            className="w-full"
            size="lg"
            onClick={() => navigate("/post-job")}
            style={{
              background: "hsl(var(--bark))",
              color: "hsl(var(--parchment))",
            }}
          >
            Post a job in under 2 minutes
          </Button>
        </div>
      </div>
    </div>
  );
};

export default LocalPricingGuide;
