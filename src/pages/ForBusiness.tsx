import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Building2, CheckCircle2, ShieldCheck, Sparkles, Users, CreditCard } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";

const ForBusiness = () => {
  const navigate = useNavigate();
  usePageTitle("Helpr for Business — Louisiana Commercial Services");

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20 flex flex-col">
      <div className="container mx-auto px-5 py-4 lg:py-6 max-w-6xl flex-1 flex flex-col">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3 lg:mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Helpr
        </Link>

        <div className="grid lg:grid-cols-5 gap-6 lg:gap-8 items-start flex-1">
          {/* Pitch — 3 cols */}
          <div className="lg:col-span-3 space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
              <Building2 className="w-3.5 h-3.5" /> For Business
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-[2.5rem] font-display font-bold leading-[1.15]">
              ID-verified Louisiana help, on demand for your business.
            </h1>
            <p className="text-base text-muted-foreground">
              Property managers, realtors, small business owners, and commercial cleaners — vetted local helprs without the agency markup.
            </p>

            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 pt-1">
              {[
                { icon: ShieldCheck, text: "Stripe ID-verified helprs" },
                { icon: Users, text: "2 team seats free, upgrade anytime" },
                { icon: CreditCard, text: "Owner's card billed for all jobs" },
                { icon: Sparkles, text: "Recurring jobs, all 64 parishes" },
                { icon: CheckCircle2, text: "Flat platform fee, no contracts" },
              ].map((row, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <row.icon className="w-3.5 h-3.5" />
                  </div>
                  <p className="text-sm pt-1">{row.text}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-border/60 bg-card p-4">
              <p className="text-sm font-semibold mb-2">Built for</p>
              <ul className="text-xs text-muted-foreground grid sm:grid-cols-2 gap-x-4 gap-y-1.5">
                <li>• <span className="text-foreground font-medium">Property managers</span> — turnovers</li>
                <li>• <span className="text-foreground font-medium">Realtors</span> — staging, open houses</li>
                <li>• <span className="text-foreground font-medium">Event venues</span> — setup &amp; breakdown</li>
                <li>• <span className="text-foreground font-medium">Offices &amp; retail</span> — recurring cleans</li>
                <li>• <span className="text-foreground font-medium">Restaurants</span> — deep cleans, overflow</li>
                <li>• <span className="text-foreground font-medium">Airbnb hosts</span> — same-day turnovers</li>
              </ul>
            </div>
          </div>

          {/* Self-serve CTA — 2 cols */}
          <div className="lg:col-span-2 rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-5 lg:p-6">
            <div className="text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                <Building2 className="w-6 h-6" />
              </div>
              <h2 className="text-xl font-display font-bold mb-1.5">Get started in minutes</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Sign up, invite your team, start posting jobs. No sales calls.
              </p>

              <Button
                size="lg"
                className="w-full mb-2"
                onClick={() => navigate("/signup?type=business")}
              >
                Sign up as a business
              </Button>

              <p className="text-xs text-muted-foreground">
                Already have an account?{" "}
                <Link to="/login" className="text-primary hover:underline">Log in</Link>
              </p>
            </div>

            <div className="mt-5 pt-4 border-t border-border/60">
              <p className="text-sm font-semibold mb-2">Team seats</p>
              <div className="grid grid-cols-2 gap-1.5">
                <div className="flex items-center justify-between text-xs rounded-md border border-border/50 bg-background/50 px-2.5 py-1.5">
                  <span className="font-medium">Starter</span>
                  <span className="text-muted-foreground">2 · <span className="text-foreground font-semibold">Free</span></span>
                </div>
                <div className="flex items-center justify-between text-xs rounded-md border border-border/50 bg-background/50 px-2.5 py-1.5">
                  <span className="font-medium">Crew</span>
                  <span className="text-muted-foreground">5 · <span className="text-foreground font-semibold">$10</span></span>
                </div>
                <div className="flex items-center justify-between text-xs rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5">
                  <span className="font-medium">Team</span>
                  <span className="text-muted-foreground">10 · <span className="text-foreground font-semibold">$20</span></span>
                </div>
                <div className="flex items-center justify-between text-xs rounded-md border border-border/50 bg-background/50 px-2.5 py-1.5">
                  <span className="font-medium">Enterprise</span>
                  <span className="text-muted-foreground">25 · <span className="text-foreground font-semibold">$40</span></span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-2.5 leading-relaxed">
                Owner's card is charged per job at checkout — no monthly fees on Starter. All members can post, message, and manage jobs.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForBusiness;
