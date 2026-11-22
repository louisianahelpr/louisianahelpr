import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { NativeRadio } from "@/components/ui/NativeRadio";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { saveOrShareFile } from "@/lib/fileExport";
import { PRINTABLES_WORDS as W, PRINTABLE_PAGES, printablesOnPage, printablesRedirect, type DownloadProduct, type OverlayProduct, type PrintablePageKey } from "@/content/printables";
import { FunBody, funHeader } from "../fun/FunPage";
import { usePageMeta } from "@/hooks/usePageMeta";
import { NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";

/**
 * The free printables (owner 2026-11-20): free holiday printables the owner designs in Canva. Each kind is its own page
 * (owner 2026-11-21: "coloring book and banner should have their own page"): /gift-guides/printables/gift-tags (the
 * name makers: gift tags, later the Santa letter / Nice List and thank-you cards, which load as their own chunk after
 * the page), /coloring-books and /banners (plain downloads). The old /gift-guides/printables lands on the page its
 * #anchor names, else Gift tags. Only printables switched on with their files listed show (`ready`).
 * Guard: src/test/printables1120.test.tsx, src/test/giftGuideHolidayPolish1121d.test.tsx.
 */
const NameMaker = lazy(() => import("./NameMaker"));

/** A download's state: which file is downloading, and whether the last one failed. */
function useDownload(p: DownloadProduct) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const get = async (href: string) => {
    setBusy(href);
    setErr(false);
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error(`printables: ${href} answered ${res.status}`);
      await saveOrShareFile({ blob: await res.blob(), filename: href.split("/").pop() ?? `${p.id}.pdf`, label: p.title, source: "printables.download" });
    } catch (e: unknown) {
      console.warn("printables: download failed", e);
      setErr(true);
    } finally {
      setBusy(null);
    }
  };
  return { busy, err, get };
}

const DOWNLOAD_FAILED = "That download didn't work. Please try again.";

/** A file that is a book of its own (its own title, line and cover): owner 11-22 #14. */
type Book = DownloadProduct["files"][number] & { title: string; blurb: string; preview: string };
const booksOf = (p: DownloadProduct): Book[] | null => {
  const books = p.files.filter((f): f is Book => Boolean(f.title && f.blurb && f.preview));
  return books.length > 1 && books.length === p.files.length ? books : null;
};

function DownloadCard({ p }: { p: DownloadProduct }) {
  const { busy, err, get } = useDownload(p);
  const books = booksOf(p);
  if (books) {
    // Owner 2026-11-22 #14 ("polish this. separate each book in its own box take them out of the 1 box"): each book its
    // own card (its bigger cover, title, one line and the plain download link), side by side from 560px, stacked on a
    // phone.
    return (
      <li id={p.id} className="pr-books" data-printable-card={p.id}>
        {books.map((b) => (
          <article key={b.href} className="pr-card pr-book" data-printable-book={b.href}>
            <img loading="lazy" decoding="async" src={b.preview} alt="" className="pr-card-img pr-book-img" width={478} height={640} />
            <div className="pr-card-body">
              <h2 className="pr-card-title">{b.title}</h2>
              <p>{b.blurb}</p>
              <div className="pr-card-btns" data-printable-links={b.href}>
                <Button type="button" variant="link" size="inline" className="pr-link" disabled={busy !== null} onClick={() => void get(b.href)} aria-label={`${b.label} the ${b.title.toLowerCase()} (PDF)`} data-printable-download={b.href}>
                  {b.label}{"\u00a0›"}
                </Button>
              </div>
            </div>
          </article>
        ))}
        {err && <p className="pr-err" role="alert">{DOWNLOAD_FAILED}</p>}
      </li>
    );
  }
  return (
    // A banner's wide preview sits full width above its words (owner 2026-11-21: "just polish this"); a 96px thumbnail of
    // a 2:1 banner was too small to see.
    <li id={p.id} className={`pr-card${p.section === "banners" ? " pr-card-wide" : ""}`} data-printable-card={p.id}>
      <img loading="lazy" decoding="async" src={p.preview} alt="" className="pr-card-img" width={160} height={207} />
      <div className="pr-card-body">
        <h2 className="pr-card-title">{p.title}</h2>
        <p>{p.blurb}</p>
        {/* Owner 2026-11-22 #15 ("remove the circles around the print buttons. put print it as below the buttons next to
            the print at walgreens button"): the downloads are plain text links like "Print at Walgreens ›", all on one
            row (12x18 print ›  Wide banner ›  Print at Walgreens ›), each 44px tall: the shared link Button. */}
        <div className="pr-card-btns" data-printable-links={p.id}>
          {p.files.map((f) => (
            <Button key={f.href} type="button" variant="link" size="inline" className="pr-link" disabled={busy !== null} onClick={() => void get(f.href)} data-printable-download={f.href}>
              {f.label}{"\u00a0›"}
            </Button>
          ))}
          {/* Owner 2026-11-21: the banner says where to print it cheaply (a plain link for now; no affiliate program yet). */}
          {p.printAt && (
            <Button asChild variant="link" size="inline" className="pr-link">
              <a href={p.printAt.href} target="_blank" rel="noopener noreferrer" data-printable-print-at={p.id}>
                {p.printAt.label}{"\u00a0›"}<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Button>
          )}
        </div>
        {err && <p className="pr-err" role="alert">{DOWNLOAD_FAILED}</p>}
        {p.cta && <Link to={p.cta.to} className="gg-link">{p.cta.label} ›</Link>}
      </div>
    </li>
  );
}

