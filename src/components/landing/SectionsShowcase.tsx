import { useIdCheckOnForViewer } from "@/lib/useIdCheckOnForViewer";
import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Check, CreditCard, Headset, Lock, MapPin, ShieldCheck, Wallet, type LucideIcon } from "lucide-react";
import { SECTIONS, type SectionKey } from "@/components/sections/sectionsConfig";
import { APPROVAL_WINDOW_HOURS } from "../../../supabase/functions/_shared/escrowTiming";
import { useSectionsOpen, sectionIsComingSoon } from "./useSectionsOpen";
import { goSignedInOr } from "./goSignedInOr";
import { POST_JOB_PATH, POST_JOB_SIGNED_OUT, SELL_PATH, SELL_SIGNED_OUT } from "./HowItWorksSection";
import { whenPageSettled } from "@/lib/routePrefetch";
import { useGuestSpanish } from "./useGuestSpanish";

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
  // D012 (11-10): the landing says "Shop Declutter" everywhere it links to Declutter.
  if (key === "declutter") return { to: path, text: `Shop ${label}`, signedIn: path };
  return { to: `/signup?redirect=${encodeURIComponent(path)}`, text: `Join to browse ${label}`, signedIn: path };
}

/** D002 (landing design audit 11-10): every landing H2 on the middle type step (.landing-h2, 32 -> 48px). */
const H2_CLASS = "font-display landing-serif text-balance landing-h2";

/** D005: the two sections the landing draws as cards; the rest are named in one line while they are on the way. */
export const LANDING_CARD_KEYS: readonly SectionKey[] = ["jobs", "declutter"];

