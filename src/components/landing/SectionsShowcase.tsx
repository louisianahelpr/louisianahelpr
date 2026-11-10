import { useIdCheckOnForViewer } from "@/lib/useIdCheckOnForViewer";
import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, CreditCard, Headset, Lock, MapPin, ShieldCheck, type LucideIcon } from "lucide-react";
import { APPROVAL_WINDOW_HOURS } from "../../../supabase/functions/_shared/escrowTiming";
import { goSignedInOr } from "./goSignedInOr";
import { POST_JOB_PATH, POST_JOB_SIGNED_OUT, SELL_PATH, SELL_SIGNED_OUT } from "./HowItWorksSection";
import { whenPageSettled } from "@/lib/routePrefetch";

const LandingAppleButton = lazy(() => import("./LandingAppleButton"));

/**
 * The landing's close (owner-approved redesign, 2026-10-20; Direction A, owner 11-10): the deep-olive safety band, then
 * the join block. Direction A took the four (then two) section cards away: "Near you this week" (NearYouSection.tsx)
 * shows real jobs and items in their place, with "Shops and Homes are on the way." under it.
 *
 * Copy states only what the app does today (lead, LANDING-APPROVED.md): no price-drop timing, no fee or speed figures
 * beyond the real rules (APPROVAL_WINDOW_HOURS is the cron's own number: past it Helpr support steps in, nothing
 * releases on a timer, owner 2026-10-23), no other company or vendor named, and copy for both sides (design spec v2
 * §1.4, §1.7).
 */
/** D002 (landing design audit 11-10): the close is one step larger than the section headings (.landing-h2-close). */
const H2_CLOSE_CLASS = "font-display landing-serif text-balance landing-h2-close";

/** True once `ref` has been on screen after the page loaded (never at first paint). */
function useSeenAfterLoad(ref: RefObject<HTMLElement>): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    // Never at first paint (lead review, 2026-10-19): observe only once the page has
    // loaded, with no margin, so the read waits until the block is actually on screen.
    let io: IntersectionObserver | null = null;
    const watch = () => {
      io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io?.disconnect();
        }
      });
      io.observe(el);
    };
    if (document.readyState === "complete") watch();
    else window.addEventListener("load", watch, { once: true });
    return () => {
      window.removeEventListener("load", watch);
      io?.disconnect();
    };
  }, [ref]);
  return seen;
}

/**
 * D009 (landing design audit 11-10): the band made eight claims of equal weight (four steps and four tiles) and left an
 * empty block at 1440. Now one headline that covers jobs AND Declutter (owner's preview tweak 2: the Declutter line is
 * folded in, not a ninth claim), three steps in one row, and one row of trust badges.
 */
const MONEY_STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: CreditCard, title: "Paid through Helpr", body: "The full price is shown before anyone pays, and Helpr holds the money." },
  { icon: Lock, title: "Held until it’s done", body: "Nobody is paid out until the work is done, or the buyer says they got the item." },
  {
    icon: Check,
    title: "Approved, then released",
    body: `The person hiring approves the work or asks for a change. If they haven’t answered in ${APPROVAL_WINDOW_HOURS} hours, a real person on our team steps in.`,
  },
];

/** The ID badge while the ID check is on; while it is off (owner 2026-10-23) a true one takes its place. */
const TRUST_ID_ON = { icon: ShieldCheck, title: "ID-verified people" };
const TRUST_ID_OFF = { icon: ShieldCheck, title: "Every email confirmed" };
/** Direction A (owner 11-10): THREE badges under the band's headline (the cash line is the headline's own promise). */
const TRUST: { icon: LucideIcon; title: string }[] = [
  TRUST_ID_ON,
  { icon: Headset, title: "A real person answers" },
  { icon: MapPin, title: "Made in Louisiana" },
];

/** Holds the Apple button's place (same box and label, invisible) until its chunk has loaded (F016). */
function AppleSlot() {
  return (
    <span
      aria-hidden
      className="invisible inline-flex items-center justify-center gap-2 h-14 w-full sm:w-auto px-7 rounded-full text-ds-15 font-semibold border"
      data-testid="landing-apple-slot"
    >
      <span className="w-[18px] h-[18px]" />
      Continue with Apple
    </span>
  );
}

/** The band's one headline: jobs and Declutter under one rule (D009, preview tweak 2). */
const MONEY_HEADLINE = "Nobody gets paid until it’s really done, or really handed over.";

