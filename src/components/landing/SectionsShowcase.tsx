import { useIdCheckOnForViewer } from "@/lib/useIdCheckOnForViewer";
import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check, Camera, CreditCard, Headset, Lock, MapPin, ShieldCheck, Wallet, type LucideIcon } from "lucide-react";
import { SECTIONS, type SectionKey } from "@/components/sections/sectionsConfig";
import { APPROVAL_WINDOW_HOURS } from "../../../supabase/functions/_shared/escrowTiming";
import { useSectionsOpen, sectionIsComingSoon } from "./useSectionsOpen";
import { goSignedInOr } from "./goSignedInOr";
import { POST_JOB_PATH, POST_JOB_SIGNED_OUT, SELL_PATH, SELL_SIGNED_OUT } from "./HowItWorksSection";
import { whenPageSettled } from "@/lib/routePrefetch";

const LandingAppleButton = lazy(() => import("./LandingAppleButton"));

/**
 * The landing page below the hero (owner-approved redesign, 2026-10-20): the
 * four section cards, then (after How a job works) the money band and the join
 * block. A section whose switch is not open to everyone has no link, carries a
 * small "Coming soon" badge inside its card and is slightly dimmed (owner 11-09,
 * UI audit F002/F013, replacing the 10-21 one-line rule). Until that answer is
 * in, no card shows the badge or the dim and no switched card links (F009,
 * owner UI audit 11-09; links still fail closed, useSectionsOpen). An OPEN
 * section's card links to its Browse
 * page (or sign-up, returning there, for a section behind sign-in).
 *
 * Copy states only what the app does today (lead, LANDING-APPROVED.md): no
 * price-drop timing, no fee or speed figures beyond the real rules
 * (APPROVAL_WINDOW_HOURS is the cron's own number: past it Helpr support steps in, nothing
 * releases on a timer, owner 2026-10-23), photo proof as the poster's
 * per-job choice (photoProofRequired), no other company or vendor named, and
 * copy for both sides (design spec v2 §1.4, §1.7). All four cards are equal.
 */
const COPY: Record<SectionKey, string> = {
  jobs: "Hire local help, or find work nearby. Your payment is held until the work is done.",
  declutter: "Sell to neighbors or find a deal. Offers and checkout are built in.",
  shops: "Shop Louisiana makers, or open your own shop. Orders and payments in one place.",
  homes: "Rent from local owners, or list a home you own, in the app you already use.",
};

/**
 * Where an open section's card goes. Jobs: the public guest board, which a
 * signed-out visitor can read. Declutter: its own Browse, which a guest reads
 * too while Declutter is open to everyone (BUY-16, DeclutterGuestOrMember; the
 * card only links once that answer is in), so "Browse Declutter" goes straight
 * there, never through sign-up (owner 11-04). Shops and Homes sit behind
 * sign-in (ProtectedRoute), so a signed-out visitor goes to sign-up with the
 * section as the return path ("Join to browse Shops"), never a login wall; a
 * signed-in visitor's click goes straight to the section (cardClick below).
 */
export function cardLinkFor(key: SectionKey, path: string, label: string): { to: string; text: string; signedIn: string } {
  if (key === "jobs") return { to: "/browse", text: "Browse jobs", signedIn: path };
  if (key === "declutter") return { to: path, text: `Browse ${label}`, signedIn: path };
  return { to: `/signup?redirect=${encodeURIComponent(path)}`, text: `Join to browse ${label}`, signedIn: path };
}

const H2_CLASS = "font-display landing-serif text-balance leading-[1.05] text-ds-28";

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

