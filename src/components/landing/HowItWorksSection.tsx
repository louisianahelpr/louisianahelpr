import { useState } from "react";
import {
  ClipboardList,
  Users,
  CheckCircle,
  UserPlus,
  Search,
  Banknote,
  ArrowRight,
} from "lucide-react";

// Two perspectives on the same flow. The standalone /how-it-works page was
// folded into this section — a poster/Helpr toggle lets a visitor see both
// sides without a separate page (see App.tsx: /how-it-works → /#how-it-works).
const POSTER_STEPS = [
  {
    icon: ClipboardList,
    title: "Post the job",
    metric: "1 min",
    description:
      "Tell us what you need, set your budget, and pick a date. Takes about a minute — no wizard, no friction.",
  },
  {
    icon: Users,
    title: "Pick your Helpr",
    metric: "Same hour",
    description:
      "Local applicants come to you. Compare profiles, ratings, and reviews — choose with confidence.",
  },
  {
    icon: CheckCircle,
    title: "Pay when it's done",
    metric: "Escrow-safe",
    description:
      "Funds sit in escrow until you confirm the work. No upfront risk, no awkward cash handoffs.",
  },
];

const HELPR_STEPS = [
  {
    icon: UserPlus,
    title: "Build your profile",
    metric: "2 min",
    description:
      "Add your skills and service area — takes two minutes. A quick ID check on your first application keeps the platform safe.",
  },
  {
    icon: Search,
    title: "Apply to jobs nearby",
    metric: "One tap",
    description:
      "Browse open jobs in your parish and apply in a tap. Most posters review applicants within the first hour.",
  },
  {
    icon: Banknote,
    title: "Get paid same day",
    metric: "Same day",
    description:
      "Payment releases when the poster confirms you're done, and funds hit your account the same day.",
  },
];

const MODES = {
  poster: { steps: POSTER_STEPS, label: "I need a job done" },
  helpr: { steps: HELPR_STEPS, label: "I want to earn" },
} as const;

type Mode = keyof typeof MODES;

const HowItWorksSection = () => {
  const [mode, setMode] = useState<Mode>("poster");
  const steps = MODES[mode].steps;

  return (
    <section
      id="how-it-works"
      className="pt-14 pb-20 sm:pt-20 sm:pb-28 lg:pt-24 lg:pb-32 px-5 sm:px-8 lg:px-12 scroll-mt-24"
    >
      <div className="container mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]">
        {/* Eyebrow + headline live OUTSIDE the glass — same pattern as the FAQ,
            so the title acts as a section ribbon and the box below is
            read as the answer. */}
        <div className="max-w-2xl mx-auto mb-10 sm:mb-12 px-2 sm:px-4 text-center">
          <span className="text-display-eyebrow mb-4">How it works</span>
          <h2 className="text-display-xl mt-4 text-balance">
            Three steps. Zero surprises.
          </h2>
          <p className="subhead-serif text-foreground text-ds-20 sm:text-ds-24 mt-5 leading-snug text-balance">
            One account, both sides. Post a job or earn as a Helpr — same calm
            rhythm, nothing to switch.
          </p>
        </div>

        {/* Poster / Helpr toggle — a full-width segmented pill so its edges
            line up with the liquid-glass step panel below. Two equal halves
            (flex-1 on each button) so neither label crowds the other. */}
        <div className="mb-8 sm:mb-10">
          <div
            role="tablist"
            aria-label="See how it works for posters or Helprs"
            className="flex w-full items-center gap-1 rounded-full p-1"
            style={{
              background: "hsl(var(--olivewood) / 0.08)",
              border: "1px solid hsl(var(--olivewood) / 0.14)",
            }}
          >
            {(Object.keys(MODES) as Mode[]).map((key) => {
              const active = mode === key;
              return (
                <button
                  key={key}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  aria-controls="how-it-works-steps"
                  onClick={() => setMode(key)}
                  className="flex-1 whitespace-nowrap rounded-full px-4 sm:px-5 py-2.5 text-ds-13 sm:text-ds-15 font-sans font-semibold transition-all duration-300"
                  style={
                    active
                      ? {
                          background:
                            "linear-gradient(160deg, hsl(var(--burnt-sienna)) 0%, hsl(var(--bark) / 0.85) 100%)",
                          color: "hsl(var(--parchment))",
                          boxShadow: "0 2px 8px hsl(var(--bark) / 0.22)",
                        }
                      : { color: "hsl(var(--olivewood))" }
                  }
                >
                  {MODES[key].label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Liquid-glass container — gives the steps a defined surface that
            reads as one continuous "this is how it works" panel rather than
            three orphaned cards floating on the champagne canvas. */}
        <div className="liquid-glass px-6 sm:px-10 lg:px-12 py-10 sm:py-14 lg:py-16">
          {/* Three transparent step cards — faint white hairline + content,
              mesh gradient bleeds through. `key={mode}` re-triggers the
              observe-fade-up reveal when the perspective switches. */}
          <div
            id="how-it-works-steps"
            key={mode}
            className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8"
          >
            {steps.map((step, i) => {
              return (
                <article
                  key={step.title}
                  className="observe-fade-up relative p-7 sm:p-8 flex flex-col justify-between gap-7 min-h-[13rem] sm:min-h-[18rem] rounded-[2rem]"
                  style={{
                    transitionDelay: `${i * 100}ms`,
                    border: "1px solid rgba(255, 255, 255, 0.18)",
                  }}
                >
                  <div className="flex items-start justify-between">
                    {/* Step number badge — the affordance icon lived to the
                        right of the number but competed with it and made the
                        card top-row read as two badges; the number alone is
                        a cleaner lead-in to the step title. */}
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center font-mono font-bold text-ds-13"
                      style={{
                        backgroundColor: "hsl(var(--burnt-sienna) / 0.12)",
                        color: "hsl(var(--burnt-sienna))",
                      }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    {/* Metric mini-label — closes the top row that felt
                        top-heavy after the affordance icon came out, reading
                        as a metadata footnote paired with the step number
                        ("01 · 1 min") rather than a second badge. */}
                    <span
                      className="text-ds-11 font-mono font-medium tracking-wide uppercase"
                      style={{ color: "hsl(var(--olivewood) / 0.55)" }}
                    >
                      {step.metric}
                    </span>
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-ds-20 sm:text-ds-24 font-display font-semibold text-foreground tracking-tight leading-tight">
                      {step.title}
                    </h3>
                    <p className="font-sans text-foreground text-ds-13 sm:text-ds-15 leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                  {/* Arrow connector — visible only on md+ between steps */}
                  {i < steps.length - 1 && (
                    <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 z-10">
                      <ArrowRight
                        className="w-5 h-5"
                        style={{ color: "hsl(var(--sage) / 0.5)" }}
                        strokeWidth={1.5}
                      />
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
