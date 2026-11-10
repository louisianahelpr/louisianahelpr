/**
 * The 25 Days sponsor page's sections A-K and M-O (owner spec 2026-11-09).
 * Section L, Claim Your Day, is ClaimSection.tsx. Every word comes from
 * src/content/sponsorPage.ts; anything still holding a [placeholder] is
 * hidden (src/lib/sponsor/placeholders.ts), except in the local dev preview
 * with ?demo=1&placeholders=1, which shows it highlighted for the owner.
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { sponsorPage as C } from "@/content/sponsorPage";
import { countdown } from "@/lib/sponsor/dates";
import { sponsorSignupsOpen } from "../../../supabase/functions/_shared/sponsorSignup";
import { filledUrl, hasPlaceholder, placeholderRuns, statNumber } from "@/lib/sponsor/placeholders";
import type { SponsorPublicState, SponsorStatKey } from "@/lib/sponsor/types";
import { prefersReducedMotion } from "./confetti";
import { FleurDeLis, GiftBox, Icon, Magnolia, Sparkle } from "./Decor";
import { Button } from "@/components/ui/button";

/** Dev preview only: show [placeholders] highlighted instead of hiding them. */
export const PlaceholderPreview = createContext(false);

/** Renders text, or (preview only) text with its [placeholders] highlighted; null when hidden. */
function useShow(text: string | null | undefined): boolean {
  const preview = useContext(PlaceholderPreview);
  return preview || !hasPlaceholder(text);
}

function Txt({ text }: { text: string }) {
  const preview = useContext(PlaceholderPreview);
  if (!preview || !hasPlaceholder(text)) return <>{text}</>;
  return (
    <>
      {placeholderRuns(text).map((r, i) => (r.placeholder ? <mark key={i} className="lh25-ph">{r.text}</mark> : <span key={i}>{r.text}</span>))}
    </>
  );
}

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
}

function SectionTitle({ children, kicker }: { children: ReactNode; kicker?: ReactNode }) {
  return (
    <div className="lh25-section-title">
      {kicker ? <div className="lh25-kicker">{kicker}</div> : null}
      <h2>{children}</h2>
      <div className="lh25-title-rule" aria-hidden="true">
        <span /> <FleurDeLis size={18} /> <span />
      </div>
    </div>
  );
}

function ExternalButton({ href, icon, children, variant = "outline" }: { href: string; icon: string; children: ReactNode; variant?: "outline" | "solid" }) {
  return (
    <a className={`lh25-btn lh25-btn-${variant}`} href={href} target="_blank" rel="noopener noreferrer">
      <Icon name={icon} size={18} /> <span>{children}</span>
    </a>
  );
}

/* ── A) HERO ─────────────────────────────────────────────────────────── */

function Countdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const c = countdown(now);
  if (c.phase === "over") return null;
  if (c.phase === "live") {
    return <p className="lh25-countdown-live">{C.hero.countdownLive.replace("{day}", String(c.liveDay))}</p>;
  }
  const u = C.hero.countdownUnits;
  const cells: Array<[number, string]> = [[c.days, u.days], [c.hours, u.hours], [c.minutes, u.minutes], [c.seconds, u.seconds]];
  return (
    <div className="lh25-countdown" role="timer" aria-label={`${C.hero.countdownLabel} ${c.days} ${u.days}`}>
      <div className="lh25-countdown-label">{C.hero.countdownLabel}</div>
      <div className="lh25-countdown-cells" aria-hidden="true">
        {cells.map(([n, label]) => (
          <div className="lh25-countdown-cell" key={label}>
            <span className="lh25-countdown-num">{String(n).padStart(2, "0")}</span>
            <span className="lh25-countdown-unit">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Hero({ greetingBrand }: { greetingBrand: string | null }) {
  return (
    <header className="lh25-hero">
      <Sparkle className="lh25-float lh25-f1" size={22} />
      <Sparkle className="lh25-float lh25-f2" size={14} color="#C8102E" />
      <Sparkle className="lh25-float lh25-f3" size={18} color="#1E8E3E" />
      <Magnolia className="lh25-hero-magnolia" size={70} />
      <GiftBox className="lh25-hero-gift" size={58} />
      <div className="lh25-hero-inner">
        <img className="lh25-logo" src="/helpr-logo-transparent-192.png" width={84} height={84} alt="Louisiana Helpr" />
        {greetingBrand ? (
          <p className="lh25-greeting" data-testid="sponsor-greeting">{C.hero.greeting.replace("{brand}", greetingBrand)}</p>
        ) : null}
        <p className="lh25-eyebrow">{C.hero.eyebrow}</p>
        <h1 className="lh25-h1">
          <span className="lh25-h1-lead">{C.hero.headlineLead}</span>
          <span className="lh25-h1-main">{C.hero.headline}</span>
        </h1>
        <p className="lh25-subhead">{C.hero.subhead}</p>
        <div className="lh25-hero-ctas">
          <Button type="button" variant="ghost" className="lh25-btn lh25-btn-primary" onClick={() => scrollToId("claim")}>{C.hero.primaryCta}</Button>
          <Button type="button" variant="ghost" className="lh25-btn lh25-btn-outline" onClick={() => scrollToId("how")}>{C.hero.secondaryCta}</Button>
        </div>
        <Countdown />
        {sponsorSignupsOpen(Date.now(), C.event.signup_deadline) ? <p className="lh25-deadline">{C.hero.deadline}</p> : null}
      </div>
    </header>
  );
}

/* ── B) TRUST STRIP ──────────────────────────────────────────────────── */

export function TrustStrip() {
  return (
    <ul className="lh25-trust" aria-label="About us">
      {C.trustStrip.map((t) => (
        <li key={t}><Icon name="check" size={16} /> {t}</li>
      ))}
    </ul>
  );
}

/* ── C) WHAT IS LOUISIANA HELPR ──────────────────────────────────────── */

export function About() {
  const preview = useContext(PlaceholderPreview);
  const group = filledUrl(C.links.facebookGroup);
  return (
    <section className="lh25-section" aria-labelledby="lh25-about">
      <SectionTitle><span id="lh25-about">{C.about.title}</span></SectionTitle>
      <p className="lh25-lede">{C.about.body}</p>
      <div className="lh25-grid3">
        {C.about.features.map((f) => {
          const inner = (
            <>
              <span className="lh25-icon-badge"><Icon name={f.icon} /></span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
              {f.href ? <span className="lh25-card-link">Take a look →</span> : <span className="lh25-soon">{f.soonLabel}</span>}
            </>
          );
          return f.href ? (
            <Link key={f.title} to={f.href} className="lh25-card lh25-card-link-wrap">{inner}</Link>
          ) : (
            <div key={f.title} className="lh25-card">{inner}</div>
          );
        })}
      </div>
      <div className="lh25-btn-row">
        {group ? <ExternalButton href={group} icon="facebook" variant="solid">{C.about.groupButton}</ExternalButton> : null}
        {!group && preview ? <span className="lh25-btn lh25-btn-outline"><mark className="lh25-ph">{C.about.groupButton} {C.links.facebookGroup}</mark></span> : null}
        <ExternalButton href={C.links.facebookPage} icon="facebook">{C.about.pageButton}</ExternalButton>
        <ExternalButton href={C.links.website} icon="globe">{C.about.websiteButton}</ExternalButton>
      </div>
    </section>
  );
}

/* ── D) FOUNDER ──────────────────────────────────────────────────────── */

export function Founder({ photoUrl }: { photoUrl: string | null }) {
  const preview = useContext(PlaceholderPreview);
  const paragraphs = C.founder.paragraphs.filter((p) => preview || !hasPlaceholder(p));
  return (
    <section className="lh25-section lh25-founder" aria-labelledby="lh25-founder">
      <div className="lh25-founder-card">
        {photoUrl ? (
          <img className="lh25-founder-photo" loading="lazy" decoding="async" src={photoUrl} alt={C.founder.photoAlt} width={150} height={150} />
        ) : preview ? (
          <div className="lh25-founder-photo lh25-founder-photo-empty"><mark className="lh25-ph">[PHOTO OF LEXI]</mark></div>
        ) : null}
        <div>
          <h2 id="lh25-founder" className="lh25-founder-title">{C.founder.title}</h2>
          {paragraphs.map((p) => <p key={p}><Txt text={p} /></p>)}
          <p className="lh25-signature">
            {C.founder.signature} · <a href={`mailto:${C.links.email}`}>{C.links.email}</a>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── E) HOW IT WORKS ─────────────────────────────────────────────────── */

export function HowItWorks() {
  return (
    <section className="lh25-section" id="how" aria-labelledby="lh25-how">
      <SectionTitle><span id="lh25-how">{C.howItWorks.title}</span></SectionTitle>
      <ol className="lh25-steps">
        {C.howItWorks.steps.map((s, i) => (
          <li key={s.title} className="lh25-card lh25-step">
            <span className="lh25-step-num" aria-hidden="true">{i + 1}</span>
            <span className="lh25-icon-badge lh25-icon-badge-green"><Icon name={s.icon} /></span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ── F) WHAT YOUR BRAND GETS ─────────────────────────────────────────── */

export function BrandGets() {
  const preview = useContext(PlaceholderPreview);
  const items = C.brandGets.items.filter((i) => preview || (!hasPlaceholder(i.title) && !hasPlaceholder(i.body)));
  return (
    <section className="lh25-section lh25-gingham-bg" aria-labelledby="lh25-gets">
      <SectionTitle><span id="lh25-gets">{C.brandGets.title}</span></SectionTitle>
      <div className="lh25-grid-gets">
        {items.map((i) => (
          <div key={i.title} className="lh25-card">
            <span className="lh25-icon-badge lh25-icon-badge-gold"><Icon name={i.icon} /></span>
            <h3>{i.title}</h3>
            <p><Txt text={i.body} /></p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── G) WHAT WE ASK ──────────────────────────────────────────────────── */

export function WhatWeAsk() {
  return (
    <section className="lh25-section" aria-labelledby="lh25-ask">
      <div className="lh25-ask">
        <GiftBox size={52} box="#5B2A86" />
        <div>
          <h2 id="lh25-ask">{C.whatWeAsk.title}</h2>
          <p>{C.whatWeAsk.body}</p>
        </div>
      </div>
    </section>
  );
}

/* ── H) OUR REACH ────────────────────────────────────────────────────── */

function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(() => (prefersReducedMotion() ? to : 0));
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      setN(to);
      return;
    }
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      const start = performance.now();
      const step = (t: number) => {
        const k = Math.min(1, (t - start) / 1200);
        setN(Math.round(to * (1 - Math.pow(1 - k, 3))));
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to]);
  return <span ref={ref}>{n.toLocaleString("en-US")}</span>;
}

/** The stats that are filled in (admin value wins over the content file). Exported for its test. */
export function filledStats(stats: SponsorPublicState["stats"]): Array<{ key: SponsorStatKey; value: number; label: string }> {
  const out: Array<{ key: SponsorStatKey; value: number; label: string }> = [];
  for (const s of C.reach.stats) {
    const v = statNumber(stats[s.key as SponsorStatKey], s.value);
    if (v !== null) out.push({ key: s.key as SponsorStatKey, value: v, label: s.label });
  }
  return out;
}

export function Reach({ stats }: { stats: SponsorPublicState["stats"] }) {
  const shown = filledStats(stats);
  if (shown.length === 0) return null;
  return (
    <section className="lh25-section" aria-labelledby="lh25-reach">
      <SectionTitle><span id="lh25-reach">{C.reach.title}</span></SectionTitle>
      <div className="lh25-stats">
        {shown.map((s) => (
          <div key={s.key} className="lh25-stat">
            <span className="lh25-stat-num"><CountUp to={s.value} /></span>
            <span className="lh25-stat-label">{s.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ── I) PREVIEW ──────────────────────────────────────────────────────── */

export function PreviewCard() {
  const dayLine = C.preview.cardDayLine.replace("{day}", C.preview.sampleDay);
  return (
    <section className="lh25-section" aria-labelledby="lh25-preview">
      <SectionTitle><span id="lh25-preview">{C.preview.title}</span></SectionTitle>
      <p className="lh25-lede lh25-center">{C.preview.note}</p>
      <figure className="lh25-preview">
        <div className="lh25-preview-art">
          <Sparkle className="lh25-pa-s1" size={20} />
          <Sparkle className="lh25-pa-s2" size={14} color="#fff" />
          <FleurDeLis className="lh25-pa-fdl" size={30} />
          <p className="lh25-preview-day">{dayLine}</p>
          <div className="lh25-preview-logo">{C.preview.logoPlaceholder}</div>
          <p className="lh25-preview-sponsor">{C.preview.cardSponsorLine}</p>
          <GiftBox className="lh25-pa-gift" size={40} box="#1E8E3E" />
        </div>
        <figcaption className="lh25-preview-caption">{C.preview.caption}</figcaption>
      </figure>
    </section>
  );
}

/* ── J) SPONSOR WALL ─────────────────────────────────────────────────── */

export function SponsorWall({ wall, logoUrl }: { wall: SponsorPublicState["wall"]; logoUrl: (id: string) => string }) {
  if (wall.length === 0) return null;
  return (
    <section className="lh25-section" aria-labelledby="lh25-wall">
      <SectionTitle><span id="lh25-wall">{C.sponsorWall.title}</span></SectionTitle>
      <ul className="lh25-wall">
        {wall.map((s) => {
          const body = s.hasLogo ? (
            <img loading="lazy" decoding="async" src={logoUrl(s.id)} alt={s.brand} width={96} height={96} />
          ) : (
            <span className="lh25-wall-name">{s.brand}</span>
          );
          const site = filledUrl(s.website);
          return (
            <li key={s.id} className="lh25-wall-tile">
              {site ? <a href={site} target="_blank" rel="noopener noreferrer nofollow" title={s.brand}>{body}</a> : body}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ── K) TESTIMONIALS ─────────────────────────────────────────────────── */

export function Testimonials({ items }: { items: SponsorPublicState["testimonials"] }) {
  if (items.length === 0) return null;
  return (
    <section className="lh25-section" aria-labelledby="lh25-testimonials">
      <SectionTitle><span id="lh25-testimonials">{C.testimonials.title}</span></SectionTitle>
      <div className="lh25-grid3">
        {items.map((t) => (
          <figure key={t.id} className="lh25-card lh25-quote">
            <blockquote>“{t.quote}”</blockquote>
            <figcaption>— {t.name}{t.brand ? `, ${t.brand}` : ""}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

/* ── M) FAQ ──────────────────────────────────────────────────────────── */

export function Faq() {
  const preview = useContext(PlaceholderPreview);
  const items = C.faq.items.filter((i) => preview || (!hasPlaceholder(i.q) && !hasPlaceholder(i.a)));
  return (
    <section className="lh25-section" aria-labelledby="lh25-faq">
      <SectionTitle><span id="lh25-faq">{C.faq.title}</span></SectionTitle>
      <div className="lh25-faq">
        {items.map((i) => (
          <details key={i.q} className="lh25-faq-item">
            <summary>
              <span>{i.q}</span>
              <Icon name="chevron" size={18} />
            </summary>
            <p>
              <Txt text={i.a} />
              {i.a.includes("Official Giveaway Rules") ? <> <Link to={C.links.rules}>Read the rules →</Link></> : null}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

/* ── N) FINAL CTA ────────────────────────────────────────────────────── */

export function FinalCta() {
  return (
    <section className="lh25-final" aria-labelledby="lh25-final">
      <Sparkle className="lh25-final-s1" size={22} />
      <Sparkle className="lh25-final-s2" size={16} color="#fff" />
      <h2 id="lh25-final">{C.finalCta.title}</h2>
      <Button type="button" variant="ghost" className="lh25-btn lh25-btn-gold" onClick={() => scrollToId("claim")}>{C.finalCta.button}</Button>
    </section>
  );
}

/* ── O) FOOTER ───────────────────────────────────────────────────────── */

export function Footer() {
  const group = filledUrl(C.links.facebookGroup);
  const show = useShow(C.links.facebookGroup);
  return (
    <footer className="lh25-footer">
      <p className="lh25-footer-brand">
        <strong>{C.footer.brand}</strong> | <a href={C.links.website}>{C.links.websiteLabel}</a> | <a href={`mailto:${C.links.email}`}>{C.links.email}</a>
      </p>
      <p>{C.footer.based}</p>
      <p className="lh25-footer-links">
        <a href={C.links.facebookPage} target="_blank" rel="noopener noreferrer">{C.footer.pageLink}</a>
        {group ? <a href={group} target="_blank" rel="noopener noreferrer">{C.footer.groupLink}</a> : show ? <mark className="lh25-ph">{C.footer.groupLink} {C.links.facebookGroup}</mark> : null}
        <Link to={C.links.rules}>{C.footer.rulesLink}</Link>
        <Link to={C.links.privacy}>{C.footer.privacyLink}</Link>
      </p>
    </footer>
  );
}

