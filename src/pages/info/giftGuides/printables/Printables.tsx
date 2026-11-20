import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
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
    <li id={p.id} className="pr-card" data-printable-card={p.id}>
      <img src={p.preview} alt="" className="pr-card-img" width={160} height={207} loading="lazy" decoding="async" />
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

export default function Printables() {
  const shown = shownPrintables();
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
    <PublicHeaderPage {...funHeader(W.title)}>
      <FunBody title={W.title} path={PRINTABLES_PATH}>
        <style>{PAGE_CSS}</style>
        <p className="gg-fun-lead">{W.lead}</p>
        {makers.length > 0 && (
          <ul className="pr-makers" aria-label={W.title}>
            {makers.map((m) => (
              <li key={m.id} id={m.id}>
                <button type="button" className={`pr-maker-card${m.id === active ? " is-on" : ""}`} aria-pressed={m.id === active} onClick={() => setActive(m.id)} data-printable-card={m.id}>
                  <img src={m.designs[0].thumb ?? m.designs[0].image} alt="" width={56} height={Math.round((56 * m.size.h) / m.size.w)} />
                  <span>
                    <b>{m.title}</b>
                    <small>{m.blurb}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {product && (
          <section className="gg-fun-card" aria-label={`${W.making}: ${product.title}`}>
            <h2>{product.title}</h2>
            <Suspense fallback={<p className="gg-fun-note" role="status">{W.loading}</p>}>
              <NameMaker key={product.id} product={product} />
            </Suspense>
          </section>
        )}
        {downloads.length > 0 && (
          <section aria-labelledby="pr-more">
            <h2 id="pr-more">{W.moreTitle}</h2>
            <ul className="pr-cards">{downloads.map((p) => <DownloadCard key={p.id} p={p} />)}</ul>
          </section>
        )}
      </FunBody>
    </PublicHeaderPage>
  );
}

const PAGE_CSS = `
.pr-makers{list-style:none;margin:0 0 14px;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.pr-maker-card{display:flex;gap:12px;align-items:center;width:100%;text-align:left;border:1px solid var(--gg-line);border-radius:14px;background:hsl(var(--card));padding:10px 12px;cursor:pointer;color:var(--gg-ink);min-height:44px}
.pr-maker-card img{flex:none;width:44px;height:auto;border-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.15)}
.pr-maker-card b{display:block;font-size:15px}
.pr-maker-card small{display:block;font-size:12.5px;color:var(--gg-muted);margin-top:2px}
.pr-maker-card.is-on{border-color:var(--gg-olive);box-shadow:inset 0 0 0 1px var(--gg-olive);background:var(--gg-soft)}
.pr-maker-card:focus-visible{outline:2px solid var(--gg-olive);outline-offset:2px}
.pr-cards{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
.pr-card{display:flex;gap:12px;border:1px solid var(--gg-line);border-radius:16px;background:hsl(var(--card));padding:12px;min-width:0}
.pr-card-img{flex:none;width:96px;height:auto;align-self:flex-start;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,.12)}
.pr-card-body{min-width:0;flex:1}
.pr-card-body h3{font-size:16px;font-weight:700;margin:0 0 4px;color:var(--gg-ink)}
.pr-card-body p{font-size:13px;color:var(--gg-muted);margin:0 0 8px}
.pr-card-btns{display:flex;flex-wrap:wrap;gap:8px}
.pr-err{color:hsl(var(--destructive-ink));font-size:13px;font-weight:600;margin:8px 0 0}
@media (min-width:560px){.pr-makers{grid-template-columns:repeat(auto-fit,minmax(0,1fr))}.pr-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
