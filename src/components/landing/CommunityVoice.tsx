import { useState, useEffect } from "react";
import { ONBOARDING_FEE_CENTS, formatDollarsWhole } from "@/lib/moneyLimits";

/**
 * CommunityVoice — combines the testimonial pull quote (left column) with
 * the FAQ accordion (right column) into one cohesive horizontal section,
 * replacing the previous two stacked sections. On mobile they stack
 * vertically as expected.
 *
 * Closes with an inline CTA below the FAQ — gives engaged scrollers a
 * landing point without competing with the hero.
 */

const testimonials = [
  {
    quote: "I typed in what I needed. Three Helprs applied within the hour, and I picked one. That was it.",
    name: "Camille R.",
    location: "Mid-City",
    avatarLabel: "+ 127 happy customers",
  },
  {
    quote: "Made $340 last weekend helping with moves. Easy money — I set my own schedule and Helpr handles the rest.",
    name: "Darius T.",
    location: "Baton Rouge",
    avatarLabel: "+ 84 active Helprs",
  },
  {
    quote: "Our rental turnovers used to take days to schedule. Now I post, pick a Helpr same morning, and it's done.",
    name: "Sandra M.",
    location: "Lafayette",
    avatarLabel: "+ 127 happy customers",
  },
];

const faqs = [
  {
    q: "How do I know my Helpr is trustworthy?",
    a: "Every Helpr verifies their identity through Stripe Identity — a government-ID and photo match — before they can take their first job. You also see their ratings, reviews, and how many jobs they've completed for other Louisiana neighbors — all before you choose.",
  },
  {
    q: "What if the job isn't done right?",
    a: "Payment stays in escrow until you confirm the work, so nothing is released until you're satisfied. If something's off, message your Helpr directly and work it out — most things get sorted with a quick conversation. If you genuinely can't reach a resolution on your own, open a dispute and our team will step in to help.",
  },
  {
    q: "How much does Helpr cost?",
    a: `Posting is free — you only pay when you hire someone. At checkout you'll see the agreed price plus a small service fee, itemized in full before you pay — no subscriptions, no hidden charges. The very first job on a new account also includes a one-time ${formatDollarsWhole(ONBOARDING_FEE_CENTS / 100)} account-setup fee (shown as its own line item); after that it never appears again. Your Helpr keeps the large majority of what you pay (88–94%, depending on their plan), so the person doing the work is paid fairly.`,
  },
  {
    q: "How fast will someone respond?",
    a: "Most jobs get applications within the first hour. Helprs in your parish are notified the moment your job goes live, so you can compare applicants and pick someone the same day.",
  },
];

// Per-avatar text color chosen to hit WCAG AA (4.5:1) against its bg
// — sage / olive are too light for cream text (measured 2.88:1 and
// 1.63:1 respectively, Cowork audit 2026-07-08), so they get ink-deep
// (dark). Burnt-sienna and bark stay dark enough for parchment text.
// Even though the row is aria-hidden decorative, sighted-user readability
// is still a UX concern.
const avatars = [
  { initials: "CR", bg: "hsl(var(--sage))", fg: "hsl(var(--ink-deep))" },
  { initials: "MB", bg: "hsl(var(--burnt-sienna))", fg: "hsl(var(--parchment))" },
  { initials: "TM", bg: "hsl(var(--olive))", fg: "hsl(var(--ink-deep))" },
  { initials: "JD", bg: "hsl(var(--bark))", fg: "hsl(var(--parchment))" },
];

