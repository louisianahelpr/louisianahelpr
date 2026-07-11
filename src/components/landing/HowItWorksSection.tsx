import { ClipboardList, Users, CheckCircle } from "lucide-react";

/**
 * How It Works — 3 inline text steps (Post → Pick → Pay). Rebuilt from
 * scratch as part of the minimal landing rewrite: no cards, no toggle, no
 * liquid-glass panel. Just an eyebrow + H2 header and three column blocks
 * with icon + step number + title + one-line description. Matches the
 * calm, functional grammar of the authed app.
 */
const STEPS = [
  {
    icon: ClipboardList,
    title: "Post the job",
    desc: "Tell us what you need, set your budget, pick a date. Takes about a minute.",
  },
  {
    icon: Users,
    title: "Pick your Helpr",
    desc: "Local applicants come to you. Compare profiles, ratings, and reviews.",
  },
  {
    icon: CheckCircle,
    title: "Pay when it's done",
    desc: "Funds sit in escrow until you confirm the work. No upfront risk.",
  },
];

const HowItWorksSection = () => (
  <section
    id="how-it-works"
    className="px-5 sm:px-8 lg:px-12 pt-6 sm:pt-8 lg:pt-10 pb-16 sm:pb-24 lg:pb-28 scroll-mt-24"
  >
    <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]">
      <div className="text-center mb-8 sm:mb-10">
        <span className="text-display-eyebrow">How it works</span>
        <h2 className="text-display-xl mt-3 text-balance">
          Three steps. Zero surprises.
        </h2>
      </div>
      <div className="rounded-3xl bg-white border border-[hsl(var(--olivewood)/0.12)] px-6 py-10 sm:px-10 sm:py-14 lg:px-14 lg:py-16 grid grid-cols-1 md:grid-cols-3 gap-10 sm:gap-12">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          return (
            <div key={step.title} className="text-center">
              <div
                className="w-14 h-14 mx-auto rounded-full flex items-center justify-center"
                style={{ backgroundColor: "hsl(var(--burnt-sienna) / 0.10)" }}
              >
                <Icon
                  className="w-6 h-6"
                  strokeWidth={1.5}
                  style={{ color: "hsl(var(--burnt-sienna))" }}
                />
              </div>
              <div
                className="mt-4 text-ds-11 font-mono font-semibold uppercase tracking-wider"
                style={{ color: "hsl(var(--burnt-sienna))" }}
              >
                Step {String(i + 1).padStart(2, "0")}
              </div>
              <h3
                className="mt-2 font-display font-bold text-ds-17 sm:text-ds-20 lg:text-ds-24 tracking-tight leading-tight whitespace-nowrap"
                style={{ color: "hsl(var(--ink-deep))" }}
              >
                {step.title}
              </h3>
              <p
                className="mt-3 font-sans text-ds-13 sm:text-ds-15 leading-relaxed max-w-xs mx-auto"
                style={{ color: "hsl(var(--olivewood) / 0.85)" }}
              >
                {step.desc}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  </section>
);

export default HowItWorksSection;
