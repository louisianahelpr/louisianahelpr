import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check, Camera, CreditCard, Headset, Lock, MapPin, ShieldCheck, Wallet, type LucideIcon } from "lucide-react";
import { SECTIONS, type SectionKey } from "@/components/sections/sectionsConfig";
import { APPROVAL_WINDOW_HOURS } from "../../../supabase/functions/_shared/escrowTiming";
import { useSectionsOpen, sectionIsComingSoon } from "./useSectionsOpen";
import { goSignedInOr } from "./goSignedInOr";

const LandingAppleButton = lazy(() => import("./LandingAppleButton"));

/**
 * The landing page below the hero (owner-approved redesign, 2026-10-20): the
 * four section cards, then (after How a job works) the money band and the join
 * block. A section whose switch is not open to everyone has no link and sits
 * under ONE "Opening soon" line with the others not yet open (owner 2026-10-21),
 * and so does every switched section until that answer is in (fails closed,
 * useSectionsOpen). An OPEN section's card links to its Browse
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
  declutter: "Sell to neighbors or find a deal. Offers and checkout happen in the app.",
  shops: "Shop Louisiana makers, or open your own shop. Orders and payments in one place.",
  homes: "Rent from local owners, or list a home you own, in the app you already use.",
};

/**
 * Where an open section's card goes. Jobs: the public guest board, which a
 * signed-out visitor can read. Declutter, Shops and Homes sit behind sign-in
 * (ProtectedRoute), so a signed-out visitor goes to sign-up with the section
 * as the return path ("Join to browse Shops"), never a login wall; a signed-in
 * visitor's click goes straight to the section (cardClick below).
 */
export function cardLinkFor(key: SectionKey, path: string, label: string): { to: string; text: string; signedIn: string } {
  if (key === "jobs") return { to: "/browse", text: "Browse jobs", signedIn: path };
  return { to: `/signup?redirect=${encodeURIComponent(path)}`, text: `Join to browse ${label}`, signedIn: path };
}