/** The money band + the join block. "Create your free account" is the close's one primary. */
export function TrustAndJoin() {
  const navigate = useNavigate();
  const joinRef = useRef<HTMLElement>(null);
  const joinSeen = useSeenAfterLoad(joinRef);
  // L010 (landing audit 11-09): the trust card said "Every account confirms its email" to every guest, because the
  // member's switch answer is false signed out; the real protection, on for everyone, is the ID check.
  const idOn = useIdCheckOnForViewer();
  // UI audit F016 (11-09): the Apple button's chunk is fetched once the page has settled (never on first paint), and
  // its slot is held by a same-size placeholder until then, so "Create your free account" never moves when it lands.
  const [settled, setSettled] = useState(false);
  useEffect(() => whenPageSettled(() => setSettled(true)), []);
  const appleReady = joinSeen || settled;
  // Same routing as everywhere on the landing: a signed-in visitor lands on Home, never on the sign-up form.
  const goToAccount = (e: React.MouseEvent) => {
    e.preventDefault();
    void goSignedInOr(navigate, "/home", "/signup");
  };
  return (
    <>
      <section aria-labelledby="money-heading" data-testid="landing-money-band" className="px-5 sm:px-8 lg:px-12 py-16 sm:py-20 lg:py-24" style={{ background: "var(--lp-band)", color: "var(--lp-band-body)" }}>
        <div className="mx-auto w-full max-w-6xl flex flex-col gap-10 lg:gap-12">
          {/* D015 (11-10): no YOUR MONEY, PROTECTED eyebrow; the headline says it. */}
          <h2 id="money-heading" className="max-w-3xl font-display landing-serif text-balance landing-h2" style={{ color: "var(--lp-band-ink)" }}>
            {MONEY_HEADLINE}
          </h2>
          <ol className="grid grid-cols-1 sm:grid-cols-3 gap-6 lg:gap-10" data-testid="landing-money-steps">
            {MONEY_STEPS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex flex-col gap-3 min-w-0">
                <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--lp-band-tile)", color: "var(--lp-band-money)" }} aria-hidden>
                  <Icon className="w-[18px] h-[18px]" />
                </span>
                <h3 className="text-ds-16 font-bold" style={{ color: "var(--lp-band-ink)" }}>{title}</h3>
                <p className="text-ds-15 leading-relaxed">{body}</p>
              </li>
            ))}
          </ol>
          <ul className="flex flex-wrap gap-2" data-testid="landing-trust-badges" aria-label="Why it’s safe">
            {TRUST.map((t) => (t === TRUST_ID_ON && !idOn ? TRUST_ID_OFF : t)).map(({ icon: Icon, title }) => (
              <li key={title} className="inline-flex items-center gap-2 rounded-full px-3.5 min-h-9 text-ds-13 font-semibold" style={{ border: "1px solid var(--lp-band-line)", color: "var(--lp-band-ink)" }}>
                <Icon className="w-4 h-4" aria-hidden style={{ color: "var(--lp-band-money)" }} />
                {title}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section ref={joinRef} aria-labelledby="join-heading" className="px-5 sm:px-8 lg:px-12 py-20 sm:py-24 lg:py-32">
        <div className="mx-auto w-full max-w-3xl flex flex-col items-center text-center gap-5">
          {/* D002 (11-10): the close is one step larger than the section headings (.landing-h2-close, 40 -> 56px). */}
          <h2 id="join-heading" className={H2_CLOSE_CLASS} style={{ color: "var(--lp-ink)" }}>
            Join your neighbors on{" "}
            <em style={{ fontStyle: "italic", color: "var(--lp-action-strong)" }}>Helpr.</em>
          </h2>
          <p className="max-w-xl text-ds-15 sm:text-ds-17" style={{ color: "var(--lp-body)" }}>One free account for jobs and Declutter.</p>
          <div className="mt-2 w-full flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <Link
              to="/signup"
              onClick={goToAccount}
              className="btn-grad-primary inline-flex items-center justify-center gap-2 h-14 w-full sm:w-auto px-8 rounded-full text-ds-15 font-semibold"
              data-testid="landing-signup"
            >
              Create your free account
            </Link>
            {appleReady ? (
              <Suspense fallback={<AppleSlot />}>
                <LandingAppleButton />
              </Suspense>
            ) : (
              <AppleSlot />
            )}
          </div>
          {/* Owner #7 (11-09): the close names both open sections' first steps, quietly (links, not more buttons), in the
              landing's one set of verbs (D012, 11-10). */}
          <nav aria-label="Start here" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-ds-15 font-semibold" data-testid="landing-join-starts">
            <Link to="/browse" className="inline-flex items-center min-h-11 link-standard" style={{ color: "var(--lp-action-strong)" }}>Browse jobs</Link>
            <Link to={POST_JOB_SIGNED_OUT} onClick={(e) => { e.preventDefault(); void goSignedInOr(navigate, POST_JOB_PATH, POST_JOB_SIGNED_OUT); }} className="inline-flex items-center min-h-11 link-standard" style={{ color: "var(--lp-action-strong)" }}>Post a job</Link>
            <Link to="/declutter" className="inline-flex items-center min-h-11 link-standard" style={{ color: "var(--lp-action-strong)" }}>Shop Declutter</Link>
            <Link to={SELL_SIGNED_OUT} onClick={(e) => { e.preventDefault(); void goSignedInOr(navigate, SELL_PATH, SELL_SIGNED_OUT); }} className="inline-flex items-center min-h-11 link-standard" style={{ color: "var(--lp-action-strong)" }}>Sell something</Link>
          </nav>
          <Link to="/login" className="inline-flex items-center min-h-11 text-ds-15 font-bold underline underline-offset-4" style={{ color: "var(--lp-action-strong)" }}>
            Already a member? Log in
          </Link>
        </div>
      </section>
    </>
  );
}
