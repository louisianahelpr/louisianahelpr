import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { signupUrlFor } from "@/lib/jobIntent";
import { goSignedInOr } from "./goSignedInOr";
import { HIRE_STEPS } from "./hireSteps";
import { useLandingMode, type LandingMode } from "./landingMode";
import { useGuestSpanish } from "./useGuestSpanish";
import { SELL_CHOOSER_PATH } from "@/lib/declutter/sellChooser";
import {
  SegmentedControl,
  type SegmentedOption,
} from "@/components/ui/SegmentedControl";

/**
 * How a job works (owner-approved landing redesign, 2026-10-20): heading and
 * the "I need help | I want to work" toggle on one row, three white step cards
 * with a Bodoni ordinal. Steps are always visible; they slide up 16px (120ms
 * stagger) only when the section starts below the fold. Honors
 * prefers-reduced-motion.
 *
 * Two-sided: Helpr is a marketplace where the SAME account both posts
 * jobs and works them, so the steps switch between the poster journey
 * and the helpr journey via the segmented control above the cards.
 */
type Side = "hire" | "work" | "sell";

const SIDE_OPTIONS: SegmentedOption<Side>[] = [
  { value: "hire", label: "I need help" },
  { value: "work", label: "I want to work" },
  // Owner 11-09 (10:45 PM, #7): the landing talked about Jobs and barely about Declutter. The third side is Declutter's
  // own three steps, the same calm cards.
  { value: "sell", label: "Buy or sell" },
];

// Copy true TODAY (lead, LANDING-APPROVED.md, 2026-10-20). Poster side:
//   1. the poster names the price (BudgetSection), no "typical prices" claim;
//   2. the poster may message a pending applicant before hiring: the Message
//      button on every pending applicant's Hire row (ApplicantHireRow.tsx) and
//      the live send gate can_send_message_to_in_job (poster -> applicant),
//      read on prod 2026-10-20. No "every Helpr is ID-verified" claim:
//      accept_job_offer checks ID (helper_accept_block_reason), but the bodies
//      of accept_application, accept_group_application,
//      complete_direct_offer_accept, direct_accept_block_reason and
//      book_accepted_quote name no identity check (prod, 2026-10-20);
//   3. escrow is held until the poster approves; past the APPROVAL_WINDOW_HOURS
//      window Helpr support steps in (owner 2026-10-23), stated in the money band below.
// Helpr side is anchored to the real flow, not aspiration:
//   1. Browse is radius-filtered in miles (JobFilters.tsx `radiusOptions`)
//      and applying never triggers the ID gate (useApplyFlow.ts), with the
//      take-home breakdown shown in the apply dialog before you commit.
//   2. The poster picks; the Helpr accepts (no ID claim, see above).
//   3. The poster funds escrow up front; release-payout transfers to the
//      helpr's Stripe Connect account once the job is completed and clear
//      of disputes. No payout speed or fee % is claimed here on purpose.
const STEPS: Record<Side, { title: string; desc: string }[]> = {
  hire: [...HIRE_STEPS], // shared with the /hire town pages (L014)
  work: [
    { title: "Find work nearby", desc: "Browse jobs near you, see your take-home, then apply." },
    { title: "Get picked", desc: "The person who posted the job picks you, and you accept." },
    { title: "Get paid when it's done", desc: "Their payment is held safely, then released to you once the work is approved." },
  ],
  // Declutter, true today (OWNER-DECISIONS.md "Posting" and "Declutter handover money", 10-30/11-01): a listing is photos,
  // title, description, price, category and condition; buyers tap Buy now or send an offer; the buyer's "I got it" alone
  // finishes the order and pays the seller.
  sell: [
    { title: "List it in a minute", desc: "Add photos, a title and a garage-sale price." },
    { title: "Neighbors buy or offer", desc: "They tap Buy now or send you an offer. You choose." },
    { title: "Hand it over, get paid", desc: "Meet up or leave it on the porch. You're paid once the buyer says they got it." },
  ],
};

