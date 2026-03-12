import { Shield, CreditCard, Star, CalendarDays, Bell, MapPin } from "lucide-react";

const features = [
  { icon: Shield, title: "Trusted community", desc: "Every user has a profile with reviews, ratings, and verified identity." },
  { icon: CreditCard, title: "Secure payments", desc: "Pay through the platform. Funds are held until the job is done." },
  { icon: Star, title: "Reviews & ratings", desc: "Leave honest feedback after every job to help the community." },
  { icon: CalendarDays, title: "Easy scheduling", desc: "Pick the date and time that works. Helpers confirm availability." },
  { icon: Bell, title: "Real-time updates", desc: "Get notified when someone applies, when work starts, and when it's done." },
  { icon: MapPin, title: "Louisiana local", desc: "Find helprs in your parish and neighborhood. Support your local Louisiana community." },
];

const FeaturesSection = () => {
  return (
    <section id="features" className="py-24 px-4">
      <div className="container mx-auto text-center">
        <h2 className="text-3xl sm:text-4xl font-display font-bold text-foreground mb-4">
          Built for trust & simplicity
        </h2>
        <p className="text-muted-foreground max-w-md mx-auto mb-16">
          Everything you need for a great experience, nothing you don't.
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
};

export default FeaturesSection;
