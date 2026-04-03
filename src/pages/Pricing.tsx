import { Link } from "react-router-dom";
import { usePageTitle } from "@/hooks/usePageTitle";
import { Button } from "@/components/ui/button";
import { ArrowLeft, CheckCircle, DollarSign, Shield, Zap, Users, Receipt, HelpCircle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

const Pricing = () => {
  usePageTitle("Pricing — Helpr");
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="container mx-auto max-w-4xl px-4 py-12">
        <div className="space-y-2 mb-12 text-center">
          <h1 className="text-4xl font-display font-bold text-foreground">Simple, Transparent Pricing</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            No subscriptions. No hidden fees. You only pay when you use Helpr.
          </p>
        </div>

        {/* Two-column fee cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-16">
          {/* Poster card */}
          <div className="rounded-2xl border border-border bg-card p-8 space-y-6">
            <div className="space-y-2">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Users className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-2xl font-display font-bold text-foreground">For Job Posters</h2>
              <p className="text-muted-foreground text-sm">Post a job, pick your helpr, pay when it's done.</p>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-5xl font-display font-bold text-foreground">10%</span>
              <span className="text-muted-foreground text-sm">service fee</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Added to your job budget at checkout. On a $100 job, you pay $110 + applicable sales tax.
            </p>
            <div className="border-t border-border pt-4 space-y-3">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Included:</p>
              <div className="space-y-2">
                {[
                  "Secure escrow — money held until job is complete",
                  "Vetted helprs with ID verification",
                  "GPS-verified arrivals on jobs ≥$50",
                  "Photo proof before & after",
                  "Dispute resolution & automatic refunds",
                  "Sales tax calculated & remitted for you",
                  "Real-time messaging & notifications",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Helper card */}
          <div className="rounded-2xl border border-border bg-card p-8 space-y-6">
            <div className="space-y-2">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Zap className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-2xl font-display font-bold text-foreground">For Helprs</h2>
              <p className="text-muted-foreground text-sm">Browse jobs, apply, get paid directly to your bank.</p>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-5xl font-display font-bold text-foreground">10%</span>
              <span className="text-muted-foreground text-sm">commission</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Deducted from your payout when the job is complete. On a $100 job, you take home $90.
            </p>
            <div className="border-t border-border pt-4 space-y-3">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider">Included:</p>
              <div className="space-y-2">
                {[
                  "Guaranteed payment via escrow",
                  "Direct bank deposits via Stripe",
                  "No chasing invoices or clients",
                  "Late cancellation fee protection",
                  "Profile & portfolio to showcase work",
                  "Job matching & instant notifications",
                  "24/7 platform support",
                ].map((item) => (
                  <div key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <CheckCircle className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Fee breakdown example */}
        <div className="rounded-2xl border border-border bg-card p-8 mb-16">
          <h2 className="text-xl font-display font-bold text-foreground mb-6 flex items-center gap-3">
            <Receipt className="w-5 h-5 text-primary" />
            How a $100 Job Breaks Down
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="rounded-xl bg-muted/40 border border-border/50 p-5 text-center space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Poster Pays</p>
              <p className="text-3xl font-display font-bold text-foreground">$110</p>
              <p className="text-xs text-muted-foreground">$100 budget + $10 service fee<br />+ sales tax (varies by parish)</p>
            </div>
            <div className="rounded-xl bg-muted/40 border border-border/50 p-5 text-center space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Helpr Receives</p>
              <p className="text-3xl font-display font-bold text-foreground">$90</p>
              <p className="text-xs text-muted-foreground">$100 budget − $10 commission<br />deposited directly to bank</p>
            </div>
            <div className="rounded-xl bg-primary/5 border border-primary/10 p-5 text-center space-y-2">
              <p className="text-xs font-semibold text-primary uppercase tracking-wider">Platform Keeps</p>
              <p className="text-3xl font-display font-bold text-foreground">$20</p>
              <p className="text-xs text-muted-foreground">Covers Stripe fees, escrow,<br />fraud prevention, tax compliance</p>
            </div>
          </div>
        </div>

        {/* What your fees cover */}
        <div className="rounded-2xl border border-border bg-card p-8 mb-16">
          <h2 className="text-xl font-display font-bold text-foreground mb-6 flex items-center gap-3">
            <Shield className="w-5 h-5 text-primary" />
            What Your Fees Actually Pay For
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            {[
              {
                title: "Payment Processing (~3%)",
                desc: "Stripe charges 2.9% + $0.30 per transaction. We absorb this — you never see extra processing fees.",
                icon: DollarSign,
              },
              {
                title: "Escrow & Payout System",
                desc: "Your money is held securely until the job is confirmed complete. Automatic payouts to helprs' bank accounts.",
                icon: Shield,
              },
              {
                title: "Fraud Prevention & Safety",
                desc: "ID verification, GPS check-ins, photo proof requirements, off-platform contact detection, and rate limiting.",
                icon: Shield,
              },
              {
                title: "Dispute Resolution",
                desc: "3-step escalation (Revision → Dispute → Admin review) with 72-hour resolution windows and automatic refunds.",
                icon: Users,
              },
              {
                title: "Tax Compliance",
                desc: "Parish-level Louisiana sales tax calculation, collection, and remittance. 1099 reporting for helprs.",
                icon: Receipt,
              },
              {
                title: "Platform & Support",
                desc: "24/7 infrastructure, real-time notifications, in-app messaging, and customer support.",
                icon: Zap,
              },
            ].map((item) => (
              <div key={item.title} className="flex items-start gap-3 p-4 rounded-xl bg-muted/30 border border-border/50">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <item.icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="rounded-2xl border border-border bg-card p-8 mb-12">
          <h2 className="text-xl font-display font-bold text-foreground mb-6 flex items-center gap-3">
            <HelpCircle className="w-5 h-5 text-primary" />
            Frequently Asked Questions
          </h2>
          <div className="space-y-5">
            {[
              {
                q: "Are there any subscription fees or monthly charges?",
                a: "No. Helpr is completely free to join. You only pay fees when a job is posted and completed.",
              },
              {
                q: "Can fees change after I post a job?",
                a: "No. The fee percentage at the time you post is locked in. We never apply retroactive fee changes to existing jobs.",
              },
              {
                q: "Who pays the sales tax?",
                a: "The job poster pays applicable Louisiana sales tax, which varies by parish. Helpr calculates, collects, and remits it automatically.",
              },
              {
                q: "What happens if a job is cancelled?",
                a: "If cancelled 24+ hours before the job, there's no fee. Within 24 hours, a 25% cancellation fee applies. Within 2 hours, it's 50%. The fee compensates the helpr for their reserved time.",
              },
              {
                q: "How do helprs get paid?",
                a: "Helprs connect their bank account through Stripe. Once a job is confirmed complete, payment is deposited directly — usually within 1-2 business days.",
              },
              {
                q: "What if there's a dispute?",
                a: "Helpr uses a 3-step escalation: Revision → Dispute → Admin Review. Each step has a 72-hour resolution window. If a dispute is resolved in the poster's favor, a full refund is issued.",
              },
            ].map((item) => (
              <div key={item.q} className="space-y-1">
                <p className="text-sm font-semibold text-foreground">{item.q}</p>
                <p className="text-sm text-muted-foreground">{item.a}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="text-center space-y-4">
          <Button onClick={() => navigate("/signup")} size="lg" className="rounded-xl px-8">
            Get Started — It's Free
          </Button>
          <p className="text-xs text-muted-foreground">
            See our <Link to="/rules" className="text-primary hover:underline">Platform Rules</Link> and{" "}
            <Link to="/terms" className="text-primary hover:underline">Terms of Service</Link> for full details.
          </p>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default Pricing;