/**
 * Visible by default; the fade is only an enhancement (lead, 2026-10-19: a
 * full-page capture showed this section blank because the reveal never
 * fired). "shown" is what renders first, so no JS, no IntersectionObserver,
 * reduced motion, or a section already on screen all keep the steps visible.
 * Nothing is ever see-through: a section that starts BELOW the fold only sits
 * 16px low (set before first paint, in a layout effect) and slides up when any
 * part of it scrolls in, so print, crawlers and full-page captures read it too.
 */
type Reveal = "shown" | "waiting" | "revealed";

/**
 * The "I need help" side's own action (lead, 2026-10-25: the signed-out home
 * had no way to post). A signed-out visitor goes to sign-up carrying /post-job
 * as the return path (jobIntent's redirect, which survives the email
 * confirmation round-trip); a signed-in one goes straight to /post-job. Not
 * filled: the hero's Search and the close's account button stay the page's
 * two primaries (landingFrontDoor.test.tsx).
 */
export const POST_JOB_PATH = "/post-job";
export const POST_JOB_SIGNED_OUT = signupUrlFor(POST_JOB_PATH);
/** Owner #7 (11-09): the Declutter side's Sell button, with the same sign-up-and-return rule; it opens the sell chooser (owner pick 5, 11-08), never the bare one-item form. */
export const SELL_PATH = SELL_CHOOSER_PATH;
export const SELL_SIGNED_OUT = signupUrlFor(SELL_PATH);

/** Owner's preview tweak 1 (11-10): in Declutter mode How it works opens on "Buy or sell"; in Jobs mode on "I need help". */
function sideForMode(mode: LandingMode): Side {
  return mode === "declutter" ? "sell" : "hire";
}

/**
 * D012 / D020 (landing design audit 11-10): each side's ONE action, a quiet link beside the tabs (it was a lone outline
 * button under the steps, bottom-left at 1440, and the sell side had two). Same verbs as the rest of the landing.
 */
const SIDE_ACTION: Record<Side, { label: string; signedOut: string; signedIn: string; testId: string }> = {
  hire: { label: "Post a job", signedOut: POST_JOB_SIGNED_OUT, signedIn: POST_JOB_PATH, testId: "landing-post-job" },
  work: { label: "Browse jobs", signedOut: "/browse", signedIn: "/browse", testId: "landing-find-work" },
  sell: { label: "Sell something", signedOut: SELL_SIGNED_OUT, signedIn: SELL_PATH, testId: "landing-sell" },
};