/** Each page's title (its h1). */
const PAGE_WORDS: Record<PrintablePageKey, { title: string }> = {
  tags: { title: W.tagsTitle },
  coloring: { title: W.coloringTitle },
  banners: { title: W.bannersTitle },
};

/**
 * The old one-page address (/gift-guides/printables) forwards to the page its #anchor names, else Gift tags (old links,
 * pins, the planner sheet). It serves noindex with its own head before JS (NOINDEX_PAGE_META, api/share.ts) and keeps
 * the same head here until the forward lands.
 */
function OldPrintables({ hash }: { hash: string }) {
  usePageMeta(NOINDEX_PAGE_META["/gift-guides/printables"]);
  return <Navigate to={printablesRedirect(hash)} replace />;
}

export default function Printables() {
  const { pathname, hash } = useLocation();
  const page = PRINTABLE_PAGES.find((x) => x.path === pathname.replace(/\/+$/, ""));
  // The old one-page address (and any unknown printables path): its #anchor's page, else Gift tags.
  if (!page) return <OldPrintables hash={hash} />;
  return <PrintablesPage page={page.key} path={page.path} />;
}

function PrintablesPage({ page, path }: { page: PrintablePageKey; path: (typeof PRINTABLE_PAGES)[number]["path"] }) {
  const shown = printablesOnPage(page);
  const words = PAGE_WORDS[page];
  const makers = shown.filter((p): p is OverlayProduct => p.kind === "overlay");
  const downloads = shown.filter((p): p is DownloadProduct => p.kind === "download");
  const { hash } = useLocation();
  const fromHash = makers.find((m) => `#${m.id}` === hash)?.id;
  const [active, setActive] = useState<string | undefined>(fromHash ?? makers[0]?.id);
  useEffect(() => {
    if (!hash) return;
    if (fromHash) setActive(fromHash);
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash, fromHash]);
  const product = makers.find((m) => m.id === active);

  return (
    <PublicHeaderPage {...funHeader(words.title)}>
      {/* Owner 11-22 ("Same row, icons off there"): the guides' top with the pill, no search, heart or Share. */}
      <FunBody title={words.title} path={path} tools="none">
        <style>{PAGE_CSS}</style>
        {/* Owner 2026-11-21 ("remove the ... holiday banner words — just polish this"): no lead line; the title says what
            the page is, and each card carries its own short how-to. */}
        {/* Holiday audit 1121 area 5 #6: the picker shows only when there is a choice (one live maker drew a one-option
            card that did nothing, between two headings of the same words). */}
        {makers.length > 1 && (
          // One maker at a time: a radio group (arrow keys move between them), not a row of toggle buttons.
          <div className="pr-makers" role="radiogroup" aria-label={W.title}>
            {makers.map((m) => (
              <label key={m.id} id={m.id} className={`pr-maker-card${m.id === active ? " is-on" : ""}`} data-printable-card={m.id}>
                <NativeRadio name="printable-maker" value={m.id} checked={m.id === active} onChange={() => setActive(m.id)} className="sr-only" />
                <img src={m.designs[0].thumb ?? m.designs[0].image} alt="" width={56} height={Math.round((56 * m.size.h) / m.size.w)} />
                <span>
                  <b>{m.title}</b>
                  <small>{m.blurb}</small>
                </span>
              </label>
            ))}
          </div>
        )}
        {product && (
          <section id={makers.length > 1 ? undefined : product.id} className="gg-fun-card" aria-label={`${W.making}: ${product.title}`}>
            {makers.length > 1 && <h2>{product.title}</h2>}
            <Suspense fallback={<p className="gg-fun-note" role="status">{W.loading}</p>}>
              <NameMaker key={product.id} product={product} />
            </Suspense>
          </section>
        )}
        {/* Owner 2026-11-21: each page shows only its own kind (the downloads of the "more" group sit under Gift tags). */}
        {downloads.length > 0 && (
          <section aria-label={words.title} className="pr-group">
            {makers.length > 0 && <h2 className="pr-section">{W.moreTitle}</h2>}
            <ul className="pr-cards">{downloads.map((p) => <DownloadCard key={p.id} p={p} />)}</ul>
          </section>
        )}
      </FunBody>
    </PublicHeaderPage>
  );
}

