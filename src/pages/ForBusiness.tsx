import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  Users,
  CreditCard,
} from "lucide-react";
import Navbar from "@/components/Navbar";
import BackButton from "@/components/BackButton";
import { usePageMeta } from "@/hooks/usePageMeta";

const ForBusiness = () => {
  usePageMeta({
    title: "Helpr for Business — Louisiana Commercial Services",
    description:
      "Find, hire, and pay verified local pros for your Louisiana business. Free team seats, Stripe ID-verified helprs, flat platform fee, no contracts.",
    canonical: "https://www.louisianahelpr.com/for-business",
    ogTitle: "Helpr for Business — Hire Local Pros Across Louisiana",
    ogDescription:
      "The simplest way for Louisiana businesses to find, hire, and pay local pros for cleaning, turnovers, events, and recurring tasks.",
  });

  return (
    <div className="relative min-h-screen page-warmth pb-safe-nav">
      <div aria-hidden className="mesh-gradient-global" />
      <Navbar />
      <div aria-hidden style={{ height: "calc(max(env(safe-area-inset-top), 0.25rem) + 3.5rem)" }} />

      <div className="relative container mx-auto px-5 py-6 lg:py-8 max-w-7xl">

        <div className="grid lg:grid-cols-5 gap-6 lg:gap-8 items-start">
          {/* LEFT — Pitch (3 cols) */}
          <div className="lg:col-span-3 space-y-5">
            <div className="flex items-center gap-3">
              <BackButton to="/" />
              <span className="text-display-eyebrow">For business</span>
            </div>

            <h1
              className="font-display italic font-bold leading-[1.02] text-balance"
              style={{
                fontSize: "clamp(2.25rem, 5vw + 1rem, 4rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.03em",
              }}
            >
              The best help for{" "}
              <span style={{ color: "hsl(var(--burnt-sienna))" }}>Louisiana businesses.</span>
            </h1>

            <p className="subhead-serif text-foreground text-ds-17 lg:text-ds-20 leading-relaxed max-w-xl">
              The simplest way to find, hire, and pay local pros for your business tasks.
            </p>

            {/* Feature grid */}
            <div className="grid sm:grid-cols-2 gap-2.5 pt-1">
              {[
                { icon: ShieldCheck, text: "Stripe ID-verified helprs" },
                { icon: Users, text: "2 team seats free, upgrade anytime" },
                { icon: CreditCard, text: "Owner's card billed for all jobs" },
                { icon: Sparkles, text: "Recurring jobs, statewide coverage" },
                { icon: CheckCircle2, text: "Flat platform fee, no contracts" },
              ].map((row, i) => (
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
                    onClick={() => {
                      window.location.href = "/signup?type=business";
                    }}
                  >
                    <span>Sign up as a business</span>
                    <ArrowRight className="transition-transform duration-300 group-hover:translate-x-1" />
                  </Button>

                  <p className="text-ds-11 mt-3" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                    Already have an account?{" "}
                    <a
                      href="/login"
                      className="font-semibold hover:underline"
                      style={{ color: "hsl(var(--bark))" }}
                    >
                      Sign in
                    </a>
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
      </div>
    </div>
  );
};

export default ForBusiness;