const HowItWorksSection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [reveal, setReveal] = useState<Reveal>("shown");
  const mode = useLandingMode();
  const [side, setSide] = useState<Side>(() => sideForMode(mode));
  // The hero's Jobs | Declutter choice turns this section's side too (preview tweak 1).
  useEffect(() => setSide(sideForMode(mode)), [mode]);
  const navigate = useNavigate();
  const action = SIDE_ACTION[side];
  // F260q (owner 11-11): the Spanish words when the visitor's language is Spanish (enLanding.ts / esLanding.ts).
  const es = useGuestSpanish();
  const w = (key: string, english: string) => es?.[key] ?? english;
  const ACTION_KEY: Record<Side, string> = { hire: "landing.postJob", work: "landing.browseJobs", sell: "landing.sell" };

  useLayoutEffect(() => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const el = sectionRef.current;
    if (!el || el.getBoundingClientRect().top < window.innerHeight) return;
    setReveal("waiting");
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setReveal("revealed");
          io.disconnect();
        }
      },
      // Any pixel counts: a ratio threshold never fires on a section taller
      // than a few viewports (large text, a landscape phone).
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const lowered = reveal === "waiting";

  return (
    <section
      id="how-it-works"
      ref={sectionRef}
      // L020 (landing audit 11-09): ~200px stood between "Four ways" and this heading at 1440 (~115 at 375); the top is
      // trimmed, the bottom (before the money band) kept.
      className="px-5 sm:px-8 lg:px-12 pt-12 sm:pt-16 lg:pt-20 pb-16 sm:pb-20 lg:pb-28 scroll-mt-24"
    >
      {/* ONE layout at every width: heading + toggle on one row (the toggle drops
          under the heading on a phone), three step cards below, three across
          from `sm`. Same measure as every other landing block. */}
      <div className="mx-auto w-full max-w-6xl flex flex-col gap-8 md:gap-10">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <h2
            className="font-display landing-serif text-balance landing-h2"
            style={{ color: "var(--lp-ink)" }}
          >
            {w("landing.how.title", "How it works")}
          </h2>
          {/* The app's shared control (selected = the olive primary), so the
              marketing page and the app agree on what "selected" looks like.
              `semantics="tab"`: it swaps the three step cards below. */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {/* D008 (landing design audit 11-10): the hero's quiet selected style, so the landing has ONE look for
                "selected" (this switch was the solid olive, the hero's the white pill). */}
            <SegmentedControl
              semantics="tab"
              labelSize="md"
              tone="quiet"
              ariaLabel={w("landing.how.sidesLabel", "Which side of Helpr are you on")}
              options={SIDE_OPTIONS.map((o) => ({ ...o, label: w(`landing.how.side.${o.value}`, o.label) }))}
              value={side}
              onChange={setSide}
            />
            <Link
              to={action.signedOut}
              onClick={(e) => {
                e.preventDefault();
                void goSignedInOr(navigate, action.signedIn, action.signedOut);
              }}
              data-testid={action.testId}
              className="inline-flex items-center gap-1.5 min-h-11 text-ds-15 font-bold link-standard"
              style={{ color: "var(--lp-action-strong)" }}
            >
              {w(ACTION_KEY[side], action.label)}
              <ArrowRight className="w-4 h-4" aria-hidden />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 items-stretch gap-3 sm:gap-4 lg:gap-5">
          {/* Keyed by index, not title: switching sides swaps the copy in the
              SAME three nodes instead of remounting them, so the reveal is not
              re-armed on every toggle. */}
          {STEPS[side].map((step, i) => (
            <div
              key={i}
              className="landing-card h-full min-w-0 flex flex-col p-6 lg:p-7"
              style={{
                // Never an opacity of 0 (Q2228): the steps are readable in every state.
                  opacity: 1,
                transform: lowered ? "translateY(16px)" : "translateY(0)",
                // Short and lightly staggered, so a fast scroll never lands on blank cards.
                transition: reveal === "revealed" ? `transform 600ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 120}ms` : undefined,
              }}
            >
              {/* The ordinal in Bodoni, olive (rust is for money only). */}
              <span
                aria-hidden
                className="landing-serif-text block shrink-0 leading-none text-ds-40"
                style={{ color: "var(--lp-action)" }}
              >
                {i + 1}
              </span>
              {/* `key={side}` remounts ONLY this text block when the toggle
                  flips, so the new copy fades in instead of snapping. */}
              <div
                key={side}
                className="min-w-0 mt-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300"
              >
                <h3 className="font-sans font-bold text-ds-17 lg:text-ds-20 tracking-tight leading-snug" style={{ color: "var(--lp-ink)" }}>
                  {w(`landing.how.${side}${i + 1}Title`, step.title)}
                </h3>
                <p className="mt-2 font-sans text-ds-15 leading-relaxed" style={{ color: "var(--lp-body)" }}>
                  {w(`landing.how.${side}${i + 1}Desc`, step.desc)}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* No Helpr Guarantee box here (owner, 2026-10-31: "it doesn't fit there"). The
            promise stays where it is offered: first post's Review and /book/<id>. */}
      </div>
    </section>
  );
};

export default HowItWorksSection;
