import { ClipboardList, Users, CheckCircle } from "lucide-react";

const steps = [
  {
    icon: ClipboardList,
    title: "Post your task",
    description: "Describe what you need help with, set your budget, and choose a date.",
  },
  {
    icon: Users,
    title: "Get matched",
    description: "Trusted locals apply to your task. Review profiles, ratings, and pick the best fit.",
  },
  {
    icon: CheckCircle,
    title: "Get it done",
    description: "Your chosen helpr completes the job, you pay securely, and leave a review.",
  },
];

const HowItWorksSection = () => {
  return (
    <section id="how-it-works" className="py-24 px-4 bg-secondary/50">
      <div className="container mx-auto text-center">
        <h2 className="text-3xl sm:text-4xl font-display font-bold text-foreground mb-4">
          How Helpr works
        </h2>
        <p className="text-muted-foreground max-w-md mx-auto mb-16">
          Three simple steps to get help with any task.
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