/** The four section cards. */
export function SectionsShowcase() {
  const ref = useRef<HTMLElement>(null);
  const seen = useSeenAfterLoad(ref);
  // No ID claim while the ID check is off (switch `identity_check`, owner 2026-10-23). L010 (landing audit 11-09): read
  // for THIS viewer, guests included (useIdCheckOnForViewer; a guest read it as off while it is on for everyone).
  const idOn = useIdCheckOnForViewer();
  const { open } = useSectionsOpen(seen);
  // F009 (owner UI audit 11-09, High): while the answer is pending, no "Coming soon" at all. It sat over the live
  // Declutter for ~2.7 s on a first visit, then jumped. Until the answer is in, no card is badged or dimmed; the
  // switched cards still have no link (fails closed: never a link to a section not yet known open).
  const pending = open === null;
  const navigate = useNavigate();

  // One list in sectionsConfig's order, which never changes when the switch answer comes in (so no card moves); each
  // card says for itself whether it is open (owner 11-09, F002/F013).
  const cards = SECTIONS.map((s) => {
    const Icon = s.icon;
    const soon = sectionIsComingSoon(s.feature, open);
    const badged = soon && !pending;
    const link = cardLinkFor(s.key, s.path, s.navLabel);
    // All four sections are equal (design spec v2 §1): one card style, the white landing card with its soft shadow
    // (UI audit F004, 11-09: the How a job works cards' surface). A section not open yet is slightly dimmed and carries
    // its own "Coming soon" badge (owner 11-09, F002/F013, replacing the 10-21 one-line rule).
    const card = (
      <li
        key={s.key}
        className="landing-card relative p-6 flex flex-col gap-3 min-h-[14rem] lg:min-h-[17rem] min-w-0"
        style={{ color: "var(--lp-ink)", ...(badged ? { opacity: 0.8 } : null) }}
        data-section={s.key}
        data-soon={badged ? "true" : "false"}
      >
        <div className="flex items-start justify-between gap-3">
          <Icon className="w-6 h-6" aria-hidden style={{ color: "var(--lp-action-strong)" }} />
          {badged && (
            <span
              className="inline-flex items-center rounded-full px-2.5 py-1 text-ds-12 font-semibold leading-none"
              style={{ background: "var(--lp-ground)", color: "var(--lp-ink)", border: "1px solid var(--lp-line-strong)" }}
              data-testid={`landing-soon-${s.key}`}
            >
              Coming soon
            </span>
          )}
        </div>
        <h3 className="text-ds-20 font-bold tracking-tight mt-2">{s.navLabel}</h3>
        <p className="text-ds-15 leading-relaxed" style={{ color: "var(--lp-body)" }}>
          {COPY[s.key]}
        </p>
        {!soon && (
          <Link
            to={link.to}
            onClick={(e) => {
              e.preventDefault();
              void goSignedInOr(navigate, link.signedIn, link.to);
            }}
            className="self-start mt-auto pt-1 inline-flex items-center gap-1.5 min-h-11 text-ds-15 font-bold underline-offset-4 hover:underline after:absolute after:inset-0 after:rounded-[inherit]"
            style={{ color: "var(--lp-action-strong)" }}
            data-testid={`landing-browse-${s.key}`}
          >
            {link.text}
            <ArrowRight className="w-4 h-4" aria-hidden />
          </Link>
        )}
      </li>
    );
    return card;
  });

  return (
    <section ref={ref} id="sections" aria-labelledby="sections-heading" className="px-5 sm:px-8 lg:px-12 pt-12 sm:pt-14 lg:pt-16 pb-12 sm:pb-14 lg:pb-16 scroll-mt-24" style={{ background: "var(--lp-ground)" /* the page ground, so the white cards stand out (lead 11-09, F004) */ }}>
      <div className="mx-auto w-full max-w-6xl flex flex-col gap-8 sm:gap-12">
        <div className="flex flex-col gap-3 max-w-2xl">
          <h2 id="sections-heading" className={H2_CLASS} style={{ color: "var(--lp-ink)" }}>
            Four ways to get things done. One account.
          </h2>
          <p className="text-ds-15 sm:text-ds-17" style={{ color: "var(--lp-body)" }}>
            {idOn ? "Verify your ID once and it counts everywhere on Helpr." : "Jobs and Declutter are open today. Shops and Homes are on the way."}
          </p>
        </div>
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="landing-sections" aria-label="Sections">
          {cards}
        </ul>
      </div>
    </section>
  );
}

const MONEY_STEPS: { icon: LucideIcon; title: string; body: string; done?: boolean }[] = [
  { icon: CreditCard, title: "Paid through Helpr", body: "The full price is shown before anyone pays." },
  { icon: Lock, title: "Held safely", body: "Helpr holds the money. Nobody is paid out until the work is done." },
  { icon: Camera, title: "Before and after photos", body: "The person hiring can ask for photo proof, so everyone can see it's done right." },
  {
    icon: Check,
    title: "Approved, then released",
    body: `Nothing is paid until the person hiring approves the work or asks for a change. If they haven't answered in ${APPROVAL_WINDOW_HOURS} hours, a real person on our team steps in.`,
    done: true,
  },
];

