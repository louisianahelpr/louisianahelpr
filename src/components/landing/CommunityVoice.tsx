import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";

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
    quote: "I typed in what I needed. Three helprs applied within the hour, and I picked one. That was it.",
    name: "Camille R.",
    location: "Mid-City",
    avatarLabel: "+ 127 happy customers",
  },
  {
    quote: "Made $340 last weekend helping with moves. Easy money — I set my own schedule and Helpr handles the rest.",
    name: "Darius T.",
    location: "Baton Rouge",
    avatarLabel: "+ 84 active helprs",
  },
  {
    quote: "Our rental turnovers used to take days to schedule. Now I post, pick a helpr same morning, and it's done.",
    name: "Sandra M.",
    location: "Lafayette",
    avatarLabel: "+ 127 happy customers",
  },
];

const faqs = [
  {
    q: "How do I know my helper is trustworthy?",
    a: "Every helper submits a government-issued ID and is reviewed by our team before being activated. You also see their ratings, reviews, and how many jobs they've completed for other Louisiana neighbors — all before you choose.",
  },
  {
    q: "What if the job isn't done right?",
    a: "Payment is held in escrow until you confirm the work. If something's off, message your helper directly through the app or open a dispute and our team helps settle it — no awkward Venmo standoffs.",
  },
  {
    q: "How much does Helpr cost?",
    a: "Posting a job is free. Helpers receive 88–92% of the agreed price depending on their plan — free accounts pay a 12% platform fee, while Pro and Elite members pay 10% and 8% respectively. Posters pay a small service fee at checkout. No surprise charges.",
  },
  {
    q: "How fast will someone respond?",
    a: "Most jobs get applications within the first hour. Helprs in your parish get a notification the moment your job is live, and you can review applicants the same day.",
  },
];

const avatars = [
  { initials: "CR", bg: "hsl(var(--sage))" },
  { initials: "MB", bg: "hsl(var(--burnt-sienna))" },
  { initials: "TM", bg: "hsl(var(--olive))" },
  { initials: "JD", bg: "hsl(var(--bark))" },
];

const CommunityVoice = () => {
  const navigate = useNavigate();
  const [activeIndex, setActiveIndex] = useState(0);

  // Auto-advance testimonials every 5 seconds
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % testimonials.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  const active = testimonials[activeIndex];

  const goToPostJob = async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    navigate(session?.user ? "/post-job" : "/signup");
  };

  return (
  <section className="px-5 sm:px-8 lg:px-12 py-16 sm:py-20 lg:py-24">
    <div className="container mx-auto max-w-6xl">
      <div className="grid md:grid-cols-12 gap-10 md:gap-12 lg:gap-16 xl:gap-20 items-center">
        {/* LEFT — testimonial. Pull quote + signature + social-proof avatars.
            max-w-md + ml-auto pushes it toward the page center so its right
            edge is symmetric with the FAQ's left edge across the gutter. */}
        <div className="md:col-span-6 observe-fade-up md:max-w-md md:ml-auto md:mr-0">
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
                    color: "hsl(var(--parchment))",
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

        {/* RIGHT — FAQ accordion. max-w-md + mr-auto + ml-0 pulls the
            accordion's left edge toward the page center, mirroring the
            testimonial's right edge across the gutter. Both columns are
            now equidistant from the page's center spine. */}
        <div className="md:col-span-6 observe-fade-up max-w-md mx-auto md:mx-0 md:mr-auto md:ml-0" style={{ transitionDelay: "150ms" }}>
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

          {/* Inline closing CTA — single line below the FAQ. Catches the
              engaged scroller without competing with the hero buttons or
              adding a heavy "card" section. */}
          <p
            className="mt-6 sm:mt-7 text-center md:text-left font-serif italic text-ds-15 sm:text-ds-17 observe-fade-up"
            style={{
              color: "hsl(var(--stormy-sky))",
              transitionDelay: "550ms",
            }}
          >
            Still have questions?{" "}
            <button
              type="button"
              onClick={goToPostJob}
              className="font-sans font-semibold inline-flex items-center gap-1 transition-colors duration-200 hover:opacity-80"
              style={{
                fontStyle: "normal",
                color: "hsl(var(--burnt-sienna))",
                textDecoration: "underline",
                textUnderlineOffset: "3px",
                textDecorationThickness: "1px",
              }}
            >
              Post your first request
              <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
            </button>
          </p>
        </div>
      </div>
    </div>
  </section>
  );
};

export default CommunityVoice;
