import { Link } from "react-router-dom";
import { MapPin, ArrowRight } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import PublicLayout from "@/components/marketing/PublicLayout";
import { usePageTitle } from "@/hooks/usePageTitle";
import { LOUISIANA_PARISHES } from "@/lib/parishes";

// Rotating chip palette so the parish grid reads as rich and varied rather
// than a monochrome wall of sienna. Cycled by card index (idx % length).
const CHIP_TINTS = [
  "bark",
  "burnt-sienna",
  "olivewood",
  "gold-warm",
  "success-ink",
] as const;

const ParishesPage = () => {
  usePageTitle("Louisiana Parishes — Helpr Community");

  return (
    <PublicLayout>
      <PageHeader
        eyebrow="Louisiana Helpr Community"
        title="Browse by Parish"
        meta={`Find local jobs and helpers across all ${LOUISIANA_PARISHES.length} Louisiana parishes`}
      />

      <main className="container mx-auto px-5 lg:px-8 xl:px-12 py-6 max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] space-y-6">
        {/* Premium hero — elevated badge, two-tone display headline, serif subhead */}
        <section className="liquid-glass px-5 py-7 text-center">
          <div
            className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
            style={{
              background: "hsl(var(--bark))",
              color: "hsl(var(--parchment))",
              boxShadow: "0 8px 20px -8px hsl(var(--bark) / 0.5)",
            }}
          >
            <MapPin className="w-7 h-7" strokeWidth={1.75} />
          </div>
          <h1
            className="font-display font-bold italic leading-[1.05] mb-2 text-balance"
            style={{
              fontSize: "clamp(1.9rem, 4.5vw + 0.5rem, 3rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.03em",
            }}
          >
            Serving all{" "}
            <span style={{ color: "hsl(var(--burnt-sienna))" }}>
              {LOUISIANA_PARISHES.length} parishes
            </span>
          </h1>
          <p className="subhead-serif text-foreground text-ds-15 lg:text-ds-17 leading-relaxed max-w-md mx-auto">
            From the bayous to the Delta, Louisiana Helpr connects neighbors with
            trusted local help in every corner of the state.
          </p>
        </section>

        {/* Section label with tick */}
        <p
          className="font-serif italic uppercase text-ds-9"
          style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
        >
          <span
            className="inline-block w-1 h-4 rounded-full mr-2 align-middle"
            style={{ background: "hsl(var(--burnt-sienna))" }}
          />
          Browse by parish
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {LOUISIANA_PARISHES.map(({ slug, name }, idx) => {
            const tint = CHIP_TINTS[idx % CHIP_TINTS.length];
            return (
              <Link
                key={slug}
                to={`/parish/${slug}`}
                className="flex items-center gap-3 rounded-ds-md liquid-glass p-4 hover:ring-1 hover:ring-primary/20 transition-all group"
                aria-label={`Browse ${name} Parish`}
              >
                <div
                  className="w-9 h-9 rounded-ds-sm flex items-center justify-center shrink-0"
                  style={{
                    background: `hsl(var(--${tint}) / 0.08)`,
                    border: `0.5px solid hsl(var(--${tint}) / 0.18)`,
                  }}
                >
                  <MapPin className="w-4 h-4" style={{ color: `hsl(var(--${tint}))` }} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-ds-13 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                    {name} Parish
                  </p>
                </div>
                <ArrowRight
                  className="w-4 h-4 shrink-0 opacity-40 group-hover:opacity-70 transition-opacity"
                  style={{ color: "hsl(var(--olivewood))" }}
                />
              </Link>
            );
          })}
        </div>
      </main>
    </PublicLayout>
  );
};

export default ParishesPage;
