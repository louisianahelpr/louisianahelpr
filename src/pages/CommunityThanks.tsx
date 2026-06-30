import { Link } from "react-router-dom";
import { ArrowRight, Heart, HandHeart, Sprout, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import PublicLayout from "@/components/marketing/PublicLayout";
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
    body: "Every task posted is a hand extended and a hand taken — a small act of trust between two people who live down the road from each other.",
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
  usePageMeta({
    title: "Thank You, Louisiana — Helpr",
    description:
      "A thank-you to the Louisiana neighbors, helpers, and posters who make Helpr a community. Money that stays home, neighbors helping neighbors.",
    canonical: "https://www.louisianahelpr.com/community",
  });
  useScrollFadeUp();

  return (
    <PublicLayout
      ctaHeadline="Join your neighbors"
      ctaSubcopy="Post a task or find work — and become part of the Louisiana community."
    >
      <div className="container mx-auto px-5 max-w-4xl">
        {/* Hero */}
        <section className="text-center pt-10 pb-12 lg:pt-16 lg:pb-16 observe-fade-up">
          <span
            className="font-serif italic uppercase text-[0.7rem]"
            style={{ color: "hsl(var(--burnt-sienna) / 0.8)", letterSpacing: "0.2em" }}
          >
            From all of us at Helpr
          </span>
          <h1
            className="font-display italic font-bold mt-3 text-balance"
            style={{
              fontSize: "clamp(2.5rem, 6vw + 1rem, 4.5rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.03em",
              lineHeight: 1.02,
            }}
          >
            Thank you,{" "}
            <span style={{ color: "hsl(var(--burnt-sienna))" }}>Louisiana.</span>
          </h1>
          <p
            className="subhead-serif mt-5 mx-auto max-w-xl text-ds-17 lg:text-ds-20 leading-relaxed"
            style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          >
            Every job posted, every task completed, every neighbor who showed up
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
            people who decide to show up for each other — one task at a
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

        {/* See the impact link */}
        <section className="text-center pb-6 observe-fade-up">
          <Button
            asChild
            variant="outline"
            size="lg"
            className="group rounded-ds-md px-8"
            style={{
              borderColor: "hsl(var(--olivewood) / 0.3)",
              color: "hsl(var(--ink-deep))",
            }}
          >
            <Link to="/impact">
              See our community impact
              <ArrowRight className="ml-1.5 w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </Button>
        </section>
      </div>
    </PublicLayout>
  );
};

export default CommunityThanks;
