import { Link } from "react-router-dom";
import { Shield, Heart, MapPin, DollarSign, Users, Sun } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/usePageMeta";

const CommunityValues = () => {
  usePageMeta({
    title: "Built for Louisiana — Helpr Community Values",
    description:
      "Helpr is a neighbor-to-neighbor marketplace built on three values: empathy, local pride, and safety. Serving Vermilion, Iberia, Lafayette, and parishes across Louisiana.",
    canonical: "https://www.louisianahelpr.com/community-values",
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero */}
      <section className="px-4 pt-12 pb-10 sm:pt-20 sm:pb-16">
        <div className="container mx-auto max-w-3xl text-center">
          <p className="text-sm font-medium text-primary tracking-wide uppercase mb-4">
            Built for Louisiana
          </p>
          <h1 className="text-4xl sm:text-5xl font-display font-bold text-foreground mb-6 leading-tight">
            Neighbors helping neighbors — that's the whole idea.
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Helpr isn't a Silicon Valley app dropped into the bayou. It was built for the heat,
            the afternoon thunderstorms, and the back-to-school rush. For the folks in Erath,
            Abbeville, New Iberia, Lafayette, and every town in between who'd rather spend
            Saturday with family than behind a lawn mower.
          </p>
        </div>
      </section>

      {/* The 3 Values */}
      <section className="px-4 pb-12 sm:pb-16">
        <div className="container mx-auto max-w-5xl">
          <div className="grid md:grid-cols-3 gap-6">
            <Card className="border-2 border-border/60 hover:border-primary/40 transition-colors">
              <CardContent className="p-6 space-y-3">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Heart className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-xl font-display font-semibold">Empathy First</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  We start with the problem — the heat index hitting 105°, the long shift at the
                  hospital, the in-laws coming Sunday. Then we make it easier.
                </p>
              </CardContent>
            </Card>

            <Card className="border-2 border-border/60 hover:border-primary/40 transition-colors">
              <CardContent className="p-6 space-y-3">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <MapPin className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-xl font-display font-semibold">Shared Local Pride</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Every helper is your neighbor — from the bypass in Abbeville to downtown Erath.
                  Local money, local hands, local trust.
                </p>
              </CardContent>
            </Card>

            <Card className="border-2 border-border/60 hover:border-primary/40 transition-colors">
              <CardContent className="p-6 space-y-3">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Shield className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-xl font-display font-semibold">Safety, Always</h2>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Every helper passes a Stripe Identity check and is reviewed by the Helpr Trust &
                  Safety Team before they ever see a job. Your home, your call.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* The Safety Shield */}
      <section className="px-4 py-12 sm:py-16 bg-muted/30">
        <div className="container mx-auto max-w-3xl">
          <div className="flex items-center gap-3 mb-6">
            <Shield className="w-6 h-6 text-primary" />
            <h2 className="text-2xl sm:text-3xl font-display font-bold">The Safety Shield</h2>
          </div>
          <div className="space-y-4 text-muted-foreground leading-relaxed">
            <p>
              Connection is built on trust. Since you don't know us personally, you deserve to
              know exactly how the process works.
            </p>
            <ul className="space-y-3 pl-1">
              <li className="flex gap-3">
                <span className="text-primary mt-1">•</span>
                <span>
                  <strong className="text-foreground">Stripe Identity verification.</strong>{" "}
                  Every helper uploads a government-issued ID and a live selfie. Helpr staff
                  never see the document — we only receive a "Verified" or "Denied" status.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-primary mt-1">•</span>
                <span>
                  <strong className="text-foreground">Manual profile review.</strong> The Helpr
                  Trust & Safety Team reviews every single helper application before they're
                  cleared to apply for jobs.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-primary mt-1">•</span>
                <span>
                  <strong className="text-foreground">Funds held in escrow.</strong> Your money
                  sits safely in Stripe escrow until you confirm the job is done right. No
                  upfront risk.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="text-primary mt-1">•</span>
                <span>
                  <strong className="text-foreground">Private messaging.</strong> Phone numbers
                  stay hidden. Every conversation is on the record.
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* No Hidden Fees */}
      <section className="px-4 py-12 sm:py-16">
        <div className="container mx-auto max-w-3xl">
          <div className="flex items-center gap-3 mb-6">
            <DollarSign className="w-6 h-6 text-primary" />
            <h2 className="text-2xl sm:text-3xl font-display font-bold">The No-Hidden-Fees Promise</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed mb-4">
            We believe in plain-English pricing. Here's the whole story, no fine print:
          </p>
          <div className="rounded-lg border bg-card p-5 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Posters pay a</span>
              <span className="font-semibold">10% service fee</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Helpers keep</span>
              <span className="font-semibold">90% of the job</span>
            </div>
            <div className="flex justify-between border-t pt-2">
              <span className="text-muted-foreground">Louisiana sales tax</span>
              <span className="font-semibold">Calculated by parish</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            That's it. No subscriptions required. No surprise charges. The price you see at
            checkout is the price you pay.
          </p>
        </div>
      </section>

      {/* Built for Louisiana realities */}
      <section className="px-4 py-12 sm:py-16 bg-muted/30">
        <div className="container mx-auto max-w-3xl">
          <div className="flex items-center gap-3 mb-6">
            <Sun className="w-6 h-6 text-primary" />
            <h2 className="text-2xl sm:text-3xl font-display font-bold">Built for Louisiana Life</h2>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            With this heat index, nobody should be pulling weeds. With school starting back, no
            parent should be juggling carpool and a broken dryer. Helpr exists so the small
            stuff gets handled — by someone right down the road — and you get your time back.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 py-16 text-center">
        <div className="container mx-auto max-w-2xl">
          <Users className="w-10 h-10 text-primary mx-auto mb-4" />
          <h2 className="text-3xl font-display font-bold mb-4">Join your neighbors.</h2>
          <p className="text-muted-foreground mb-6">
            Post a task in minutes or sign up to help out across Acadiana.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button asChild size="lg">
              <Link to="/signup">Get Started</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/rules">See How It Works</Link>
            </Button>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default CommunityValues;
