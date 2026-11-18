import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { giftGuides as G, type GiftLink, type GiftPick, type GiftSection } from "@/content/giftGuides";

/**
 * /gift-guides (owner 2026-11-16, pop-up "New gift guide page"): the Holiday Gift Guides, public, no sign-in. Every
 * word, pick and link comes from src/content/giftGuides.ts. Every outbound link is an affiliate (or affiliate-holding)
 * link, so each one is marked sponsored and noopener and opens in a new tab, and the FTC disclosure (16 CFR Part 255) sits
 * at the bottom as one muted line (owner 2026-11-18). Images are lazy, decoded off the main thread and drawn in a fixed box, so the page
 * neither waits for them nor shifts when they land. Guard: src/test/giftGuidesPage.test.tsx.
 */

/**
 * The one place an outbound link is drawn, so none can miss the rel or the new tab. The scheme is fixed here, not by
 * the content file: whatever a value starts with, the link is https (an affiliate link, never a stored document).
 */
function Out({ link, className, children }: { link: GiftLink | { href: string; label?: string }; className?: string; children?: React.ReactNode }) {
  return (
    <a href={`https://${link.href.replace(/^https:\/\//, "")}`} target="_blank" rel="sponsored noopener" className={className} data-gift-out="">
      {children ?? link.label}
    </a>
  );
}

const ink = { color: "hsl(var(--ink-deep))" };

function PickCard({ pick }: { pick: GiftPick }) {
  return (
    <li className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card" data-gift-pick="">
      <div className="aspect-square w-full bg-white">
        <img
          loading="lazy"
          decoding="async"
          src={pick.image}
          alt={pick.name}
          width={320}
          height={320}
          sizes="(min-width: 1280px) 240px, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          className="h-full w-full object-contain p-3"
        />
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="text-ds-15 font-semibold leading-snug [overflow-wrap:anywhere]" style={ink}>{pick.name}</p>
        <p className="text-ds-13 text-muted-foreground">{pick.line}</p>
        <Out
          link={{ href: pick.href }}
          className="link-standard mt-auto inline-flex min-h-11 items-center text-ds-15 font-semibold"
        >
          {G.shopLabel}<span className="sr-only"> {pick.name} (opens in a new tab)</span>
        </Out>
      </div>
    </li>
  );
}

function Section({ s }: { s: GiftSection }) {
  const headingId = `gift-${s.id}`;
  return (
    // id = the guide slug, so a pin can link louisianahelpr.com/gift-guides#<id>; scroll-mt clears the sticky header.
    <section id={s.id} aria-labelledby={headingId} className="scroll-mt-24 space-y-4" data-gift-section={s.id}>
      <div className="space-y-1">
        <h2 id={headingId} className="text-ds-20 sm:text-ds-22 font-semibold" style={ink}>{s.title}</h2>
        <p className="text-ds-15 text-muted-foreground">{s.line}</p>
      </div>
      {s.picks.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-gift-grid="">
          {s.picks.map((p) => <PickCard key={p.name} pick={p} />)}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Out link={s.shop} className="link-standard inline-flex min-h-11 items-center text-ds-15 font-semibold">
          {G.fullGuideLabel}: {s.shop.label}
        </Out>
      </div>
      {s.more.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 text-ds-13 text-muted-foreground">
          <span>{G.moreLabel}</span>
          {s.more.map((m) => (
            <Out key={m.href} link={m} className="link-standard inline-flex min-h-11 items-center" />
          ))}
        </p>
      )}
    </section>
  );
}

/**
 * A pin opens /gift-guides#for-her. The page is lazy, so the browser's own anchor jump runs before the section exists
 * (and ScrollToTop leaves a hash alone): once the page has drawn, scroll the named section into view ourselves.
 */
function useScrollToHashSection(hash: string) {
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ""));
    if (!id) return;
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [hash]);
}

export default function GiftGuides() {
  usePageMeta(NOINDEX_PAGE_META["/gift-guides"]);
  useScrollToHashSection(useLocation().hash);
  return (
    <PublicHeaderPage title={G.title} backTo="/" wrapTitle bottomPaddingClassName="pb-12 md:pb-16">
      {/* Owner 2026-11-18 ("fill the screen better"): the page runs the full public container (78rem, both signed in
          and out), never the shared signed-in page column or a narrower measure, and the grid fills it. */}
      <div className="w-full space-y-section font-sans" data-gift-guides="">
        <p className="text-ds-17" style={ink}>{G.intro}</p>
        {G.sections.map((s) => <Section key={s.id} s={s} />)}
        {/* FTC Endorsement Guides (16 CFR Part 255) disclosure, exact words. Owner decision 2026-11-18 (~8:50 AM, after
            the lead explained the FTC guidance and the affiliate-program risk): no box, one small muted line, at the
            BOTTOM, below the last section and above the all-guides links. */}
        <p className="text-ds-13 text-muted-foreground" data-gift-disclosure="">
          {G.disclosure}
        </p>
        <p className="flex flex-wrap items-center gap-x-5 border-t border-border pt-6 text-ds-15">
          {G.allLinks.map((l) => <Out key={l.href} link={l} className="link-standard inline-flex min-h-11 items-center font-semibold" />)}
        </p>
      </div>
    </PublicHeaderPage>
  );
}