/** The ID tile while the ID check is on; while it is off (owner 2026-10-23) a true one takes its place. */
const TRUST_ID_ON = { icon: ShieldCheck, title: "ID-verified people", body: "Verify your ID once, and it counts everywhere on Helpr." };
const TRUST_ID_OFF = { icon: ShieldCheck, title: "Real accounts", body: "Every account confirms its email before it posts or takes a job." };
const TRUST: { icon: LucideIcon; title: string; body: string }[] = [
  TRUST_ID_ON,
  { icon: Wallet, title: "No cash to count", body: "Payments happen in the app, so there's no cash changing hands." },
  { icon: Headset, title: "Real human support", body: "A real person on our team answers when something goes wrong." },
  { icon: MapPin, title: "Made in Louisiana", body: "Built in Louisiana, for every parish in it." },
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
      <section aria-labelledby="money-heading" className="px-5 sm:px-8 lg:px-12 py-16 sm:py-20 lg:py-28" style={{ background: "var(--lp-band)", color: "var(--lp-band-body)" }}>
        <div className="mx-auto w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3">
              <p className="text-ds-12 font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--lp-band-money)" }}>
                Your money, protected
              </p>
              <h2 id="money-heading" className="font-display landing-serif text-balance leading-[1.05] text-ds-28" style={{ color: "var(--lp-band-ink)" }}>
                Nobody gets paid until the job is{" "}
                <em style={{ fontStyle: "italic", color: "var(--lp-band-money)" }}>really</em> done.
              </h2>
            </div>
            <ol className="flex flex-col gap-5">
              {MONEY_STEPS.map(({ icon: Icon, title, body, done }) => (
                <li key={title} className="flex items-start gap-4">
                  <span
                    className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                    style={done ? { background: "var(--lp-band-ink)", color: "var(--lp-band)" } : { background: "var(--lp-band-tile)", color: "var(--lp-band-money)" }}
                    aria-hidden
                  >
                    <Icon className="w-[18px] h-[18px]" />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <h3 className="text-ds-15 font-bold" style={{ color: "var(--lp-band-ink)" }}>{title}</h3>
                    <p className="text-ds-13 sm:text-ds-15 leading-relaxed">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
            {/* Owner #7 (11-09): Declutter's money rule beside the jobs' one, one quiet line (OWNER-DECISIONS.md, Declutter
                handover money: the buyer's "I got it" finishes the order and pays the seller; nothing moves before). */}
            <p className="text-ds-13 sm:text-ds-15 leading-relaxed" data-testid="landing-money-declutter">
              On Declutter, the same rule: the seller is paid once the buyer says they got it.
            </p>
          </div>
          <ul className="grid grid-cols-2 gap-2.5 sm:gap-3">
            {TRUST.map((t) => (t === TRUST_ID_ON && !idOn ? TRUST_ID_OFF : t)).map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-[20px] p-4 sm:p-5 flex flex-col gap-2 min-w-0" style={{ background: "var(--lp-band-tile)" }}>
                <Icon className="w-5 h-5" aria-hidden style={{ color: "var(--lp-band-ink)" }} />
                <h3 className="text-ds-14 sm:text-ds-15 font-bold mt-1 [overflow-wrap:anywhere]" style={{ color: "var(--lp-band-ink)" }}>{title}</h3>
                <p className="text-ds-12 sm:text-ds-13 leading-relaxed">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section ref={joinRef} aria-labelledby="join-heading" className="px-5 sm:px-8 lg:px-12 py-20 sm:py-24 lg:py-32">
        <div className="mx-auto w-full max-w-3xl flex flex-col items-center text-center gap-5">
          <h2 id="join-heading" className={H2_CLASS} style={{ color: "var(--lp-ink)" }}>
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
          {/* Owner #7 (11-09): the close names both open sections' first steps, quietly (links, not more buttons). */}
          <nav aria-label="Start here" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-ds-15 font-semibold" data-testid="landing-join-starts">
            <Link to="/browse" className="inline-flex items-center min-h-11 link-standard" style={{ color: "var(--lp-action-strong)" }}>Find work</Link>
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
