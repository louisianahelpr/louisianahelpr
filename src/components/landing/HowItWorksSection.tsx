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
      className="px-5 sm:px-8 lg:px-12 pt-8 sm:pt-16 lg:pt-24 pb-8 sm:pb-24 lg:pb-32 scroll-mt-24"
    >
      {/* ONE layout at every width: heading block on top, three steps below.
          This section used to carry TWO independent responsive ladders that
          fought each other — an outer 12-column grid that moved the heading
          into a sticky 4/12 left rail from md up, and an inner card grid with
          its own breakpoints. The result was three different designs: stacked
          and centred on a phone, three cards under a centred heading at sm,
          then at md a left rail with the cards crushed into the remaining
          8/12 — about 150px each, narrow enough that "Post the job" set one
          word per line. Scaling a layout with width is fine; swapping which
          layout it is, twice, is not. The rail is gone, so the steps always
          get the full measure. */}
        <div className="mx-auto page-measure flex flex-col gap-6 md:gap-10">
        {/* Left column — masthead. Sticky at md+ so it stays anchored
            while the reader scrolls through the numbered steps. */}
        {/* Heading and the side toggle share ONE row (owner: "move to the
            right of how it works"); the subhead drops beneath both via
            `w-full`. Ordered with `order-*` rather than by moving the JSX, so
            the toggle stays where it reads in source — right after the line
            that introduces it. `flex-wrap` means a narrow phone lets the
            toggle fall under the heading on its own; that is the same rule
            bending, not a second layout. */}
        {/* ONE full-width row: heading hard left, side toggle hard right, the two
            vertically centred against each other. Centring both left a short
            heading floating in the middle of a wide measure with dead space on
            either flank, directly above three cards that DO span the full width
            — so the block above read as narrower than the block below, which is
            what made it look wrong rather than airy. `flex-wrap` lets the toggle
            drop under the heading on a phone, where there is no room for both. */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-left">
          {/* No eyebrow. `.text-display-eyebrow` is `display:none` app-wide
              since the eyebrow-removal decision, so the "How it works" label
              that used to sit here was rendering as nothing — leaving the
              section headed only "Three steps.", which never says what the
              three steps are FOR. The heading below carries it instead, which
              is also what the nav link pointing at #how-it-works is called. */}
          <h2
            className="font-display font-bold text-balance leading-[1.05] max-w-none"
            style={{
              // Matches the other section headings exactly (Help Center's "Quick
                // answers" is clamp(2.25rem, 3.4vw, 3.25rem)). Only the floor differed.
                fontSize: "clamp(2.25rem, 3.4vw, 3.25rem)",
              letterSpacing: "-0.025em",
              color: "hsl(var(--ink-deep))",
            }}
          >
            How it works.
          </h2>

          {/* No subhead (owner). "The basics, whether you're hiring or
              working." sat between the heading and the toggle, restating what
              the toggle already shows: the two sides are literally labelled "I
              need help" and "I want to work". The heading and the control now
              share one row with nothing between them. */}
          <div
            role="tablist"
            aria-label="Which side of Helpr are you on"
            className="inline-flex flex-nowrap items-center justify-center gap-1 p-1 rounded-2xl"
            style={{
              // Olivewood, NOT burnt sienna. The track used to be
              // sienna/0.06 inside a sienna/0.18 border — within a hair of the
              // three step cards below it (sienna/0.04 inside sienna/0.15), so
              // a control read as a fourth content panel and competed with the
              // thing it is meant to filter. Sienna stays the content colour;
              // the control sits on the neutral.
              // BARK, the page's one control colour. The landing page was
              // running three families at once: bark on the hero buttons,
              // olivewood on this track, burnt sienna on the step cards — so a
              // visitor met three different greens/browns before scrolling
              // once. The rule now: bark = controls, sienna = content accent
              // (cards, the 01/02/03 numerals), olivewood = text. This track is
              // a control, so it is bark, and it matches the "Browse Jobs"
              // button directly above it.
              // Matched to the hero's "Browse Jobs" button (owner), which is
              // `bg-background/70` inside a `1.5px solid hsl(var(--bark)/0.4)`
              // border. Same surface, same edge — so the two secondary controls
              // on the landing page read as the same material instead of two
              // different tinted panels.
              background: "transparent",
              backdropFilter: "blur(20px) saturate(180%)",
              WebkitBackdropFilter: "blur(20px) saturate(180%)",
              border: "1.5px solid hsl(var(--bark) / 0.4)",
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
                      : "hsl(var(--bark) / 0.75)",
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
        <div>
          {/* Three across from `sm` up — one row, always. The old ladder was
              `sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3`, so the 768-1023px
              band dropped to two columns and wrapped step 03 onto a line of its
              own: a numbered 01/02/03 sequence broken across rows, which reads
              as two things and then an afterthought rather than one process. */}
          <div className="grid grid-cols-1 sm:grid-cols-3 items-stretch gap-3 sm:gap-8 lg:gap-10">
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
                // The number stays ABOVE the copy at every width. It used to go
                // `md:flex-row` — number beside text — which only worked while md
                // was a TWO-column band. At three columns each card is a third of
                // the row, and a side-by-side number left the copy about ten
                // characters wide.
                // No `min-h`. The floor was 19rem/21rem, set back when each card
                // was its own row at md and the three drifted to different
                // heights. They share one row at every width now, so
                // `items-stretch` on the grid equalises them for free — and the
                // floor was leaving each card about half empty, roughly 150px of
                // blank below three lines of copy.
                className="h-full flex flex-col text-center rounded-2xl p-5 sm:p-7 lg:p-8"
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
                    fontSize: "clamp(2.125rem, 6.5vw, 6rem)",
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
                  className="mt-2 md:mt-0 font-display font-bold text-ds-20 sm:text-ds-24 lg:text-ds-28 tracking-tight leading-tight"
                  style={{ color: "hsl(var(--ink-deep))" }}
                >
                  {step.title}
                </h3>
                <p
                  className="mt-2 font-sans text-ds-13 sm:text-ds-15 lg:text-ds-17 leading-relaxed max-w-sm mx-auto"
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
