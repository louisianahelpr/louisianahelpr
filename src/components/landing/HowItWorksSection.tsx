import { useEffect, useRef, useState } from "react";

/**
 * How It Works — editorial magazine layout. Title lives in the left
 * column as a masthead; the three numbered steps flow across the right.
 * Steps fade-in sequentially (100→200→300ms stagger) as the section
 * enters the viewport. No cards, no glass panel, no icons — giant
 * Bodoni numerals anchor each step. Sits directly on parchment to match
 * the hero's editorial poster feel. Honors prefers-reduced-motion.
 *
 * Two-sided: Helpr is a marketplace where the SAME account both posts
 * jobs and works them, so the steps switch between the poster journey
 * and the helpr journey via the segmented control above the cards.
 * Without it the page read as "this is only for hiring."
 */
type Side = "hire" | "work";

const SIDE_LABELS: Record<Side, string> = {
  hire: "I need help",
  work: "I want to work",
};

const STEPS: Record<Side, { title: string; desc: string }[]> = {
  hire: [
    {
      title: "Post the job",
      desc: "Tell us what you need, set a budget, and pick a date.",
    },
    {
      title: "Pick your Helpr",
      desc: "Local applicants come to you. Compare profiles and reviews.",
    },
    {
      title: "Pay when it's done",
      desc: "Funds are held securely — released when you confirm the work.",
    },
  ],
  // Helpr-side copy is anchored to the real flow, not aspiration:
  //   1. Browse is radius-filtered in miles (JobFilters.tsx `radiusOptions`)
  //      and applying never triggers the ID gate (useApplyFlow.ts), with the
  //      take-home breakdown shown in the apply dialog before you commit.
  //   2. The ID-verification gate fires when a helpr ACCEPTS their first job
  //      (useOfferHandlers.ts `handleHelperResponse`).
  //   3. The poster funds escrow up front; release-payout transfers to the
  //      helpr's Stripe Connect account once the job is completed and clear
  //      of disputes. No payout speed or fee % is claimed here on purpose —
  //      both are variable (tiered commission, 24h hold) and would date fast.
  work: [
    {
      title: "Find work nearby",
      desc: "Browse jobs near you, see your take-home, then apply.",
    },
    {
      title: "Get picked",
      desc: "The poster picks you. Verify your ID once, then work.",
    },
    {
      title: "Get paid when it's done",
      desc: "Their payment is held securely — released to you once you're done.",
    },
  ],
};

