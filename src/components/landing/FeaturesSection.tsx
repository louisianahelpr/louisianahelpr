import { forwardRef } from "react";
import { Shield, CreditCard, Star, CalendarDays, Bell, MapPin } from "lucide-react";

const features = [
  { icon: Shield, title: "Vetted helprs", desc: "Every helpr verifies their identity through Stripe before they can apply. No anonymous accounts." },
  { icon: CreditCard, title: "Escrow payments", desc: "Your payment is held safely until you confirm the job is done right. No upfront risk." },
  { icon: Star, title: "Honest reviews", desc: "Reviews unlock only after payment releases — so ratings reflect real, finished work." },
  { icon: CalendarDays, title: "Flexible scheduling", desc: "Lock in a date or stay flexible. Helprs confirm before they show up." },
  { icon: Bell, title: "Live job updates", desc: "Know exactly when your helpr applies, accepts, is on the way, and finishes." },
  { icon: MapPin, title: "Louisiana-local", desc: "We match you with helprs in your area first. Support neighbors, not strangers." },
];

const FeaturesSection = forwardRef<HTMLElement>((_props, ref) => {
  return (
    <section id="features" className="py-10 md:py-14 scroll-mt-24" ref={ref}>
      <div className="container mx-auto text-center px-4">
        <h2 className="text-3xl sm:text-4xl font-display font-bold text-foreground mb-4">
          Why people trust Helpr
        </h2>
        <p className="text-muted-foreground max-w-md mx-auto mb-10">
          Six reasons Louisiana neighbors choose us over Craigslist, Facebook, and the national apps.
        </p>
      </div>

      {/* Horizontal scroll rail — full-bleed so cards aren't clipped, with edge fades */}
      <div className="relative">
        <div className="overflow-x-auto overflow-y-visible scrollbar-hide overscroll-x-contain">
          <div className="flex gap-5 px-4 sm:px-8 pb-4 pt-2 snap-x snap-mandatory">
            {features.map((f, i) => (
              <div
                key={f.title}
                className="snap-start shrink-0 w-[80vw] sm:w-[320px] text-left p-6 rounded-2xl bg-card border border-border shadow-[var(--shadow-card-soft)] hover:shadow-[var(--shadow-elevated)] transition-shadow animate-fade-in opacity-0"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                  <f.icon className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-1">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
            {/* Right-edge spacer so the last card scrolls fully into view */}
            <div className="shrink-0 w-4 sm:w-8" aria-hidden />
          </div>
        </div>

        {/* Edge fade gradients — hint at scrollability */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-background to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent"
        />
      </div>
    </section>
  );
});
FeaturesSection.displayName = "FeaturesSection";

export default FeaturesSection;
