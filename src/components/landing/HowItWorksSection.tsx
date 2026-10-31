import { useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { signupUrlFor } from "@/lib/jobIntent";
import { goSignedInOr } from "./goSignedInOr";
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
type Side = "hire" | "work";

const SIDE_OPTIONS: SegmentedOption<Side>[] = [
  { value: "hire", label: "I need help" },
  { value: "work", label: "I want to work" },
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
  hire: [
    { title: "Post what you need", desc: "Describe the job and set your price." },
    { title: "Pick your Helpr", desc: "See who applied and chat before you hire." },
    { title: "Pay when it's done", desc: "Your money is held safely until you approve the work." },
  ],
  work: [
    { title: "Find work nearby", desc: "Browse jobs near you, see your take-home, then apply." },
    { title: "Get picked", desc: "The person who posted the job picks you, and you accept." },
    { title: "Get paid when it's done", desc: "Their payment is held safely, then released to you once the work is approved." },
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

const HowItWorksSection = () => {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [reveal, setReveal] = useState<Reveal>("shown");
  const [side, setSide] = useState<Side>("hire");
  const navigate = useNavigate();

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
      className="px-5 sm:px-8 lg:px-12 py-16 sm:py-20 lg:py-28 scroll-mt-24"
    >
      {/* ONE layout at every width: heading + toggle on one row (the toggle drops
          under the heading on a phone), three step cards below, three across
          from `sm`. Same measure as every other landing block. */}
      <div className="mx-auto w-full max-w-6xl flex flex-col gap-8 md:gap-10">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
          <h2
            className="font-display landing-serif text-balance leading-[1.05] text-ds-32 sm:text-[44px] lg:text-[52px]"
            style={{ color: "var(--lp-ink)" }}
          >
            How a job works
          </h2>
          {/* The app's shared control (selected = the olive primary), so the
              marketing page and the app agree on what "selected" looks like.
              `semantics="tab"`: it swaps the three step cards below. */}
          <SegmentedControl
            semantics="tab"
            ariaLabel="Which side of Helpr are you on"
            options={SIDE_OPTIONS}
            value={side}
            onChange={setSide}
          />
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
                  {step.title}
                </h3>
                <p className="mt-2 font-sans text-ds-15 leading-relaxed" style={{ color: "var(--lp-body)" }}>
                  {step.desc}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* No Helpr Guarantee box here (owner, 2026-10-31: "it doesn't fit there"). The
            promise stays where it is offered: first post's Review and /book/<id>. */}
        {side === "hire" && (
          <Link
            to={POST_JOB_SIGNED_OUT}
            onClick={(e) => {
              e.preventDefault();
              void goSignedInOr(navigate, POST_JOB_PATH, POST_JOB_SIGNED_OUT);
            }}
            data-testid="landing-post-job"
            className="self-center sm:self-start inline-flex items-center justify-center gap-2 min-h-12 rounded-full px-7 text-ds-16 font-bold border-2 transition-colors"
            style={{ color: "var(--lp-action-strong)", borderColor: "var(--lp-action)" }}
          >
            Post a job
            <ArrowRight className="w-4 h-4" strokeWidth={2} aria-hidden />
          </Link>
        )}
      </div>
    </section>
  );
};

export default HowItWorksSection;