const PAGE_CSS = `
.pr-makers{margin:0 0 14px;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.pr-makers .pr-maker-card{margin:0;font-size:inherit;display:flex;gap:12px;align-items:center;width:100%;text-align:left;border:1px solid var(--gg-line);border-radius:14px;background:hsl(var(--card));padding:10px 12px;cursor:pointer;color:var(--gg-ink);min-height:44px}
.pr-maker-card img{flex:none;width:44px;height:auto;border-radius:4px;border:1px solid var(--gg-line)}
.pr-maker-card b{display:block;font-size:15px}
.pr-maker-card small{display:block;font-size:12.5px;color:var(--gg-muted);margin-top:2px}
.pr-makers .pr-maker-card.is-on{border-color:var(--gg-olive);box-shadow:inset 0 0 0 1px var(--gg-olive);background:var(--gg-soft)}
.pr-maker-card:focus-within{outline:2px solid var(--gg-olive);outline-offset:2px}
.pr-section{font-size:18px;font-weight:700;margin:22px 0 10px;color:var(--gg-ink)}
.pr-group{margin-top:4px}
.pr-cards{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
.pr-card{display:flex;gap:12px;border:1px solid var(--gg-line);border-radius:16px;background:hsl(var(--card));padding:12px;min-width:0}
/* Holiday audit 1121 area 5 #11 (owner rule: no box behind any photo): no drop shadow, a hairline edge so a white page
   still reads as a page. */
.pr-card-img{flex:none;width:96px;height:auto;align-self:flex-start;border-radius:6px;border:1px solid var(--gg-line)}
/* Owner 11-22 #14: the coloring books, each its own card spanning the row's two columns together: cover above (160px on
   a phone, 200px from 560px; it was 96px, two to a card), then the title, one line and the download link. */
.pr-books{grid-column:1/-1;display:grid;grid-template-columns:minmax(0,1fr);gap:12px;list-style:none}
.pr-book{flex-direction:column;padding:16px}
.pr-book .pr-book-img{width:160px;max-width:100%}
.pr-card-body{min-width:0;flex:1}
.pr-card-wide{flex-direction:column;max-width:640px;grid-column:1/-1}.pr-card-wide .pr-card-img{width:100%;max-width:100%}
.pr-card-body .pr-card-title{font-size:16px;font-weight:700;margin:0 0 4px;color:var(--gg-ink)}
.pr-card-body p{font-size:13px;color:var(--gg-muted);margin:0 0 8px}
/* Owner 11-22 #15: the links stay on ONE row; on a narrow card the last ("Print at Walgreens") wraps inside itself. */
.pr-card-btns{display:flex;flex-wrap:nowrap;align-items:center;gap:0 16px}
.pr-card-btns>.pr-link{flex:none}
.pr-card-btns>a.pr-link{flex:0 1 auto;min-width:0;white-space:normal;text-align:left}
@media (max-width:479px){.pr-card-btns{gap:0 12px}.pr-card .pr-link{font-size:13px}}
/* Owner 2026-11-21: "Download the banner (free)" overflowed its pill; a long label wraps inside its button instead. */
.pr-card-btns button{max-width:100%;height:auto;min-height:44px;white-space:normal;text-align:center}
/* Owner 11-22 #15: every download and "Print at Walgreens" is the same plain olive text link, no pill outline. */
.pr-card .pr-link{display:inline-flex;align-items:center;justify-content:flex-start;min-height:44px;padding:0;font-size:14px;font-weight:700;letter-spacing:0;color:var(--gg-olive);background:none;border:0;box-shadow:none}
.pr-err{color:hsl(var(--destructive-ink));font-size:13px;font-weight:600;margin:8px 0 0}
@media (min-width:560px){.pr-makers{grid-template-columns:repeat(auto-fit,minmax(0,1fr))}.pr-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.pr-books{grid-template-columns:repeat(2,minmax(0,1fr))}.pr-book .pr-book-img{width:200px}}
`;