const CommunityVoice = () => {
  const [activeIndex, setActiveIndex] = useState(0);

  // Auto-advance testimonials every 5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % testimonials.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const active = testimonials[activeIndex];

  return (
  <section className="px-5 sm:px-8 lg:px-12 py-16 sm:py-20 lg:py-24">
    <div className="container mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]">
      <div className="grid md:grid-cols-12 gap-10 md:gap-12 lg:gap-16 xl:gap-20 items-center">
        {/* LEFT — testimonial. Pull quote + signature + social-proof avatars.
            Sits in a 5-col track, kept at a readable measure (long editorial
            lines hurt at full width) and centered within its track. */}
        <div className="md:col-span-5 observe-fade-up md:max-w-md md:mx-auto">
          {/* Three-dot ornament */}
          <div className="flex justify-center md:justify-start gap-1.5 mb-6">
            <span
              className="w-1 h-1 rounded-full"
              style={{ backgroundColor: "hsl(var(--burnt-sienna) / 0.5)" }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: "hsl(var(--burnt-sienna) / 0.7)" }}
            />
            <span
              className="w-1 h-1 rounded-full"
              style={{ backgroundColor: "hsl(var(--burnt-sienna) / 0.5)" }}
            />
          </div>

          <blockquote className="editorial-quote text-center md:text-left">
            &ldquo;{active.quote}&rdquo;
          </blockquote>

          {/* Attribution */}
          <div className="mt-8 flex flex-col items-center md:items-start gap-2">
            <span
              className="signature"
              style={{
                color: "hsl(var(--bark))",
                fontSize: "1.75rem",
                lineHeight: 1,
              }}
            >
              {active.name}
            </span>
            <span className="text-display-eyebrow" style={{ fontSize: "0.65rem" }}>
              {active.location}
            </span>
          </div>

          {/* Social-proof avatar row */}
          <div className="mt-8 flex items-center justify-center md:justify-start gap-3">
            <div className="flex -space-x-2">
              {avatars.map((avatar) => (
                <div
                  key={avatar.initials}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-ds-11 font-sans font-semibold"
                  style={{
                    backgroundColor: avatar.bg,
                    color: avatar.fg,
                    border: "2px solid hsl(var(--parchment))",
                  }}
                  aria-hidden
                >
                  {avatar.initials}
                </div>
              ))}
            </div>
            <span
              className="font-serif italic text-ds-13 sm:text-ds-15"
              style={{ color: "hsl(var(--stormy-sky))" }}
            >
              {active.avatarLabel}
            </span>
          </div>

          {/* Dot indicators */}
          <div className="mt-6 flex items-center justify-center md:justify-start gap-2">
            {testimonials.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to testimonial ${i + 1}`}
                onClick={() => setActiveIndex(i)}
                className="w-2 h-2 rounded-full transition-colors duration-300"
                style={{
                  backgroundColor:
                    i === activeIndex
                      ? "hsl(var(--burnt-sienna))"
                      : "hsl(var(--burnt-sienna) / 0.25)",
                }}
              />
            ))}
          </div>
        </div>

        {/* RIGHT — FAQ accordion. Given the wider 7-col track and allowed to
            fill it, so the answers use the horizontal space instead of
            clustering in a narrow column against a big empty margin. */}
        <div className="md:col-span-7 observe-fade-up w-full" style={{ transitionDelay: "150ms" }}>
          <div className="mb-6 lg:mb-8">
            <span className="text-display-eyebrow">Common questions</span>
            <h2
              className="font-display font-bold italic mt-2 text-balance text-ds-20 sm:text-ds-24 lg:text-[1.625rem] tracking-[-0.02em]"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Honest answers, no fine print.
            </h2>
          </div>

          <ul className="liquid-glass faq-list px-6 sm:px-8 py-3">
            {faqs.map((faq, i) => (
              <li
                key={faq.q}
                className="observe-fade-up"
                style={{ transitionDelay: `${250 + i * 60}ms` }}
              >
                <details className="faq-item">
                  <summary>
                    <span
                      className="font-display font-semibold text-ds-15 sm:text-ds-17 tracking-tight"
                      style={{ color: "hsl(var(--olivewood))" }}
                    >
                      {faq.q}
                    </span>
                  </summary>
                  <div className="faq-answer">
                    <p
                      className="font-sans text-ds-13 leading-relaxed max-w-2xl"
                      style={{
                        color: "hsl(var(--olivewood))",
                        opacity: 0.85,
                      }}
                    >
                      {faq.a}
                    </p>
                  </div>
                </details>
              </li>
            ))}
          </ul>

        </div>
      </div>
    </div>
  </section>
  );
};

export default CommunityVoice;