/** "Shops and Homes are on the way." (owner's preview tweak 3, 11-10). */
export function onTheWayLine(labels: string[]): string {
  const names = labels.length <= 1 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${names} ${labels.length === 1 ? "is" : "are"} on the way.`;
}

/**
 * F260q (owner 11-11, Spanish everything): the landing's own English, or the Spanish words (enLanding.ts / esLanding.ts)
 * when the visitor's language is Spanish. The Spanish dictionary is fetched only then (useGuestSpanish), so first paint
 * imports no i18n module.
 */
function useLandingWords() {
  const es = useGuestSpanish();
  const w = (key: string, english: string) => es?.[key] ?? english;
  const onTheWay = (labels: string[]): string => {
    if (!es) return onTheWayLine(labels);
    const names = labels.map((l) => w(`landing.name.${l.toLowerCase()}`, l));
    const joined = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} ${w("landing.and", "and")} ${names[names.length - 1]}`;
    return w(names.length === 1 ? "landing.onTheWayOne" : "landing.onTheWayMany", "{names}").replace("{names}", joined);
  };
  return { w, onTheWay };
}

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
  const { w, onTheWay } = useLandingWords();

  // D005 (landing design audit 11-10): "Four ways" was 1,245px tall at 375, ~465px of it two Coming soon cards. Now two
  // large cards for the sections open today (Jobs, Declutter: a fixed pair, so no card moves when the switch answer
  // comes in), and ONE line naming the sections still on the way. Each card still says for itself whether it is open
  // (owner 11-09, F002/F013).
  const later = SECTIONS.filter((s) => !LANDING_CARD_KEYS.includes(s.key) && sectionIsComingSoon(s.feature, open));
  const cards = SECTIONS.filter((s) => LANDING_CARD_KEYS.includes(s.key)).map((s) => {
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
        className="landing-card relative p-6 lg:p-8 flex flex-col gap-3 min-h-[12rem] lg:min-h-[15rem] min-w-0"
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
              {w("landing.comingSoon", "Coming soon")}
            </span>
          )}
        </div>
        <h3 className="font-display landing-serif text-ds-28 mt-2">{w(`landing.name.${s.key}`, s.navLabel)}</h3>
        <p className="text-ds-15 leading-relaxed" style={{ color: "var(--lp-body)" }}>
          {w(`landing.blurb.${s.key}`, COPY[s.key])}
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
            {s.key === "jobs" ? w("landing.browseJobs", link.text) : s.key === "declutter" ? w("landing.shopDeclutter", link.text) : link.text}
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
            {w("landing.sectionsHeading", "Hire, work, buy and sell. One account.")}
          </h2>
          {idOn && (
            <p className="text-ds-15 sm:text-ds-17" style={{ color: "var(--lp-body)" }}>
              {w("landing.idOnce", "Verify your ID once and it counts everywhere on Helpr.")}
            </p>
          )}
        </div>
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-5" data-testid="landing-sections" aria-label={w("landing.sectionsLabel", "Sections")}>
          {cards}
        </ul>
        {later.length > 0 && (
          <p className="text-ds-15" style={{ color: "var(--lp-body)" }} data-testid="landing-sections-later">
            {onTheWay(later.map((s) => s.navLabel))}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * D009 (landing design audit 11-10): the band made eight claims of equal weight (four steps and four tiles) and left an
 * empty block at 1440. Now one headline that covers jobs AND Declutter (owner's preview tweak 2: the Declutter line is
 * folded in, not a ninth claim), three steps in one row, and one row of trust badges.
 */
const MONEY_STEPS: { icon: LucideIcon; title: string; body: string; key: string }[] = [
  { key: "step1", icon: CreditCard, title: "Paid through Helpr", body: "The full price is shown before anyone pays, and Helpr holds the money." },
  { key: "step2", icon: Lock, title: "Held until it’s done", body: "Nobody is paid out until the work is done, or the buyer says they got the item." },
  {
    key: "step3",
    icon: Check,
    title: "Approved, then released",
    body: `The person hiring approves the work or asks for a change. If they haven’t answered in ${APPROVAL_WINDOW_HOURS} hours, a real person on our team steps in.`,
  },
];

/** The ID badge while the ID check is on; while it is off (owner 2026-10-23) a true one takes its place. */
const TRUST_ID_ON = { icon: ShieldCheck, title: "ID-verified people", key: "id" };
const TRUST_ID_OFF = { icon: ShieldCheck, title: "Every email confirmed", key: "email" };
const TRUST: { icon: LucideIcon; title: string; key: string }[] = [
  TRUST_ID_ON,
  { icon: Wallet, title: "No cash changes hands", key: "cash" },
  { icon: Headset, title: "A real person answers", key: "person" },
  { icon: MapPin, title: "Made in Louisiana", key: "made" },
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
  const { w } = useLandingWords();
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
            {w("landing.moneyHeadline", MONEY_HEADLINE)}
          </h2>
          <ol className="grid grid-cols-1 sm:grid-cols-3 gap-6 lg:gap-10" data-testid="landing-money-steps">
            {MONEY_STEPS.map(({ icon: Icon, title, body, key }) => (
              <li key={title} className="flex flex-col gap-3 min-w-0">
                <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: "var(--lp-band-tile)", color: "var(--lp-band-money)" }} aria-hidden>
                  <Icon className="w-[18px] h-[18px]" />
                </span>
                <h3 className="text-ds-16 font-bold" style={{ color: "var(--lp-band-ink)" }}>{w(`landing.${key}Title`, title)}</h3>
                <p className="text-ds-15 leading-relaxed">{w(`landing.${key}Body`, body).replace("{hours}", String(APPROVAL_WINDOW_HOURS))}</p>
              </li>
            ))}
          </ol>
          <ul className="flex flex-wrap gap-2" data-testid="landing-trust-badges" aria-label={w("landing.trustLabel", "Why it’s safe")}>
            {TRUST.map((t) => (t === TRUST_ID_ON && !idOn ? TRUST_ID_OFF : t)).map(({ icon: Icon, title, key }) => (
              <li key={title} className="inline-flex items-center gap-2 rounded-full px-3.5 min-h-9 text-ds-13 font-semibold" style={{ border: "1px solid var(--lp-band-line)", color: "var(--lp-band-ink)" }}>
                <Icon className="w-4 h-4" aria-hidden style={{ color: "var(--lp-band-money)" }} />
                {w(`landing.trust.${key}`, title)}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section ref={joinRef} aria-labelledby="join-heading" className="px-5 sm:px-8 lg:px-12 py-20 sm:py-24 lg:py-32">
        <div className="mx-auto w-full max-w-3xl flex flex-col items-center text-center gap-5">
          {/* D002 (11-10): the close is one step larger than the section headings (.landing-h2-close, 40 -> 56px). */}
          <h2 id="join-heading" className="font-display landing-serif text-balance landing-h2-close" style={{ color: "var(--lp-ink)" }}>
            {w("landing.joinLead", "Join your neighbors on")}{" "}
            <em style={{ fontStyle: "italic", color: "var(--lp-action-strong)" }}>Helpr.</em>
          </h2>
          <p className="max-w-xl text-ds-15 sm:text-ds-17" style={{ color: "var(--lp-body)" }}>{w("landing.joinSub", "One free account for jobs and Declutter.")}</p>
          <div className="mt-2 w-full flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
            <Link
              to="/signup"
              onClick={goToAccount}
              className="btn-grad-primary inline-flex items-center justify-center gap-2 h-14 w-full sm:w-auto px-8 rounded-full text-ds-15 font-semibold"
              data-testid="landing-signup"
            >
              {w("landing.createAccount", "Create your free account")}
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
          <nav aria-label={w("landing.startHere", "Start here")} className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-ds-15 font-semibold" data-testid="landing-join-starts">
            <Link to="/browse" className="inline-flex items-center min-h-11 link-standard" style={{ color: "var(--lp-action-strong)" }}>{w("landing.browseJobs", "Browse jobs")}</Link>
            <Link to={POST_JOB_SIGNED_OUT} onClick={(e) => { e.preventDefault(); void goSignedInOr(navigate, POST_JOB_PATH, POST_JOB_SIGNED_OUT); }} className="inline-flex items-center min-h-11 link-standard" style={{ color: "var(--lp-action-strong)" }}>{w("landing.postJob", "Post a job")}</Link>
            <Link to="/declutter" className="inline-flex items-center min-h-11 link-standard" style={{ color: "var(--lp-action-strong)" }}>{w("landing.shopDeclutter", "Shop Declutter")}</Link>
            <Link to={SELL_SIGNED_OUT} onClick={(e) => { e.preventDefault(); void goSignedInOr(navigate, SELL_PATH, SELL_SIGNED_OUT); }} className="inline-flex items-center min-h-11 link-standard" style={{ color: "var(--lp-action-strong)" }}>{w("landing.sell", "Sell something")}</Link>
          </nav>
          <Link to="/login" className="inline-flex items-center min-h-11 text-ds-15 font-bold underline underline-offset-4" style={{ color: "var(--lp-action-strong)" }}>
            {w("landing.memberLogin", "Already a member? Log in")}
          </Link>
        </div>
      </section>
    </>
  );
}
