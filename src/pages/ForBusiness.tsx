import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Building2, CheckCircle2, ShieldCheck, Sparkles, Users, CreditCard } from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";

const ForBusiness = () => {
  const navigate = useNavigate();
  usePageTitle("Helpr for Business — Louisiana Commercial Services");

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto px-5 py-6 max-w-5xl">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to Helpr
        </Link>

        <div className="grid lg:grid-cols-2 gap-12 items-start">
          {/* Pitch */}
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
              <Building2 className="w-3.5 h-3.5" /> For Business
            </div>
            <h1 className="text-4xl sm:text-5xl font-display font-bold leading-tight">
              ID-verified Louisiana help, on demand for your business.
            </h1>
            <p className="text-lg text-muted-foreground">
              Property managers, realtors, small business owners, and commercial cleaners — give your team
              shared access to vetted local helprs without the agency markup.
            </p>

            <div className="space-y-3 pt-4">
              {[
                { icon: ShieldCheck, text: "Stripe ID-verified helprs" },
                { icon: Users, text: "Up to 5 team members can post jobs on the company's behalf" },
                { icon: CreditCard, text: "All jobs billed to the owner's card on file — no per-poster invoicing" },
                { icon: Sparkles, text: "Recurring jobs across all 64 parishes" },
                { icon: CheckCircle2, text: "Same flat platform fee as everyone — no contracts, no minimums" },
              ].map((row, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <row.icon className="w-4 h-4" />
                  </div>
                  <p className="text-sm pt-1">{row.text}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-border/60 bg-card p-5 mt-6">
              <p className="text-sm font-semibold mb-1">Who it's for</p>
              <p className="text-sm text-muted-foreground">
                Apartment turnovers · post-event cleanup · realtor staging · small office maintenance ·
                event setup · move-in/out cleans across all 64 parishes.
              </p>
            </div>
          </div>

          {/* Self-serve CTA */}
          <div className="rounded-2xl border border-border/60 bg-card shadow-[var(--card-shadow)] p-6 sm:p-8">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
                <Building2 className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-display font-bold mb-2">Get started in minutes</h2>
              <p className="text-muted-foreground mb-6">
                Sign up as a business, invite your team, and start posting jobs. No sales calls, no waiting.
              </p>

              <Button
                size="lg"
                className="w-full mb-3"
                onClick={() => navigate("/signup?type=business")}
              >
                Sign up as a business
              </Button>

              <p className="text-xs text-muted-foreground">
                Already have an account?{" "}
                <Link to="/login" className="text-primary hover:underline">Log in</Link>
              </p>
            </div>

            <div className="mt-8 pt-6 border-t border-border/60 space-y-4">
              <div>
                <p className="text-sm font-semibold mb-1">How billing works</p>
                <p className="text-xs text-muted-foreground">
                  When any team member posts a job, the owner's saved card is charged at checkout — same
                  per-job pricing, no monthly fees.
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold mb-1">Team size</p>
                <p className="text-xs text-muted-foreground">
                  Free for up to 5 team members (owner counts as 1). Need more? Contact support.
                </p>
              </div>
              <div>
                <p className="text-sm font-semibold mb-1">Permissions</p>
                <p className="text-xs text-muted-foreground">
                  All team members can post, message helprs, and manage jobs on the company's behalf.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForBusiness;

