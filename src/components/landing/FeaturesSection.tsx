import { forwardRef } from "react";
import { Shield, CreditCard, Star, CalendarDays, Bell, MapPin } from "lucide-react";

const features = [
  { icon: Shield, title: "Vetted helprs", desc: "Every helpr verifies their identity through Stripe before they can apply. No anonymous accounts." },
  { icon: CreditCard, title: "Escrow payments", desc: "Your payment is held safely until you confirm the job is done right. No upfront risk." },
  { icon: Star, title: "Honest reviews", desc: "Reviews unlock only after payment releases — so ratings reflect real, finished work." },
  { icon: CalendarDays, title: "Flexible scheduling", desc: "Lock in a date or stay flexible. Helprs confirm before they show up." },
  { icon: Bell, title: "Live job updates", desc: "Know exactly when your helpr applies, accepts, is on the way, and finishes." },
  { icon: MapPin, title: "Parish-local", desc: "We match you with helprs in your parish first. Support neighbors, not strangers." },
];

const FeaturesSection = forwardRef<HTMLElement>((_props, ref) => {
  return (
    <section id="features" className="py-24 px-4" ref={ref}>
      <div className="container mx-auto text-center">
        <h2 className="text-3xl sm:text-4xl font-display font-bold text-foreground mb-4">
          Why people trust Helpr
        </h2>
        <p className="text-muted-foreground max-w-md mx-auto mb-16">
          Six reasons Louisiana neighbors choose us over Craigslist, Facebook, and the national apps.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {features.map((f, i) => (
            <div
              key={f.title}
              className="text-left p-6 rounded-xl bg-card border border-border hover:shadow-md transition-shadow animate-fade-in opacity-0"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                <f.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-1">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
});
FeaturesSection.displayName = "FeaturesSection";

export default FeaturesSection;