const HowItWorksSection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [side, setSide] = useState<Side>("hire");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) {
      setInView(true);
      return;
    }
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.2, rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section
      id="how-it-works"
      ref={sectionRef}
      className="px-5 sm:px-8 lg:px-12 pt-12 sm:pt-16 lg:pt-24 pb-16 sm:pb-24 lg:pb-32 scroll-mt-24"
    >
      <div className="mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem] grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-10 lg:gap-16 md:items-center">
        {/* Left column — masthead. Sticky at md+ so it stays anchored
            while the reader scrolls through the numbered steps. */}
        <div className="md:col-span-4 lg:col-span-3 text-center md:text-left md:sticky md:top-32 md:self-start">
          {/* No eyebrow. `.text-display-eyebrow` is `display:none` app-wide
              since the eyebrow-removal decision, so the "How it works" label
              that used to sit here was rendering as nothing — leaving the
              section headed only "Three steps.", which never says what the
              three steps are FOR. The heading below carries it instead, which
              is also what the nav link pointing at #how-it-works is called. */}
          <h2
            className="mt-3 font-display font-bold text-balance leading-[1.05] max-w-[10ch] md:max-w-none mx-auto md:mx-0"
            style={{
              fontSize: "clamp(2.25rem, 3.4vw, 3.25rem)",
              letterSpacing: "-0.025em",
              color: "hsl(var(--ink-deep))",
            }}
          >
            How it works.
          </h2>

          {/* Sits between the heading and the side toggle it describes, so the
              sentence reads straight into the control → [I need help | I want
              to work].

              Deliberately does NOT say "three steps". The real flow has more
              than three (apply, accept, ID gate, escrow fund, completion,
              release), and these cards are a simplification of it — so the
              subhead says "the basics", which is true, rather than putting a
              count on it that the product doesn't match. Covers BOTH
              sides, since the same line stays on screen whichever side is
              selected. Same type treatment as the /subscription and
              /for-business section subheads. */}
          <p
            className="mt-4 font-sans text-ds-13 sm:text-ds-15 leading-relaxed max-w-xs mx-auto md:mx-0"
            style={{ color: "hsl(var(--olivewood) / 0.85)" }}
          >
            The basics, whether you're hiring or working.
          </p>

          {/* Side segmented control — same shape/treatment as the billing-cycle
              toggle on SubscriptionPage. Sits directly under the "Three steps."
              masthead so the choice reads as part of the heading it modifies.
              One line, always (`flex-nowrap`). It used to wrap: measured at
              840px the pair needs 264px while the left column is 232px, so the
              pills stacked. Fixed by tightening them inside the narrow md
              column only — px-3 and one type step down — which recovers the
              32px without shortening the labels or moving the masthead off the
              left. Below md the column is full width and at lg it widens, so
              both keep the roomier px-4/px-5 sizing. */}
          <div
            role="tablist"
            aria-label="Which side of Helpr are you on"
            className="mt-6 inline-flex flex-nowrap items-center justify-center md:justify-start gap-1 p-1 rounded-2xl"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.06)",
              border: "1px solid hsl(var(--burnt-sienna) / 0.18)",
              boxShadow: "var(--elev-inset-hairline)",
            }}
          >
            {(["hire", "work"] as const).map((s) => {
              const active = side === s;
              return (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSide(s)}
                  className="h-9 sm:h-10 px-4 sm:px-5 md:px-3 md:text-ds-12 lg:px-4 rounded-ds-md font-sans font-semibold text-ds-13 whitespace-nowrap transition-[background,color,transform] duration-150 active:scale-[0.98]"
                  style={{
                    background: active ? "hsl(var(--bark))" : "transparent",
                    color: active
                      ? "hsl(var(--parchment))"
                      : "hsl(var(--olivewood))",
                    boxShadow: active
                      ? "0 1px 2px rgba(0,0,0,0.08), inset 0 1px 0 hsl(var(--parchment) / 0.2)"
                      : "none",
                    letterSpacing: "-0.005em",
                  }}
                >
                  {SIDE_LABELS[s]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right column — 3 steps with sequential fade-in. */}
        <div className="md:col-span-8 lg:col-span-9">
          {/* `md:grid-cols-1` between sm and lg on purpose. From md up this
              column is only 8/12 wide, so three cards side by side were ~150px
              each — narrow enough that "Post the job" broke across two lines and
              the body copy set two or three words to a line. One per row at md
              gives each the full ~500px; lg is wide enough to go back to three.

              Heights are held by an explicit `min-h`, NOT by `items-stretch`
              alone. Stretch only equalises within a ROW, and at md each card is
              its own row (grid-cols-1) — so the three drifted apart, and the
              block jumped when the side toggle swapped in longer copy ("I want
              to work" ran 247px against 225px). The floor is set per breakpoint
              because the card width, and so the wrap height, changes with the
              column count. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-1 lg:grid-cols-3 items-stretch gap-10 sm:gap-8 lg:gap-10">
            {/* Keyed by index, not title: switching sides swaps the copy in
                the SAME three nodes instead of remounting them, so the
                observer's staggered fade-in isn't re-armed (or skipped) on
                every toggle. */}
            {STEPS[side].map((step, i) => (
              <div
                key={i}
                // md lays the card out as a ROW — numeral on the left, title and copy
                // to its right. That only makes sense at md, which is the one
                // breakpoint where these are full-width stacked cards with a lot
                // of horizontal room going spare beside a 6rem numeral. sm and lg
                // are 3-up and narrow, so they stay stacked. The md min-height
                // No md min-height. Every `desc` in STEPS is trimmed to set as
                // exactly TWO lines at this width, so the three cards come out
                // the same height on their own — in both toggle states. That is
                // strictly better than a floor, which equalised them by padding
                // the short ones with dead space.
                //
                // `md:min-h-0` is required, not redundant: Tailwind breakpoints
                // are min-width, so `sm:min-h-[19rem]` keeps applying at md and
                // was inflating a two-line row card to 304px. sm/lg keep their
                // floors because those are the 3-up stacked layouts, where the
                // cards genuinely need matching height.
                className="h-full flex flex-col md:flex-row md:items-start md:gap-6 lg:flex-col lg:gap-0 text-center md:text-left rounded-2xl p-6 sm:p-7 lg:p-8 sm:min-h-[19rem] md:min-h-0 lg:min-h-[21rem]"
                style={{
                  opacity: inView ? 1 : 0,
                  transform: inView ? "translateY(0)" : "translateY(24px)",
                  transition: `opacity 1100ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 400}ms, transform 1100ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 400}ms`,
                  willChange: "opacity, transform",
                  background: "hsl(var(--burnt-sienna) / 0.04)",
                  border: "1.5px solid hsl(var(--burnt-sienna) / 0.15)",
                  boxShadow: "var(--elev-inset-hairline)",
                }}
              >
                <span
                  aria-hidden
                  className="block shrink-0 font-display font-black leading-none"
                  style={{
                    fontSize: "clamp(4rem, 6.5vw, 6rem)",
                    color: "hsl(var(--burnt-sienna) / 0.35)",
                    letterSpacing: "-0.04em",
                  }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                {/* `key={side}` remounts ONLY this text block when the toggle
                    flips, so the new copy fades in instead of snapping. The card
                    itself deliberately keeps `key={i}` (see the note above) —
                    remounting the card would re-arm its staggered
                    IntersectionObserver fade and make all three replay on every
                    toggle. Scoping the remount to the text keeps that intact.
                    `motion-safe:` so it's silent under prefers-reduced-motion.

                    min-w-0 so the copy wraps inside the row rather than forcing
                    the card wider than its grid cell. */}
                <div
                  key={side}
                  className="min-w-0 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300"
                >
                <h3
                  className="mt-4 md:mt-0 font-display font-bold text-ds-20 sm:text-ds-24 lg:text-ds-28 tracking-tight leading-tight"
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
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default HowItWorksSection;
