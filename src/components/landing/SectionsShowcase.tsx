import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Headset, Lock, ShieldCheck, type LucideIcon } from "lucide-react";
import { SECTIONS, type SectionKey } from "@/components/sections/sectionsConfig";
import { useSectionsOpen, sectionIsComingSoon } from "./useSectionsOpen";
import { goSignedInOr } from "./goSignedInOr";

/**
 * The landing page below the hero (owner, 2026-10-19): one block per section
 * (what it does, why switch), the trust row, and one sign-up action (the hero's;
 * the close repeats it as a text link). A section whose switch is not open to
 * everyone says "coming soon", and so does every switched section until that
 * answer is in (fails closed, useSectionsOpen). An OPEN section's card links to
 * its Browse page (or sign-up, returning there, for a section behind sign-in).
 * Copy states only what the app does today; no fee or speed figures, and no
 * other company named (owner, 2026-10-20: the "Instead of ..." lines are gone).
 */
const COPY: Record<SectionKey, { what: string; why: string }> = {
  jobs: {
    what: "Hire local help, or find work nearby.",
    why: "Local people apply to your job, and your payment is held until the work is done.",
  },
  declutter: {
    what: "Sell what you no longer need to neighbors, or find a deal.",
    why: "Offers and checkout happen in the app, so there is no cash to count.",
  },
  shops: {
    what: "Shop Louisiana makers and small businesses, or open your own shop.",
    why: "Your shop page, your orders and your payments live in one place.",
  },
  homes: {
    what: "Find a place to rent, or list a home you own.",
    why: "Local rentals and the people who own them, in the same app you already use.",
  },
};

const TRUST: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Headset, title: "Real human support", body: "A real person on our team answers when something goes wrong, in every section." },
  { icon: ShieldCheck, title: "ID-verified people", body: "Members verify their ID once, and it counts everywhere on Helpr." },
  { icon: Lock, title: "Secure payments", body: "You pay through Helpr with Stripe and see the full price before you pay." },
];

/**
 * Where an open section's card goes. Jobs: the public guest board, which a
 * signed-out visitor can read. Declutter, Shops and Homes sit behind sign-in
 * (ProtectedRoute), so a signed-out visitor goes to sign-up with the section
 * as the return path ("Join to browse Shops"), never a login wall; a signed-in
 * visitor's click goes straight to the section (cardClick below).
 */
export function cardLinkFor(key: SectionKey, path: string, label: string): { to: string; text: string; signedIn: string } {
  if (key === "jobs") return { to: "/browse", text: `Browse ${label}`, signedIn: path };
  return { to: `/signup?redirect=${encodeURIComponent(path)}`, text: `Join to browse ${label}`, signedIn: path };
}

const H2_STYLE = { fontSize: "clamp(2rem, 3.4vw, 3.25rem)", letterSpacing: "-0.025em", color: "hsl(var(--ink-deep))" } as const;