const H2_CLASS = "font-display landing-serif text-balance leading-[1.05] text-ds-32 sm:text-[44px] lg:text-[52px]";

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
  // No ID claim while the ID check is off (switch `identity_check`, owner 2026-10-23).
  const idOn = useIdentityCheckOnStore();
  const ref = useRef<HTMLElement>(null);
  const seen = useSeenAfterLoad(ref);
  const { open } = useSectionsOpen(seen);
  const navigate = useNavigate();

  const cards = SECTIONS.map((s) => {
    const Icon = s.icon;
    const soon = sectionIsComingSoon(s.feature, open);
    const link = cardLinkFor(s.key, s.path, s.navLabel);
    // All four sections are equal (design spec v2 §1): one card style.
    const card = (
      <li
        key={s.key}
        className="relative rounded-[20px] p-6 flex flex-col gap-3 min-h-[14rem] lg:min-h-[17rem] min-w-0"
        style={{ background: "var(--lp-ground)", color: "var(--lp-ink)" }}
        data-section={s.key}
        data-soon={soon ? "true" : "false"}
      >
        <Icon className="w-6 h-6" strokeWidth={1.6} aria-hidden style={{ color: "var(--lp-action-strong)" }} />
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
            <ArrowRight className="w-4 h-4" strokeWidth={1.75} aria-hidden />
          </Link>
        )}
      </li>
    );
    return { soon, card };
  });
  const openCards = cards.filter((c) => !c.soon);
  const soonCards = cards.filter((c) => c.soon);

  return (
    <section ref={ref} id="sections" aria-labelledby="sections-heading" className="px-5 sm:px-8 lg:px-12 pt-12 sm:pt-14 lg:pt-16 pb-16 sm:pb-20 lg:pb-28 scroll-mt-24" style={{ background: "var(--lp-surface)" }}>
      <div className="mx-auto w-full max-w-6xl flex flex-col gap-8 sm:gap-12">
        <div className="flex flex-col gap-3 max-w-2xl">
          <h2 id="sections-heading" className={H2_CLASS} style={{ color: "var(--lp-ink)" }}>
            Four ways to get things done. One account.
          </h2>
          <p className="text-ds-15 sm:text-ds-17" style={{ color: "var(--lp-body)" }}>
            {idOn ? "Verify your ID once and it counts everywhere on Helpr." : "One account works in every section of Helpr."}
          </p>
        </div>
        {/* Owner 2026-10-21: ONE "Opening soon" line above the unopened cards, never a
            pill on each. The open cards come first; the line names the group, so it
            moves with the switches (fail closed: a section is "soon" until its answer
            is in). At lg the four cards share one row, the open ones on the left:
            the line takes its own grid row above the unopened cards, so every
            card top lines up (lead look, 2026-10-21). */}
        <div
          className={`grid grid-cols-1 lg:grid-cols-4 gap-4${soonCards.length > 0 ? " lg:[grid-template-rows:auto_1fr]" : ""}`}
          data-testid="landing-sections"
          style={{ "--open-n": openCards.length, "--soon-n": soonCards.length, "--soon-start": openCards.length + 1 } as React.CSSProperties}
        >
          <ul
            className={`grid grid-cols-1 gap-4 md:[grid-template-columns:repeat(var(--open-n),minmax(0,1fr))] lg:[grid-column:span_var(--open-n)]${soonCards.length > 0 ? " lg:row-start-2" : ""}`}
            aria-label="Open now"
          >
            {openCards.map((c) => c.card)}
          </ul>
          {soonCards.length > 0 && (
            <div className="mt-4 flex flex-col gap-3 min-w-0 lg:contents">
              <p
                id="sections-soon"
                className="text-ds-15 font-semibold lg:row-start-1 lg:[grid-column:var(--soon-start)/-1]"
                style={{ color: "var(--lp-body)" }}
                data-testid="landing-sections-soon"
              >
                Opening soon
              </p>
              <ul
                aria-labelledby="sections-soon"
                className="grid grid-cols-1 gap-4 md:[grid-template-columns:repeat(var(--soon-n),minmax(0,1fr))] lg:row-start-2 lg:[grid-column:var(--soon-start)/-1]"
              >
                {soonCards.map((c) => c.card)}
              </ul>
            </div>
          )}
        </div>
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

/** The money band + the join block. "Create your free account" is the close's one primary. */
export function TrustAndJoin() {
  const idOn = useIdentityCheckOnStore();
  const navigate = useNavigate();
  const joinRef = useRef<HTMLElement>(null);
  const joinSeen = useSeenAfterLoad(joinRef);
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
              <h2 id="money-heading" className="font-display landing-serif text-balance leading-[1.05] text-ds-32 sm:text-[44px] lg:text-[46px]" style={{ color: "var(--lp-band-ink)" }}>
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
                    <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <h3 className="text-ds-15 font-bold" style={{ color: "var(--lp-band-ink)" }}>{title}</h3>
                    <p className="text-ds-13 sm:text-ds-15 leading-relaxed">{body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <ul className="grid grid-cols-2 gap-2.5 sm:gap-3">
            {TRUST.map((t) => (t === TRUST_ID_ON && !idOn ? TRUST_ID_OFF : t)).map(({ icon: Icon, title, body }) => (
              <li key={title} className="rounded-[20px] p-4 sm:p-5 flex flex-col gap-2 min-w-0" style={{ background: "var(--lp-band-tile)" }}>
                <Icon className="w-5 h-5" strokeWidth={1.75} aria-hidden style={{ color: "var(--lp-band-ink)" }} />
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
          <p className="max-w-xl text-ds-15 sm:text-ds-17" style={{ color: "var(--lp-body)" }}>One free account. Jobs are open now.</p>
          <div className="mt-2 w-full flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <Link
              to="/signup"
              onClick={goToAccount}
              className="btn-grad-primary inline-flex items-center justify-center gap-2 h-14 w-full sm:w-auto px-8 rounded-full text-ds-15 font-semibold"
              data-testid="landing-signup"
            >
              Create your free account
            </Link>
            {joinSeen && (
              <Suspense fallback={null}>
                <LandingAppleButton />
              </Suspense>
            )}
          </div>
          <Link to="/login" className="inline-flex items-center min-h-11 text-ds-15 font-bold underline underline-offset-4" style={{ color: "var(--lp-action-strong)" }}>
            Already a member? Log in
          </Link>
        </div>
      </section>
    </>
  );
}
