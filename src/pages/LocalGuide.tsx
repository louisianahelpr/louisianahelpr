/**
 * /local-guide — public "Pricing Guide" linked from the footer Resources
 * column. Renders the per-category market ranges that already drive Smart
 * Price in the post-job flow (`categoryPricing` in `@/lib/pricingGuide`), so
 * the guide and the in-flow suggestion can never disagree.
 *
 * No auth required. Document-scroll layout (PublicLayout + PageHeader).
 */
import { useNavigate } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import PageHeader from "@/components/PageHeader";
import PublicLayout from "@/components/marketing/PublicLayout";
import { Button } from "@/components/ui/button";
import { categoryPricing, getSmartPrice } from "@/lib/pricingGuide";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { ShieldCheck, Sparkles, Wallet, ArrowRight } from "lucide-react";

const HOW_PRICING_WORKS = [
  {
    icon: Wallet,
    title: "You set the budget",
    body: "These ranges are guidance from real Louisiana jobs — not fixed prices. You decide what to offer.",
  },
  {
    icon: Sparkles,
    title: "Smart Price fills it in",
    body: "Not sure what to pay? Smart Price suggests the market midpoint for your category in one tap.",
  },
  {
    icon: ShieldCheck,
    title: "Escrow holds it safely",
    body: "Your payment is held in Stripe escrow and only released when the job is done. No hidden fees.",
  },
];

const LocalGuide = () => {
  usePageTitle("Pricing Guide — What Jobs Typically Cost on Helpr");
  const navigate = useNavigate();

  const categories = Object.entries(categoryPricing);

  return (
    <PublicLayout showCtaBand={false}>
      <PageHeader
        title="Pricing Guide"
        eyebrow="What jobs typically cost"
        onBack={() => navigate(-1)}
      />

      <div className="mx-auto max-w-2xl px-4 pt-2 pb-16 space-y-10">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="liquid-glass px-5 py-7 text-center">
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
            style={{
              background: "hsl(var(--bark))",
              color: "hsl(var(--parchment))",
              boxShadow: "0 8px 20px -8px hsl(var(--bark) / 0.5)",
            }}
          >
            <Wallet className="w-7 h-7" strokeWidth={1.75} />
          </div>
          <h2
            className="font-display font-bold italic leading-[1.05] mb-2 text-balance"
            style={{
              fontSize: "clamp(1.75rem, 4vw + 0.5rem, 2.5rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            What should you pay?
          </h2>
          <p className="text-ds-15 text-muted-foreground leading-relaxed max-w-md mx-auto">
            Typical price ranges for common jobs across Louisiana. Use them as a
            starting point — you always set your own budget.
          </p>
        </section>

        {/* ── Category ranges ──────────────────────────────────────────────── */}
        <section>
          <h3
            className="font-serif italic uppercase text-ds-9 mb-4"
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            Typical ranges by category
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {categories.map(([slug, { min, max, label }]) => {
              const Icon = getCategoryIcon(slug);
              const smart = getSmartPrice(slug);
              return (
                <div key={slug} className="liquid-glass px-4 py-4 flex items-start gap-3">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: "hsl(var(--bark) / 0.1)" }}
                  >
                    <Icon className="w-4.5 h-4.5" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-ds-14 font-bold leading-tight"
                      style={{ color: "hsl(var(--ink-deep))" }}
                    >
                      {label}
                    </p>
                    <p
                      className="font-display font-bold italic text-ds-18 mt-0.5"
                      style={{ color: "hsl(var(--bark))" }}
                    >
                      ${min}–${max}
                    </p>
                    {smart !== null && (
                      <p className="text-ds-11 text-muted-foreground mt-0.5">
                        Smart Price ~${smart}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-ds-11 text-muted-foreground mt-3 leading-snug text-center">
            Ranges reflect typical market rates and vary by job size, urgency, and
            parish.
          </p>
        </section>

        {/* ── How pricing works ────────────────────────────────────────────── */}
        <section>
          <h3
            className="font-serif italic uppercase text-ds-9 mb-4"
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
          >
            How pricing works
          </h3>
          <div className="space-y-3">
            {HOW_PRICING_WORKS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="liquid-glass px-4 py-4 flex items-start gap-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: "hsl(var(--sage) / 0.16)" }}
                >
                  <Icon className="w-4.5 h-4.5" style={{ color: "hsl(var(--success-ink))" }} strokeWidth={1.75} />
                </div>
                <div>
                  <p
                    className="text-ds-14 font-bold leading-tight"
                    style={{ color: "hsl(var(--ink-deep))" }}
                  >
                    {title}
                  </p>
                  <p className="text-ds-13 text-muted-foreground mt-1 leading-snug">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────────────────────── */}
        <div className="text-center">
          <Button
            variant="bark"
            size="lg"
            className="w-full sm:w-auto gap-2"
            onClick={() => navigate("/post-job")}
          >
            Post a job now
            <ArrowRight className="w-4 h-4" strokeWidth={2} />
          </Button>
        </div>
      </div>
    </PublicLayout>
  );
};

export default LocalGuide;
