import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, ChevronDown, Copy, Gift } from "lucide-react";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { Button } from "@/components/ui/button";
import { usePageMeta } from "@/hooks/usePageMeta";
import { NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";
import {
  giftGuides as G,
  BUDGET_TIERS,
  DISCOUNT_CODES,
  GIFT_GUIDES_PREVIEW,
  GUIDE_SECTIONS,
  brandLink,
  guideHref,
  toProduct,
  type DiscountCode,
  type GiftProduct,
  type GuideMeta,
  type GuideSection,
  type ItemData,
} from "@/content/giftGuides";
import { GUIDE_LIST } from "@/content/giftGuideList";

/**
 * /gift-guides?preview=1 (owner 2026-11-17 final layout; HIDDEN: App.tsx sends /gift-guides without ?preview=1 home):
 *   1. a gingham header band with the cream arch and thin dark outline,
 *   2. "Shop by budget" buttons (only the tiers one of her guides prices),
 *   3. fold-out sections that show her guide covers 2 across when open,
 *   4. the discount codes with copy buttons, 5. the affiliate disclosure and the Amazon price note.
 * A cover opens that guide ON THIS PAGE (&guide=<id>): her cover big on top, then a numbered list where each gift links
 * straight to its own affiliate link. The covers are her real pins / pin-template covers as webp, lazy, with their
 * size set; a section's covers are not even in the DOM until it opens, and a guide's picks load (one chunk per
 * section) only when a guide opens. Every outbound link is drawn by <Out> (rel="sponsored noopener", new tab).
 * Content: src/content/giftGuides.ts, giftGuideList.ts, giftGuideItems/. Guard: src/test/giftGuidesPage.test.tsx.
 */

const ITEM_LOADERS: Record<GuideSection, () => Promise<{ ITEMS: Record<string, ItemData[]> }>> = {
  people: () => import("@/content/giftGuideItems/people"),
  interests: () => import("@/content/giftGuideItems/interests"),
  life: () => import("@/content/giftGuideItems/life"),
  louisiana: () => import("@/content/giftGuideItems/louisiana"),
  christmas: () => import("@/content/giftGuideItems/christmas"),
  deals: () => import("@/content/giftGuideItems/deals"),
  budget: () => import("@/content/giftGuideItems/budget"),
};

const guideLabel = (g: GuideMeta) => [g.lead, g.title].filter(Boolean).join(" ");

function Out({ href, className, children, label }: { href: string; className?: string; children: ReactNode; label?: string }) {
  return (
    <a href={href} target="_blank" rel="sponsored noopener" className={className} aria-label={label} data-gift-out="">
      {children}
    </a>
  );
}

function Disclosures({ amazonNote }: { amazonNote: boolean }) {
  return (
    // FTC Endorsement Guides (16 CFR Part 255) and the Amazon Associates statement, in plain words.
    <div className="space-y-1 text-ds-13 leading-relaxed text-muted-foreground" data-gift-disclosure="">
      <p>{G.disclosure}</p>
      <p>{G.amazonDisclosure}</p>
      {amazonNote && <p data-gift-price-note="">{G.priceNote}</p>}
    </div>
  );
}

function CopyCode({ code }: { code: DiscountCode }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = () => {
    navigator.clipboard?.writeText(code.code).then(
      () => setCopied(true),
      // No clipboard permission (an old WebView): the code stays on screen to type by hand, so nothing is lost.
      () => setCopied(false),
    );
  };
  return (
    <Button type="button" variant="outline" onClick={copy} className="shrink-0 gap-2 font-mono tracking-wide" data-gift-copy={code.code}>
      {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      {code.code}
      <span className="font-sans text-ds-13 text-muted-foreground" aria-live="polite">{copied ? G.copiedLabel : G.copyLabel}</span>
    </Button>
  );
}

function HeaderBand() {
  return (
    // The owner's pin template as a page header: gingham, a cream arch with a thin dark outline (drawn, not a cover).
    <div
      className="rounded-3xl px-6 pt-6 sm:px-10 sm:pt-8"
      style={{
        backgroundColor: "hsl(var(--sage) / 0.28)",
        backgroundImage:
          "linear-gradient(90deg, hsl(var(--card) / 0.55) 50%, transparent 50%), linear-gradient(hsl(var(--card) / 0.55) 50%, transparent 50%)",
        backgroundSize: "40px 40px",
      }}
      data-gift-band=""
    >
      <div className="mx-auto max-w-md rounded-t-[999px] bg-card p-2">
        <div className="rounded-t-[999px] border border-b-0 border-foreground/80 px-4 pb-6 pt-12 text-center">
          <p className="text-ds-11 font-semibold uppercase tracking-[0.3em] text-muted-foreground">{G.kicker}</p>
          <p className="mt-2 text-ds-32 font-semibold leading-tight text-foreground sm:text-ds-40" aria-hidden>{G.title}</p>
          <span className="mx-auto mt-4 block w-8 border-t border-foreground/80" aria-hidden />
          <p className="mt-3 text-ds-11 font-semibold uppercase tracking-[0.3em] text-foreground">{G.bandLine}</p>
        </div>
      </div>
    </div>
  );
}

const SectionLabel = ({ id, children }: { id: string; children: ReactNode }) => (
  <h2 id={id} className="text-ds-11 font-semibold uppercase tracking-[0.18em] text-muted-foreground">{children}</h2>
);

function budgetGuides() {
  return BUDGET_TIERS.flatMap((n) => {
    const g = GUIDE_LIST.find((x) => x.section === "budget" && x.title === G.under(n));
    return g ? [{ n, g }] : [];
  });
}

function GuideCover({ g }: { g: GuideMeta }) {
  return (
    <li data-gift-tile={g.id}>
      <Link to={guideHref(g.id)} className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={guideLabel(g)}>
        {g.cover ? (
          <img
            src={g.cover.src}
            width={g.cover.w}
            height={g.cover.h}
            loading="lazy"
            decoding="async"
            alt=""
            style={{ aspectRatio: `${g.cover.w} / ${g.cover.h}` }}
            className="block h-auto w-full rounded-xl border border-border object-cover shadow-sm transition-transform group-hover:-translate-y-0.5"
          />
        ) : (
          // No cover of hers exists for this guide yet: a plain card with its name, never an imitation of her pins.
          <span className="flex aspect-[2/3] w-full flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card p-4 text-center" data-gift-nocover="">
            {g.lead && <span className="text-ds-13 text-muted-foreground">{g.lead}</span>}
            <span className="text-ds-20 font-semibold leading-snug text-foreground">{g.title}</span>
          </span>
        )}
      </Link>
    </li>
  );
}

function FoldOut({ id, title, guides, open, onToggle }: { id: string; title: string; guides: GuideMeta[]; open: boolean; onToggle: () => void }) {
  const covered = id === "deals" ? guides.filter((g) => g.cover) : guides;
  const more = id === "deals" ? guides.filter((g) => !g.cover) : [];
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card" data-gift-section={id}>
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`gift-panel-${id}`}
          className="flex min-h-[3.75rem] w-full items-center justify-between gap-3 px-4 text-left text-ds-17 font-semibold text-foreground"
        >
          {title}
          <span className="flex items-center gap-1.5 text-ds-13 font-normal text-muted-foreground">
            {open ? G.open : G.guidesCount(guides.length)}
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          </span>
        </button>
      </h3>
      {open && (
        <div id={`gift-panel-${id}`} className="space-y-4 px-3 pb-4">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {covered.map((g) => <GuideCover key={g.id} g={g} />)}
          </ul>
          {more.length > 0 && (
            <div className="space-y-2 px-1">
              <p className="text-ds-13 font-semibold text-foreground">{G.moreBrands}</p>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" data-gift-more-brands="">
                {more.map((g) => (
                  <li key={g.id} data-gift-tile={g.id}>
                    <Link to={guideHref(g.id)} className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border px-3 py-2 text-ds-15 text-foreground hover:bg-muted/50">
                      <span className="[overflow-wrap:anywhere]">{g.title}</span>
                      <span className="shrink-0 text-ds-13 text-muted-foreground">{G.picksCount(g.count)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CodesSection() {
  return (
    <section aria-labelledby="gift-codes" className="space-y-3" data-gift-section="codes">
      <SectionLabel id="gift-codes">{G.codesTitle}</SectionLabel>
      <p className="text-ds-14 text-muted-foreground">{G.codesLine}</p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {DISCOUNT_CODES.map((c) => (
          <li key={c.code} className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-border bg-card p-4" data-gift-code={c.code}>
            <div className="min-w-0 flex-1 space-y-0.5">
              {c.guide ? (
                <Link to={guideHref(c.guide)} className="link-standard text-ds-17 font-semibold">{c.name}</Link>
              ) : c.brand ? (
                <Out href={brandLink(c.brand)} className="link-standard text-ds-17 font-semibold" label={`${c.name} (opens in a new tab)`}>{c.name}</Out>
              ) : (
                <span className="text-ds-17 font-semibold">{c.name}</span>
              )}
              <p className="text-ds-13 text-muted-foreground">{c.offer}</p>
            </div>
            <CopyCode code={c} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Home() {
  const [params, setParams] = useSearchParams();
  const openId = params.get("open");
  const toggle = (id: string) => {
    const next = new URLSearchParams(params);
    if (openId === id) next.delete("open");
    else next.set("open", id);
    setParams(next, { replace: true });
  };
  const budgets = budgetGuides();
  return (
    <>
      <HeaderBand />
      <p className="text-ds-15 text-foreground">{G.intro}</p>
      {budgets.length > 0 && (
        <section aria-labelledby="gift-budget" className="space-y-3" data-gift-section="budget">
          <SectionLabel id="gift-budget">{G.budgetTitle}</SectionLabel>
          <ul className="flex flex-wrap gap-2">
            {budgets.map(({ n, g }) => (
              <li key={n}>
                <Link to={guideHref(g.id)} className="flex min-h-11 items-center whitespace-nowrap rounded-full border border-border bg-card px-4 text-ds-14 font-semibold text-foreground hover:bg-muted/50" data-gift-budget={n}>
                  {G.under(n)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="gift-browse" className="space-y-3">
        <SectionLabel id="gift-browse">{G.browseTitle}</SectionLabel>
        {GUIDE_SECTIONS.map((s) => {
          const list = GUIDE_LIST.filter((g) => g.section === s.id);
          if (list.length === 0) return null;
          return <FoldOut key={s.id} id={s.id} title={s.title} guides={list} open={openId === s.id} onToggle={() => toggle(s.id)} />;
        })}
      </section>
      <CodesSection />
      <Disclosures amazonNote />
    </>
  );
}

function ProductRow({ p, n }: { p: GiftProduct; n: number }) {
  return (
    <li className="border-b border-border last:border-b-0" data-gift-product="">
      <Out href={p.href} className="flex min-h-[5.25rem] items-center gap-3 px-4 py-2.5 text-foreground hover:bg-muted/40" label={`${n}. ${p.name}, ${G.shopLabel} (opens in a new tab)`}>
        <span className="w-6 shrink-0 text-right text-ds-15 font-semibold text-muted-foreground" aria-hidden>{n}</span>
        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted" aria-hidden>
          {p.image ? (
            <img src={p.image} width={64} height={64} loading="lazy" decoding="async" alt="" className="h-full w-full object-cover" />
          ) : (
            <Gift className="h-6 w-6 text-muted-foreground" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-ds-15 leading-snug [overflow-wrap:anywhere]">{p.name}</span>
          <span className="text-ds-13 text-muted-foreground">{p.store}</span>
          {p.code && <span className="text-ds-13 font-semibold text-foreground">{p.code.offer.split(".")[0]} with {p.code.code}</span>}
        </span>
        <span className="shrink-0 text-ds-11 font-semibold uppercase tracking-[0.08em] text-foreground" aria-hidden>{G.shopLabel}</span>
      </Out>
    </li>
  );
}

function GuideView({ g }: { g: GuideMeta }) {
  const [items, setItems] = useState<ItemData[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setItems(null);
    setFailed(false);
    ITEM_LOADERS[g.section]().then(
      (m) => live && setItems(m.ITEMS[g.id] ?? []),
      // A failed chunk fetch (offline, a deploy mid-visit): say so with a retry instead of an endless spinner.
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [g.id, g.section]);
  const products = (items ?? []).map(toProduct);
  const amazon = g.store === "amazon" || products.some((p) => p.store === "Amazon");
  const more = GUIDE_LIST.filter((x) => x.section === g.section && x.id !== g.id).slice(0, 8);
  const back = g.section === "budget" ? GIFT_GUIDES_PREVIEW : `${GIFT_GUIDES_PREVIEW}&open=${g.section}`;
  return (
    <div className="mx-auto max-w-xl space-y-5" data-gift-guide={g.id}>
      <Link to={back} className="link-standard inline-flex min-h-11 items-center gap-1.5 text-ds-15 font-semibold">
        <ArrowLeft className="h-4 w-4" aria-hidden />{G.allGuidesLabel}
      </Link>
      <h2 className={g.cover ? "sr-only" : "text-center text-ds-28 font-semibold text-foreground"}>{guideLabel(g)}</h2>
      {g.cover && (
        // Her cover, big, as the guide's title: it is the first thing on the screen, so it loads eagerly.
        <img src={g.cover.src} width={g.cover.w} height={g.cover.h} decoding="async" alt={guideLabel(g)} style={{ aspectRatio: `${g.cover.w} / ${g.cover.h}` }} className="block h-auto w-full rounded-2xl object-cover" data-gift-cover="" />
      )}
      <p className="text-center text-ds-13 text-muted-foreground">{G.tapLine}</p>
      {failed ? (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-4 text-center" role="alert">
          <p className="text-ds-15">{G.loadFailed}</p>
          <Button type="button" variant="outline" onClick={() => window.location.reload()}>{G.retry}</Button>
        </div>
      ) : items === null ? (
        <p className="text-center text-ds-14 text-muted-foreground" aria-busy="true">{G.loading}</p>
      ) : (
        <ol className="overflow-hidden rounded-2xl border border-border bg-card" data-gift-list="">
          {products.map((p, i) => <ProductRow key={`${p.href}-${i}`} p={p} n={i + 1} />)}
        </ol>
      )}
      {more.length > 0 && (
        <section aria-labelledby="gift-more" className="space-y-2">
          <SectionLabel id="gift-more">{G.moreGuides}</SectionLabel>
          <ul className="flex flex-wrap gap-2">
            {more.map((m) => (
              <li key={m.id}>
                <Link to={guideHref(m.id)} className="flex min-h-11 items-center rounded-full border border-border bg-card px-4 text-ds-14 font-semibold text-foreground hover:bg-muted/50">
                  {m.store === "amazon" ? `${m.title} on Amazon` : m.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Disclosures amazonNote={amazon} />
    </div>
  );
}

export default function GiftGuides() {
  // Hidden preview (owner 2026-11-17): noindex, before JavaScript too (vercel.json _og=noindex).
  usePageMeta(NOINDEX_PAGE_META["/gift-guides"]);
  const [params] = useSearchParams();
  const id = params.get("guide");
  const guide = id ? GUIDE_LIST.find((g) => g.id === id) : undefined;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [guide?.id]);
  return (
    <PublicHeaderPage title={G.title} backTo="/" wrapTitle phoneHidesTitle bottomPaddingClassName="pb-12 md:pb-16">
      <div className="mx-auto w-full max-w-5xl space-y-6 font-sans" data-gift-guides="">
        {guide ? (
          <GuideView g={guide} />
        ) : (
          <>
            {id && <p className="text-ds-14 text-muted-foreground" role="status">{G.notFound}</p>}
            <Home />
          </>
        )}
      </div>
    </PublicHeaderPage>
  );
}
