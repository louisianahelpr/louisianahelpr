import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  Users,
  CreditCard,
} from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";

const ForBusiness = () => {
  const navigate = useNavigate();
  usePageTitle("Helpr for Business — Louisiana Commercial Services");

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      {/* Ambient background orbs */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -right-32 w-[520px] h-[520px] rounded-full bg-primary/15 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-32 w-[480px] h-[480px] rounded-full bg-accent/20 blur-3xl"
      />

      <div className="relative container mx-auto px-5 py-5 lg:py-7 max-w-6xl">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4 lg:mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Helpr
        </Link>

        <div className="grid lg:grid-cols-5 gap-6 lg:gap-10 items-start">
          {/* LEFT — Pitch (3 cols) */}
          <div className="lg:col-span-3 space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/80 backdrop-blur text-secondary-foreground text-[11px] font-medium tracking-wide uppercase shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              For Business
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-display font-bold leading-[1.08] text-balance">
              ID-verified Louisiana help,{" "}
              <span className="relative inline">
                <span className="relative z-10 text-primary">on demand.</span>
                <span
                  aria-hidden
                  className="absolute inset-x-0 bottom-1 h-3 bg-primary/20 -z-0 rounded"
                />
              </span>
            </h1>

            <p className="text-base lg:text-lg text-muted-foreground leading-relaxed max-w-xl">
              Property managers, realtors, and small business owners — give your
              team shared access to vetted local helprs without the agency
              markup.
            </p>

            {/* Feature grid */}
            <div className="grid sm:grid-cols-2 gap-2.5 pt-1">
              {[
                { icon: ShieldCheck, text: "Stripe ID-verified helprs" },
                { icon: Users, text: "2 team seats free, upgrade anytime" },
                { icon: CreditCard, text: "Owner's card billed for all jobs" },
                { icon: Sparkles, text: "Recurring jobs, all 64 parishes" },
                { icon: CheckCircle2, text: "Flat platform fee, no contracts" },
              ].map((row, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl border border-border/50 bg-card/50 backdrop-blur px-3 py-2.5 hover:border-primary/30 hover:bg-card transition-colors"
                >
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 text-primary flex items-center justify-center shrink-0">
                    <row.icon className="w-4 h-4" />
                  </div>
                  <p className="text-sm pt-1 leading-snug">{row.text}</p>
                </div>
              ))}
            </div>

            {/* Built for */}
            <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-card to-secondary/30 p-5">
              <p className="text-sm font-semibold mb-3 flex items-center gap-2">
                <span className="w-1 h-4 rounded-full bg-primary" />
                Built for
              </p>
              <ul className="text-xs text-muted-foreground grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
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
            <div className="relative rounded-3xl border border-border/60 bg-gradient-to-br from-card via-card to-primary/5 shadow-[0_20px_60px_-20px_hsl(var(--primary)/0.25)] overflow-hidden">
              {/* Decorative accent */}
              <div
                aria-hidden
                className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-2xl"
              />

              <div className="relative p-6 lg:p-7">
                <div className="text-center">
                  <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gradient-to-br from-primary to-primary/70 text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/30">
                    <Building2 className="w-7 h-7" />
                  </div>
                  <h2 className="text-2xl font-display font-bold mb-1.5">
                    Get started in minutes
                  </h2>
                  <p className="text-sm text-muted-foreground mb-5">
                    Sign up, invite your team, start posting. No sales calls.
                  </p>

                  <Button
                    variant="hero"
                    size="xl"
                    className="group w-full"
                    onClick={() => navigate("/signup?type=business")}
                  >
                    <span>Sign up as a business</span>
                    <ArrowRight className="transition-transform duration-300 group-hover:translate-x-1" />
                  </Button>

                  <p className="text-xs text-muted-foreground mt-3">
                    Already have an account?{" "}
                    <Link
                      to="/login"
                      className="text-primary font-medium hover:underline"
                    >
                      Log in
                    </Link>
                  </p>
                </div>

                <div className="mt-6 pt-5 border-t border-border/60">
                  <p className="text-sm font-semibold mb-3 flex items-center gap-2">
                    <span className="w-1 h-4 rounded-full bg-primary" />
                    Team seats
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { name: "Starter", seats: "2", price: "Free", featured: false },
                      { name: "Crew", seats: "5", price: "$10", featured: false },
                      { name: "Team", seats: "10", price: "$20", featured: true },
                      { name: "Enterprise", seats: "25", price: "$40", featured: false },
                    ].map((tier) => (
                      <div
                        key={tier.name}
                        className={`flex items-center justify-between text-xs rounded-lg px-3 py-2 transition-colors ${
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
                  <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed text-center">
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
