import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { giftGuides as G } from "@/content/giftGuides";
import { loadModule } from "@/lib/loadModule";

/**
 * "Our 25 Days sponsors" (owner 2026-11-20 ~8:40 AM: "a row of sponsor LOGOS that scrolls left/right"; mockup
 * claude.ai/artifact/5MPXu5UGMCGqkvqsrPmwGX): on the gift-guides landing, after the first row of covers and before the
 * Top 10. One round logo per sponsor (Louisiana and national, A to Z), its name under it; swipe on a phone, snap
 * scrolling, arrow buttons on wider screens; no auto-play. A sponsor with a guide spot links to it, else to its
 * Facebook page (new tab); a sponsor without a logo shows its initials. Never a giveaway day. The list
 * (src/content/giftGuideSponsorLogos.json, scripts/gift-guide-sponsor-logos.mjs) loads in its own small chunk after the
 * page draws, and every logo is a lazy 160 px webp, so the landing's first paint carries none of it.
 * Guard: src/test/giftGuideTrain1120b.test.ts.
 */

export interface SponsorLogo { name: string; slug: string; logo?: string; href: string; external?: boolean; dark?: boolean }

const SPONSOR_ROW_CSS = `
.gg-spons{margin:18px 0 6px;padding:14px 0 12px;border:1px solid var(--gg-line);border-radius:16px;background:hsl(var(--card))}
.gg-spons .gg-rowhead{padding:0 14px;margin-top:0}
.gg-spons-end{display:flex;align-items:center;gap:8px}
.gg-spons-intro{margin:0 14px 8px;font-size:13px;color:var(--gg-muted)}
.gg-spons-wrap{position:relative}
.gg-spons-row{display:flex;gap:12px;overflow-x:auto;list-style:none;margin:0;padding:4px 14px 6px;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:contain}
.gg-spons-row::-webkit-scrollbar{display:none}
.gg-spons-row>li{flex:none;width:88px;scroll-snap-align:start}
.gg-spons-a{display:flex;flex-direction:column;align-items:center;gap:6px;min-height:44px;color:var(--gg-ink);text-decoration:none;border-radius:12px}
.gg-spons-a:focus-visible{outline:2px solid var(--gg-olive);outline-offset:2px}
.gg-spons-logo{display:flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:50%;background:#fff;border:1px solid var(--gg-line);overflow:hidden}
.gg-spons-logo img{width:100%;height:100%;object-fit:contain}
.gg-spons-logo.is-dark{background:#1c1c1a}
.gg-spons-logo b{font-size:18px;font-weight:700;color:var(--gg-olive)}
.gg-spons-name{font-size:11.5px;line-height:1.2;text-align:center;color:var(--gg-ink);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.gg-spons-btns{display:none;gap:8px}
.gg-spons-btn{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border-radius:999px;border:1px solid var(--gg-line);background:hsl(var(--background));color:var(--gg-ink);cursor:pointer}
@media (min-width:768px){.gg-spons-btns{display:flex}.gg-spons-row>li{width:96px}.gg-spons-logo{width:80px;height:80px}.gg-spons-name{font-size:12.5px}}
`;

/** The list, loaded alone (loadModule: a prevented preload gives null and the row stays hidden). */
const loadSponsors = () => loadModule(() => import("@/content/giftGuideSponsorLogos.json"));

/** "Le Petit Theatre" -> "LP"; "aosu" -> "A". */
const initials = (name: string) => name.split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

function Logo({ s }: { s: SponsorLogo }) {
  const [ok, setOk] = useState(true);
  return (
    <span className={s.dark ? "gg-spons-logo is-dark" : "gg-spons-logo"} aria-hidden="true">
      {s.logo && ok ? <img loading="lazy" decoding="async" src={s.logo} alt="" width={80} height={80} onError={() => setOk(false)} /> : <b>{initials(s.name)}</b>}
    </span>
  );
}

function Tile({ s }: { s: SponsorLogo }) {
  const body = (
    <>
      <Logo s={s} />
      <span className="gg-spons-name">{s.name}</span>
    </>
  );
  return (
    <li data-gift-sponsor={s.slug}>
      {s.external && /^https:\/\//.test(s.href) ? (
        <a href={s.href} target="_blank" rel="noopener noreferrer" className="gg-spons-a" aria-label={`${s.name} (${G.newTab})`}>{body}</a>
      ) : (
        <Link to={s.href.startsWith("/") ? s.href : G.sponsorRow.allHref} className="gg-spons-a">{body}</Link>
      )}
    </li>
  );
}

export function SponsorRow() {
  const [list, setList] = useState<SponsorLogo[] | null>(null);
  const row = useRef<HTMLUListElement>(null);
  useEffect(() => {
    let live = true;
    loadSponsors().then((m) => {
      if (live && m) setList((m.default ?? []) as SponsorLogo[]);
    }, () => {
      // A failed chunk leaves the row hidden: the guides above and below it work without it.
    });
    return () => {
      live = false;
    };
  }, []);
  if (!list || list.length === 0) return null;
  const scroll = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * Math.max(240, (row.current?.clientWidth ?? 480) * 0.8), behavior: "smooth" });
  return (
    <section className="gg-spons" aria-labelledby="gift-sponsors" data-gift-sponsors="">
      <style>{SPONSOR_ROW_CSS}</style>
      <div className="gg-rowhead">
        <h2 id="gift-sponsors">{G.sponsorRow.title}</h2>
        <span className="gg-spons-end">
        <span className="gg-spons-btns">
          <Button type="button" variant="ghost" size="inline" className="gg-spons-btn" aria-label={G.sponsorRow.left} onClick={() => scroll(-1)}>
            <ChevronLeft aria-hidden="true" />
          </Button>
          <Button type="button" variant="ghost" size="inline" className="gg-spons-btn" aria-label={G.sponsorRow.right} onClick={() => scroll(1)}>
            <ChevronRight aria-hidden="true" />
          </Button>
        </span>
        <Link to={G.sponsorRow.allHref} className="gg-link" data-gift-sponsors-all="">{G.seeAllLabel} ›<span className="sr-only"> {G.sponsorRow.title}</span></Link>
        </span>
      </div>
      <p className="gg-spons-intro">{G.sponsorRow.intro}</p>
      <ul className="gg-spons-row" ref={row}>
        {list.map((s) => <Tile key={s.slug} s={s} />)}
      </ul>
    </section>
  );
}
