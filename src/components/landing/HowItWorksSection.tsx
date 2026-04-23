import { ClipboardList, Users, CheckCircle } from "lucide-react";

const steps = [
  {
    icon: ClipboardList,
    title: "Post the job",
    description: "Tell us what you need, set your budget, and pick a date. Takes about a minute.",
  },
  {
    icon: Users,
    title: "Pick your helpr",
    description: "Local applicants come to you. Compare profiles, ratings, and pricing — choose with confidence.",
  },
  {
    icon: CheckCircle,
    title: "Pay when it's done",
    description: "Funds sit in escrow until you confirm the work. No upfront risk, no awkward cash handoffs.",
  },
];

const HowItWorksSection = () => {
  return (
    <section id="how-it-works" className="py-24 px-4 bg-secondary/50 scroll-mt-24">
      <div className="container mx-auto text-center">
        <h2 className="text-3xl sm:text-4xl font-display font-bold text-foreground mb-4">
          How Helpr works
        </h2>
        <p className="text-muted-foreground max-w-md mx-auto mb-16">
          Three steps. No back-and-forth. No surprises.
        </p>

        <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          {steps.map((step, i) => (
            <div
              key={step.title}
              className="flex flex-col items-center text-center p-6 animate-fade-in opacity-0"
              style={{ animationDelay: `${i * 150}ms` }}
            >
              <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center mb-4">
                <step.icon className="w-7 h-7 text-primary" />
              </div>
              <span className="text-xs font-semibold text-primary uppercase tracking-widest mb-2">
                Step {i + 1}
              </span>
              <h3 className="text-xl font-display font-semibold text-foreground mb-2">
                {step.title}
              </h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
