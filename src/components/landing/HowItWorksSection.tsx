/**
 * How It Works — editorial magazine layout. Title lives in the left
 * column as a masthead; the three numbered steps flow across the right.
 * No cards, no glass panel, no icons — giant Bodoni numerals anchor
 * each step. Sits directly on parchment to match the hero's editorial
 * poster feel. Positive-framing copy — no "no upfront risk".
 */
const STEPS = [
  {
    title: "Post the job",
    desc: "Tell us what you need, set your budget, pick a date. Takes about a minute.",
  },
  {
    title: "Pick your Helpr",
    desc: "Local applicants come to you. Compare profiles, ratings, and reviews.",
  },
  {
    title: "Pay when it's done",
    desc: "Funds sit safe in escrow until you confirm the work is done.",
  },
];

const HowItWorksSection = () => (
  <section
    id="how-it-works"
    className="px-5 sm:px-8 lg:px-12 pt-12 sm:pt-16 lg:pt-24 pb-16 sm:pb-24 lg:pb-32 scroll-mt-24"
  >
    <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-10 lg:gap-16 md:items-center">
      {/* Left column — masthead. Title stacks vertically, left-aligned
          at desktop, centered at mobile. Reads as the "kicker" of the
          feature spread. */}
      <div className="md:col-span-4 lg:col-span-3 text-center md:text-left">
        <span className="text-display-eyebrow">How it works</span>
        <h2
          className="mt-3 font-display font-bold text-balance leading-[1.05] max-w-[10ch] md:max-w-none mx-auto md:mx-0"
          style={{
            fontSize: "clamp(2.25rem, 3.4vw, 3.25rem)",
            letterSpacing: "-0.025em",
            color: "hsl(var(--ink-deep))",
          }}
        >
          Three steps.
        </h2>
      </div>

      {/* Right column — 3 steps flow across. At mobile they stack; at
          md+ they're a 3-column subgrid to the right of the masthead. */}
      <div className="md:col-span-8 lg:col-span-9 grid grid-cols-1 sm:grid-cols-3 gap-10 sm:gap-8 lg:gap-10">
        {STEPS.map((step, i) => (
          <div key={step.title} className="text-center md:text-left">
            {/* Giant Bodoni numeral — the visual anchor. */}
            <span
              aria-hidden
              className="block font-display font-black leading-none"
              style={{
                fontSize: "clamp(4rem, 6.5vw, 6rem)",
                color: "hsl(var(--burnt-sienna) / 0.35)",
                letterSpacing: "-0.04em",
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3
              className="mt-4 font-display font-bold text-ds-20 sm:text-ds-24 lg:text-ds-28 tracking-tight leading-tight"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              {step.title}
            </h3>
            <p
              className="mt-3 font-sans text-ds-13 sm:text-ds-15 lg:text-ds-17 leading-relaxed max-w-xs mx-auto md:mx-0"
              style={{ color: "hsl(var(--olivewood) / 0.85)" }}
            >
              {step.desc}
            </p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default HowItWorksSection;
