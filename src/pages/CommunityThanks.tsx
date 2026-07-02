import { useNavigate } from "react-router-dom";
import { Heart, HandHeart, Sprout, MapPin } from "lucide-react";
import PublicLayout from "@/components/marketing/PublicLayout";
import PageHeader from "@/components/PageHeader";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useScrollFadeUp } from "@/hooks/useScrollFadeUp";

/**
 * CommunityThanks — public "/community" thank-you page.
 *
 * A warm, document-scroll gratitude page addressed to Louisiana neighbors.
 * Distinct from the authed before/after feed (Community.tsx) and from the
 * community *guidelines* tab in /legal — this is the marketing-surface
 * thank-you the footer/landing points to. PublicLayout supplies the shared
 * nav + footer; the page closes on the standard CTA band.
 */

const PILLARS = [
  {
    icon: HandHeart,
    title: "Neighbors helping neighbors",
    body: "Every job posted is a hand extended and a hand taken — a small act of trust between two people who live down the road from each other.",
  },
  {
    icon: Sprout,
    title: "Money that stays home",
    body: "When you hire a Helpr, the earnings circulate inside your own parish — paying for groceries, gas, and growing dreams right here in Louisiana.",
  },
  {
    icon: Heart,
    title: "Built on gratitude",
    body: "Storm cleanups, last-minute moves, a porch repaired before the family arrives — none of it happens without the people who showed up. Thank you.",
  },
];

const CommunityThanks = () => {
  const navigate = useNavigate();
  usePageMeta({
    title: "Thank You, Louisiana — Helpr",
    description:
      "A thank-you to the Louisiana neighbors, Helprs, and posters who make Helpr a community. Money that stays home, neighbors helping neighbors.",
    canonical: "https://www.louisianahelpr.com/community",
    ogTitle: "Thank You, Louisiana — Helpr",
    ogDescription:
      "A thank-you to the Louisiana neighbors, Helprs, and posters who make Helpr a community. Money that stays home, neighbors helping neighbors.",
  });
  useScrollFadeUp();

  return (
    <PublicLayout
      ctaHeadline="Join your neighbors"
      ctaSubcopy="Post a job or find work — and become part of the Louisiana community."
    >
      <PageHeader
        eyebrow="From all of us at Helpr"
        title="Thank you, Louisiana"
        meta="A note to the neighbors who make Helpr more than an app"
        onBack={() => navigate("/")}
      />

      <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] px-5 lg:px-8 xl:px-12">
        {/* Lead */}
        <section className="pt-4 pb-12 lg:pb-16 observe-fade-up">
          <p
            className="subhead-serif max-w-2xl text-ds-17 lg:text-ds-20 leading-relaxed"
            style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          >
            Every job posted, every job completed, every neighbor who showed up
            for another — you are what makes Helpr more than an app. This one's
            for you.
          </p>
        </section>

        {/* Gratitude pillars */}
        <section className="grid gap-5 sm:grid-cols-3 pb-14 lg:pb-20">
          {PILLARS.map((p, i) => {
            const Icon = p.icon;
            return (
              <div
                key={p.title}
                className="liquid-glass rounded-ds-md px-6 py-7 observe-fade-up"
                style={{
                  transitionDelay: `${100 + i * 90}ms`,
                  border: "0.5px solid hsl(var(--olivewood) / 0.14)",
                }}
              >
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center mb-4"
                  style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
                >
                  <Icon
                    className="w-5 h-5"
                    strokeWidth={1.8}
                    style={{ color: "hsl(var(--burnt-sienna))" }}
                  />
                </div>
                <h2
                  className="font-display font-bold italic text-ds-17 tracking-tight"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {p.title}
                </h2>
                <p
                  className="font-sans text-ds-13 leading-relaxed mt-2"
                  style={{ color: "hsl(var(--olivewood) / 0.85)" }}
                >
                  {p.body}
                </p>
              </div>
            );
          })}
        </section>

        {/* Pull-quote */}
        <section className="text-center pb-14 lg:pb-20 observe-fade-up">
          <div className="flex justify-center gap-1.5 mb-6">
            {[0.5, 0.7, 0.5].map((o, i) => (
              <span
                key={i}
                className="rounded-full"
                style={{
                  width: i === 1 ? "0.375rem" : "0.25rem",
                  height: i === 1 ? "0.375rem" : "0.25rem",
                  backgroundColor: `hsl(var(--burnt-sienna) / ${o})`,
                }}
              />
            ))}
          </div>
          <blockquote
            className="editorial-quote mx-auto max-w-2xl"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            &ldquo;A community isn&rsquo;t built by an app. It&rsquo;s built by
            people who decide to show up for each other — one job at a
            time.&rdquo;
          </blockquote>
          <div
            className="mt-6 inline-flex items-center gap-1.5 font-serif italic text-ds-13"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            <MapPin className="w-3.5 h-3.5" />
            Serving every parish in Louisiana
          </div>
        </section>
      </div>
    </PublicLayout>
  );
};

export default CommunityThanks;
