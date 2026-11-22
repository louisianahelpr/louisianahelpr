import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { NativeRadio } from "@/components/ui/NativeRadio";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { saveOrShareFile } from "@/lib/fileExport";
import { PRINTABLES_PATH, PRINTABLES_WORDS as W, shownPrintables, type DownloadProduct, type OverlayProduct } from "@/content/printables";
import { FunBody, funHeader } from "../fun/FunPage";

/**
 * /gift-guides/printables (owner 2026-11-20): free holiday printables the owner designs in Canva. The name makers
 * (gift tags, the Santa letter / Nice List, thank-you cards) load as their own chunk, after the page; the downloads are
 * plain PDFs. Only printables switched on with their files listed show (src/content/printables.ts `ready`).
 * Guard: src/test/printables1120.test.tsx.
 */
const NameMaker = lazy(() => import("./NameMaker"));

function DownloadCard({ p }: { p: DownloadProduct }) {
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
  return (
    <li id={p.id} className={`pr-card${p.previews && p.previews.length > 1 ? " pr-card-two" : ""}`} data-printable-card={p.id}>
      {p.previews && p.previews.length > 1 ? (
        <span className="pr-card-pair" data-printable-previews="">
          {p.previews.map((src) => <img key={src} loading="lazy" decoding="async" src={src} alt="" className="pr-card-img" width={160} height={207} />)}
        </span>
      ) : (
        <img loading="lazy" decoding="async" src={p.preview} alt="" className="pr-card-img" width={160} height={207} />
      )}
      <div className="pr-card-body">
        <h3>{p.title}</h3>
        <p>{p.blurb}</p>
        <div className="pr-card-btns">
          {p.files.map((f) => (
            <Button key={f.href} type="button" variant={p.files.length > 1 ? "outline" : "default"} className={p.files.length > 1 ? "" : "btn-grad-primary"} size="sm" disabled={busy !== null} onClick={() => void get(f.href)} data-printable-download={f.href}>
              {f.label}
            </Button>
          ))}
        </div>
        {err && <p className="pr-err" role="alert">That download didn't work. Please try again.</p>}
        {p.cta && <Link to={p.cta.to} className="gg-link">{p.cta.label} ›</Link>}
      </div>
    </li>
  );
}

const DOWNLOAD_SECTIONS = [
  { key: "coloring", title: W.sectionColoring },
  { key: "banners", title: W.sectionBanners },
  { key: "more", title: W.moreTitle },
] as const;

export default function Printables() {
  const shown = shownPrintables();
  const makers = shown.filter((p): p is OverlayProduct => p.kind === "overlay");
  const downloads = shown.filter((p): p is DownloadProduct => p.kind === "download");
  const { hash, search } = useLocation();
  // Owner 11-21 ("when I click into each section on the left panel, it should open to the top of the page, not the
  // middle"; earlier "only the section I click in the left panel should be displayed"): the menu's Gift tags,
  // Coloring books and Banners open this page at its top showing only that part (?show=tags|coloring|banners), with a
  // link to every printable. A #pr-... link (pins) still scrolls to its section on the full page.
  const show = new URLSearchParams(search).get("show");
  const only = (key: string) => !show || show === key;
  const fromHash = makers.find((m) => `#${m.id}` === hash)?.id;
  const [active, setActive] = useState<string | undefined>(fromHash ?? makers[0]?.id);
  useEffect(() => {
    if (!hash) return;
    if (fromHash) setActive(fromHash);
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash, fromHash]);
  const product = makers.find((m) => m.id === active);

  return (
    <PublicHeaderPage {...funHeader(W.title)}>
      <FunBody title={W.title} path={PRINTABLES_PATH}>
        <style>{PAGE_CSS}</style>
        <p className="gg-fun-lead">{W.lead}</p>
        {show && <p><Link to={PRINTABLES_PATH} className="gg-link" data-printables-all="">{W.seeAll} ›</Link></p>}
        {only("tags") && makers.length > 0 && <h2 className="pr-section" id="pr-tags">{W.sectionTags}</h2>}
        {/* Holiday audit 1121 area 5 #6: the picker shows only when there is a choice (one live maker drew a one-option
            card that did nothing, between two headings of the same words). */}
        {only("tags") && makers.length > 1 && (
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
        {only("tags") && product && (
          <section id={makers.length > 1 ? undefined : product.id} className="gg-fun-card" aria-label={`${W.making}: ${product.title}`}>
            {makers.length > 1 && <h2>{product.title}</h2>}
            <Suspense fallback={<p className="gg-fun-note" role="status">{W.loading}</p>}>
              <NameMaker key={product.id} product={product} />
            </Suspense>
          </section>
        )}
        {/* Owner 2026-11-21: tags, banners and coloring books each get their own subsection. */}
        {DOWNLOAD_SECTIONS.map((sec) => {
          const list = downloads.filter((p) => (p.section ?? "more") === sec.key);
          if (list.length === 0 || !only(sec.key)) return null;
          return (
            <section key={sec.key} aria-labelledby={`pr-${sec.key}`} className="pr-group">
              <h2 className="pr-section" id={`pr-${sec.key}`}>{sec.title}</h2>
              <ul className="pr-cards">{list.map((p) => <DownloadCard key={p.id} p={p} />)}</ul>
            </section>
          );
        })}
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
.pr-card-pair{flex:none;display:flex;gap:6px;align-self:flex-start}
.pr-card-pair .pr-card-img{width:64px}
/* Two covers: they sit above the words, so the two book buttons get the card's full width (at 375 and in the two-across grid). */
.pr-card-two{flex-direction:column}.pr-card-two .pr-card-pair .pr-card-img{width:96px}
.pr-card-body{min-width:0;flex:1}
.pr-card-body h3{font-size:16px;font-weight:700;margin:0 0 4px;color:var(--gg-ink)}
.pr-card-body p{font-size:13px;color:var(--gg-muted);margin:0 0 8px}
.pr-card-btns{display:flex;flex-wrap:wrap;gap:8px}
.pr-err{color:hsl(var(--destructive-ink));font-size:13px;font-weight:600;margin:8px 0 0}
@media (min-width:560px){.pr-makers{grid-template-columns:repeat(auto-fit,minmax(0,1fr))}.pr-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