/** The four section blocks. */
export function SectionsShowcase() {
  const ref = useRef<HTMLElement>(null);
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
  }, []);
  const { open } = useSectionsOpen(seen);
  const navigate = useNavigate();

  return (
    <section ref={ref} id="sections" aria-labelledby="sections-heading" className="px-5 sm:px-8 lg:px-12 pt-12 sm:pt-20 lg:pt-28 pb-6 scroll-mt-24">
        <div className="mx-auto page-measure flex flex-col gap-8 sm:gap-12">
          <div className="text-center flex flex-col gap-3 items-center">
            <h2 id="sections-heading" className="font-display font-bold text-balance leading-[1.05]" style={H2_STYLE}>
              Four sections. One account.
            </h2>
            <p className="max-w-2xl text-ds-15 sm:text-ds-17 text-muted-foreground text-balance">
              Jobs, Declutter, Shops and Homes share one profile, one sign-in and one verified ID.
            </p>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5" data-testid="landing-sections">
            {SECTIONS.map((s) => {
              const c = COPY[s.key];
              const Icon = s.icon;
              const soon = sectionIsComingSoon(s.feature, open);
              const link = cardLinkFor(s.key, s.path, s.navLabel);
              return (
                <li key={s.key} className="liquid-glass relative p-6 sm:p-7 flex flex-col gap-3" data-section={s.key} data-soon={soon ? "true" : "false"}>
                  {soon && (
                    <span className="absolute top-5 right-5 rounded-full px-2.5 py-1 text-ds-12 font-semibold bg-[hsl(var(--bark)/0.1)] text-[hsl(var(--bark))]">
                      Coming soon
                    </span>
                  )}
                  <span className="w-12 h-12 rounded-2xl bg-[hsl(var(--bark)/0.1)] text-[hsl(var(--bark))] flex items-center justify-center" aria-hidden>
                    <Icon className="w-6 h-6" strokeWidth={1.75} />
                  </span>
                  <h3 className="text-ds-22 font-bold tracking-tight text-foreground">{s.navLabel}</h3>
                  <p className="text-ds-17 font-semibold text-foreground leading-snug">{c.what}</p>
                  <p className="text-ds-15 text-muted-foreground leading-relaxed">{c.why}</p>
                  {!soon && (
                    <Link
                      to={link.to}
                      onClick={(e) => {
                        e.preventDefault();
                        void goSignedInOr(navigate, link.signedIn, link.to);
                      }}
                      className="self-start mt-auto pt-1 inline-flex items-center gap-1.5 text-ds-15 font-semibold text-[hsl(var(--bark))] underline-offset-4 hover:underline after:absolute after:inset-0 after:rounded-[inherit]"
                      data-testid={`landing-browse-${s.key}`}
                    >
                      {link.text}
                      <ArrowRight className="w-4 h-4" strokeWidth={1.75} aria-hidden />
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
    </section>
  );
}

/** Trust row + the close: the hero's sign-up action repeated as a TEXT link, so the page keeps ONE primary button. */
export function TrustAndJoin() {
  const navigate = useNavigate();
  // Same routing as the hero's goToAccount: a signed-in visitor lands on Home, never on the sign-up form.
  const goToAccount = (e: React.MouseEvent) => {
    e.preventDefault();
    void goSignedInOr(navigate, "/home", "/signup");
  };
  return (
    <>
      <section aria-labelledby="trust-heading" className="px-5 sm:px-8 lg:px-12 pt-12 sm:pt-20 pb-6">
        <div className="mx-auto page-measure flex flex-col gap-8">
          <h2 id="trust-heading" className="font-display font-bold text-balance leading-[1.05] text-center" style={H2_STYLE}>
            Local, and safe.
          </h2>
          <ul className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
            {TRUST.map(({ icon: Icon, title, body }) => (
              <li key={title} className="liquid-glass p-6 flex flex-col gap-2">
                <Icon className="w-6 h-6 text-[hsl(var(--bark))]" strokeWidth={1.75} aria-hidden />
                <h3 className="text-ds-17 font-bold text-foreground">{title}</h3>
                <p className="text-ds-15 text-muted-foreground leading-relaxed">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="join-heading" className="px-5 sm:px-8 lg:px-12 pt-12 sm:pt-20 pb-16 sm:pb-28">
        <div className="mx-auto page-measure liquid-glass px-6 py-10 sm:py-14 flex flex-col items-center text-center gap-5">
          <h2 id="join-heading" className="font-display font-bold text-balance leading-[1.05]" style={H2_STYLE}>
            Join your neighbors on Helpr.
          </h2>
          <p className="max-w-xl text-ds-15 sm:text-ds-17 text-muted-foreground text-balance">One free account for Jobs, Declutter, Shops and Homes.</p>
          <Link
            to="/signup"
            onClick={goToAccount}
            className="inline-flex items-center justify-center gap-2 min-h-11 text-ds-17 font-semibold text-[hsl(var(--bark))] underline-offset-4 hover:underline"
            data-testid="landing-join"
          >
            Create your free account
            <ArrowRight className="w-5 h-5" strokeWidth={1.75} aria-hidden />
          </Link>
          <Link to="/login" className="text-ds-15 font-semibold text-[hsl(var(--bark))] underline-offset-4 hover:underline">
            Already a member? Log in
          </Link>
        </div>
      </section>
    </>
  );
}
