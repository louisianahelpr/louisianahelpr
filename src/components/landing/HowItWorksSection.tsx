import {
  ClipboardList,
  Users,
  CheckCircle,
  Lock,
  Shield,
  Check,
} from "lucide-react";

const steps = [
  {
    icon: ClipboardList,
    title: "Post the job",
    description:
      "Tell us what you need, set your budget, and pick a date. Takes about a minute — no wizard, no friction.",
    accent: "Step 01",
  },
  {
    icon: Users,
    title: "Pick your helpr",
    description:
      "Local applicants come to you. Compare profiles, ratings, and verifications — choose with confidence.",
    accent: "Step 02",
  },
  {
    icon: CheckCircle,
    title: "Pay when it's done",
    description:
      "Funds sit in escrow until you confirm the work. No upfront risk, no awkward cash handoffs.",
    accent: "Step 03",
  },
];

const trustFacts = [
  { icon: Lock, label: "Escrow-protected payment" },
  { icon: Shield, label: "Verified helprs" },
  { icon: Check, label: "Free to post" },
];

const HowItWorksSection = () => (
  <section
    id="how-it-works"
    className="py-6 sm:py-10 lg:py-14 px-4 sm:px-6 lg:px-8 scroll-mt-24"
  >
    <div className="container mx-auto max-w-6xl">
      {/* Eyebrow + headline live OUTSIDE the glass — same pattern as the FAQ,
          so the title acts as a section ribbon and the box below is
          read as the answer. */}
      <div className="max-w-2xl mb-6 sm:mb-8 px-2 sm:px-4">
        <span className="text-display-eyebrow mb-4">How it works</span>
        <h2 className="text-display-xl mt-4 text-balance">
          Three steps. Zero surprises.
        </h2>
        <p className="subhead-serif text-foreground text-ds-20 sm:text-ds-24 mt-5 leading-snug text-balance">
          Every Helpr job follows the same calm rhythm — post, pick, pay. No
          back-and-forth, no awkward cash handoffs, no guesswork.
        </p>
      </div>

      {/* Liquid-glass container — gives the steps a defined surface that
          reads as one continuous "this is how it works" panel rather than
          three orphaned cards floating on the champagne canvas. */}
      <div className="liquid-glass px-5 sm:px-8 lg:px-10 py-7 sm:py-9 lg:py-10">

        {/* Three transparent step cards — faint white hairline + content,
            mesh gradient bleeds through. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          {steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <article
                key={step.title}
                className="observe-fade-up p-6 sm:p-7 flex flex-col justify-between gap-5 min-h-[14rem] sm:min-h-[16rem] rounded-[2rem]"
                style={{
                  transitionDelay: `${i * 100}ms`,
                  border: "1px solid rgba(255, 255, 255, 0.18)",
                }}
              >
                <div className="flex items-start justify-between">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                    <Icon className="w-6 h-6 text-primary" strokeWidth={1.25} />
                  </div>
                  <span className="text-display-eyebrow">{step.accent}</span>
                </div>
                <div className="space-y-2">
                  <h3 className="text-ds-20 sm:text-ds-24 font-display font-semibold text-foreground tracking-tight leading-tight">
                    {step.title}
                  </h3>
                  <p className="font-sans text-foreground text-ds-13 sm:text-ds-15 leading-relaxed">
                    {step.description}
                  </p>
                </div>
              </article>
            );
          })}
        </div>

        {/* Trust strip — sits below the step cards. We're inside a glass
            container now, so we use a hairline rule + transparent row
            instead of a nested glass-in-glass which read as visually noisy. */}
        <div
          className="mt-8 sm:mt-10 pt-6 sm:pt-7"
          style={{ borderTop: "1px solid hsl(var(--olivewood) / 0.1)" }}
        >
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6">
            {trustFacts.map((fact, i) => {
              const Icon = fact.icon;
              return (
                <div
                  key={fact.label}
                  className="flex items-center gap-3 observe-fade-up"
                  style={{ transitionDelay: `${i * 100}ms` }}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon
                      className="w-4 h-4 shrink-0"
                      style={{ color: "hsl(var(--sage))" }}
                      strokeWidth={1.5}
                    />
                    <span
                      className="text-ds-11 sm:text-ds-13 font-sans font-medium tracking-tight"
                      style={{ color: "hsl(var(--olivewood))" }}
                    >
                      {fact.label}
                    </span>
                  </div>
                  {i < trustFacts.length - 1 && (
                    <span
                      className="hidden sm:block w-1 h-1 rounded-full"
                      style={{
                        backgroundColor: "hsl(var(--burnt-sienna) / 0.5)",
                      }}
                      aria-hidden
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  </section>
);

export default HowItWorksSection;
