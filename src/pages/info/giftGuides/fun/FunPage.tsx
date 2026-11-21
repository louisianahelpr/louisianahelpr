import type { ReactNode } from "react";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { GIFT_GUIDES_CSS } from "../giftGuidesStyles";
import { GIFT_WISH_CSS } from "../giftWishStyles";
import { giftGuides as G } from "@/content/giftGuides";

type FunPath = "/gift-guides/swipe" | "/gift-guides/planner" | "/gift-guides/draw-names" | "/gift-guides/printables";

/** The shared shell's props for a fun page: the gift guides' public header, back to /gift-guides, a wrapping title. */
export const funHeader = (title: string) => ({ title, backTo: "/gift-guides", bottomPaddingClassName: "pb-12 md:pb-16", wrapTitle: true });

/**
 * The body of the four fun pages (owner 2026-11-20), inside each page's own <PublicHeaderPage {...funHeader(title)}>
 * (the shared shell, src/test/shellConsistency.test.ts): the guides' own styles plus FUN_CSS and one centered column.
 * The three public pages take their head from PUBLIC_PAGE_META (the same words api/share.ts writes before JS); a
 * private page (a Secret Santa reveal) is noindex.
 */
export function FunBody({ title, path, noindex, children }: { title: string; path: FunPath; noindex?: boolean; children: ReactNode }) {
  const meta = PUBLIC_PAGE_META[path];
  usePageMeta(noindex ? { title: `${title} — Helpr`, description: meta.description, robots: "noindex", noCanonical: true } : meta);
  return (
    <>
      <style>{GIFT_GUIDES_CSS}{GIFT_WISH_CSS}{FUN_CSS}</style>
      <div className="gg gg-fun w-full" data-gift-fun={path}>
        {children}
        {/* Holiday audit 1121 (High): Swipe's Shop links and the planner's ideas are affiliate links (Amazon's among
            them), so every fun page ends with the same two plain muted lines as the guides: the FTC disclosure
            (16 CFR Part 255) and the statement the Amazon Associates agreement requires. */}
        <footer className="gg-disc" data-gift-fun-disclosure="">
          <p data-gift-disclosure="">{G.disclosure}</p>
          <p data-gift-amazon-statement="">{G.amazonStatement}</p>
        </footer>
      </div>
    </>
  );
}

/** Scoped under .gg like the guides' own CSS, shipped in the fun pages' lazy chunks only. */
const FUN_CSS = `
.gg-fun{max-width:640px;margin:0 auto;padding:4px 0 24px}
.gg-fun h2{font-size:20px;font-weight:700;margin:4px 0 6px;color:var(--gg-ink)}
.gg-fun-lead{color:var(--gg-muted);font-size:14px;line-height:1.5;margin:0 0 16px}
.gg-fun-card{border:1px solid var(--gg-line);border-radius:16px;background:hsl(var(--card));padding:16px;margin:0 0 14px}
.gg-fun-row{display:flex;gap:8px;align-items:center}
.gg-fun-row>input,.gg-fun-row>select{flex:1;min-width:0}
.gg-fun input,.gg-fun select{min-height:44px;font:500 15px Montserrat,sans-serif;padding:8px 12px;border:1px solid hsl(var(--input));border-radius:10px;background:hsl(var(--background));color:var(--gg-ink);min-width:0}
.gg-fun label{display:block;font-size:13px;font-weight:600;margin:12px 0 6px;color:var(--gg-ink)}
.gg-fun-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.gg-fun-list>li{min-width:0}
.gg-fun-err{color:hsl(var(--destructive-ink));font-size:13px;font-weight:600;margin:8px 0 0}
.gg-fun-note{color:var(--gg-muted);font-size:12px;margin:10px 0 0}
.gg-fun-x{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;border:0;background:transparent;border-radius:999px;color:var(--gg-muted);cursor:pointer;font-size:20px}
.gg-fun-big{font-size:28px;font-weight:800;margin:6px 0;color:var(--gg-olive);overflow-wrap:anywhere}
.gg-fun-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.gg-swipe-stage{position:relative;max-width:360px;margin:0 auto;touch-action:pan-y}
.gg-swipe-card{position:relative;border:1px solid var(--gg-line);border-radius:20px;background:hsl(var(--card));box-shadow:0 6px 20px rgba(0,0,0,.08);display:flex;flex-direction:column;align-items:center;padding:16px;user-select:none;transition:transform .2s ease}
.gg-swipe-card{touch-action:pan-y;-webkit-user-select:none}
.gg-swipe-card img{-webkit-user-drag:none;user-drag:none;pointer-events:none}
.gg-swipe-card.is-dragging{transition:none}
.gg-swipe-card .gg-photo,.gg-swipe-card .gg-letter{width:220px;height:220px}
.gg-swipe-card .gg-thumb{width:220px;height:220px;object-fit:contain}
.gg-swipe-name{font-size:17px;font-weight:700;text-align:center;margin:12px 0 4px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.gg-swipe-meta{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--gg-muted)}
.gg-swipe-tag{position:absolute;top:18px;font-size:18px;font-weight:800;padding:4px 10px;border-radius:8px;border:3px solid;opacity:0}
.gg-swipe-tag.save{left:18px;color:#3f7a2c;border-color:#3f7a2c}
.gg-swipe-tag.skip{right:18px;color:#b26862;border-color:#b26862}
.gg-swipe-btns{display:flex;justify-content:center;gap:16px;margin:16px 0 4px}
.gg-swipe-btn{min-width:120px}
.gg-plan-person{border:1px solid var(--gg-line);border-radius:16px;padding:12px;margin:0 0 12px;background:hsl(var(--card))}
.gg-plan-head{display:flex;gap:8px;align-items:center}
.gg-plan-head input{flex:1;min-width:0;font-weight:700}
.gg-plan-budget{width:110px;flex:none}
.gg-plan-bar{height:8px;border-radius:999px;background:hsl(var(--muted));overflow:hidden;margin:10px 0 4px}
.gg-plan-bar i{display:block;height:100%;background:var(--gg-olive)}
.gg-plan-bar i.over{background:#b26862}
.gg-plan-money{display:flex;justify-content:space-between;font-size:12.5px;color:var(--gg-muted)}
.gg-plan-money .over{color:#b26862;font-weight:700}
.gg-plan-idea{display:flex;gap:6px;align-items:center}
.gg-plan-check{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;cursor:pointer}
.gg-plan-idea .gg-plan-iname{flex:1;min-width:0;font-size:14px;overflow-wrap:anywhere}
.gg-plan-idea.bought .gg-plan-iname{text-decoration:line-through;color:var(--gg-muted)}
.gg-plan-price{width:90px;flex:none}
.gg-plan-head .gg-plan-budget,.gg-fun-row>.gg-plan-price,.gg-plan-idea .gg-plan-price{flex:0 0 auto}
.gg-plan-add{flex-wrap:wrap}
@media (max-width:379px){.gg-plan-add>input:first-child{flex:1 1 100%}}
.gg-plan-totals{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center}
.gg-plan-totals b{display:block;font-size:18px}
.gg-plan-totals span{font-size:12px;color:var(--gg-muted)}
.gg-santa-link{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;border-top:1px solid var(--gg-line);padding:10px 0}
.gg-santa-link:first-child{border-top:0}
.gg-santa-link b{font-size:15px;overflow-wrap:anywhere}
@media (max-width:479px){.gg-swipe-card .gg-photo,.gg-swipe-card .gg-letter,.gg-swipe-card .gg-thumb{width:200px;height:200px}.gg-plan-budget{width:92px}.gg-plan-price{width:78px}}
`;
