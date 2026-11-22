import type { ReactNode } from "react";
import type { PrintablePagePath } from "@/content/printables";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { GIFT_GUIDES_CSS } from "../giftGuidesStyles";
import { GIFT_WISH_CSS } from "../giftWishStyles";
import { giftGuides as G } from "@/content/giftGuides";
import BackButton from "@/components/BackButton";
import { GiftGuideTools } from "../GiftGuideShare";
import { GiftGuidesSidebar } from "../GiftGuidesSidebar";

type FunPath = "/gift-guides/swipe" | "/gift-guides/planner" | "/gift-guides/draw-names" | "/gift-guides/printables" | PrintablePagePath;

/**
 * The shared shell's props for a fun page: the gift guides' public header, back to /gift-guides. Like every other gift
 * guides page the shell's own header row is off (hideHeader) and FunBody draws the guides' head row (holiday audit 1121
 * #13: the four fun pages had no search / My list heart / Share row and no left menu).
 */
export const funHeader = (title: string) => ({ title, backTo: "/gift-guides", bottomPaddingClassName: "pb-12 md:pb-16", wrapTitle: true, hideHeader: true });

/**
 * The body of the four fun pages (owner 2026-11-20), inside each page's own <PublicHeaderPage {...funHeader(title)}>
 * (the shared shell, src/test/shellConsistency.test.ts): the guides' own styles plus FUN_CSS and one centered column.
 * The three public pages take their head from PUBLIC_PAGE_META (the same words api/share.ts writes before JS); a
 * private page (a Secret Santa reveal) is noindex.
 */
export function FunBody({ title, path, noindex, tools = true, children }: { title: string; path: FunPath; noindex?: boolean; tools?: boolean; children: ReactNode }) {
  const meta = PUBLIC_PAGE_META[path];
  usePageMeta(noindex ? { title: `${title} — Helpr`, description: meta.description, robots: "noindex", noCanonical: true } : meta);
  return (
    <>
      <style>{GIFT_GUIDES_CSS}{GIFT_WISH_CSS}{FUN_CSS}</style>
      <GuidesFrame title={title} path={path} tools={tools}>
        <div className="gg-fun w-full" data-gift-fun={path}>{children}</div>
      </GuidesFrame>
    </>
  );
}

/**
 * The gift guides' frame for a page outside GiftGuides.tsx (the fun pages, /shop-small): the head row (back arrow +
 * title, then search, My list heart with its count, Share), then the page, the left menu and the disclosures (holiday
 * audit 1121 #13: the fun pages had no head row or menu; #73: /shop-small's title sat apart from its column). The
 * caller brings GIFT_GUIDES_CSS. `disclosures` off only on a page with no affiliate link.
 */
/** `tools` off (the printables, owner 2026-11-21: "remove the search, favorite ... just polish this"): no search, heart
 * or share in the head row, where there is nothing to search or save. */
export function GuidesFrame({ title, path, disclosures = true, tools = true, children }: { title: string; path: string; disclosures?: boolean; tools?: boolean; children: ReactNode }) {
  return (
    <div className="gg w-full" data-gift-fun-frame="">
      <div className="gg-headrow gg-headrow-noship" data-gift-headrow="">
        <div className="gg-head-title" data-gift-head-title="">
          <BackButton to="/gift-guides" />
          <h1 className="text-page-title leading-tight" data-gift-head-name="">{title}</h1>
        </div>
        {tools && <GiftGuideTools path={path} title={title} />}
      </div>
      {/* Page, then menu, then disclosures in the code (holiday audit 1121 #22 / #27), as on the guides. */}
      <div className="gg-layout">
        <div className="gg-main">{children}</div>
        <GiftGuidesSidebar active={null} page={path} />
        {/* Holiday audit 1121 (High): Swipe's Shop links and the planner's ideas are affiliate links (Amazon's among
            them), so every fun page ends with the same two plain muted lines as the guides: the FTC disclosure
            (16 CFR Part 255) and the statement the Amazon Associates agreement requires. */}
        {disclosures && (
          <footer className="gg-disc" data-gift-fun-disclosure="">
            <p data-gift-disclosure="">{G.disclosure}</p>
            <p data-gift-amazon-statement="">{G.amazonStatement}</p>
          </footer>
        )}
      </div>
    </div>
  );
}

/** Scoped under .gg like the guides' own CSS, shipped in the fun pages' lazy chunks only. */
const FUN_CSS = `
.gg-fun{max-width:640px;margin:0;padding:4px 0 24px}
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
.gg-swipe-acts{align-items:center}
.gg-swipe-acts .gg-shop-btn{margin:0;padding:0 6px}
@media (max-width:479px){.gg-swipe-done .gg-fun-actions>a,.gg-swipe-done .gg-fun-actions>button:not(.gg-link){flex:1 1 100%}}
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
.gg-plan-idea .gg-photo,.gg-plan-idea .gg-thumb{width:40px;height:40px;flex:none}
.gg-plan-idea .gg-letter{font-size:9px;overflow:hidden}
.gg-plan-iname-t{display:block}
.gg-plan-shop{display:inline-flex;align-items:center;min-height:44px;font-size:13px;font-weight:600}
.gg-money-box{position:relative;display:inline-flex;flex:none;align-items:center}
.gg-money-box .gg-money-sign{position:absolute;left:11px;top:50%;transform:translateY(-50%);font:500 15px Montserrat,sans-serif;color:var(--gg-muted);pointer-events:none}
.gg-fun .gg-money-box input{width:100%;padding-left:22px}
.gg-plan-picker{padding:0;max-width:none}
.gg-plan-picker-chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
.gg-plan-picks{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:4px;max-height:min(52vh,440px);overflow-y:auto;overscroll-behavior:contain}
.gg-plan-pick{display:flex;gap:10px;align-items:center;width:100%;min-height:60px;padding:6px;border:0;border-radius:12px;background:transparent;text-align:left;cursor:pointer;color:var(--gg-ink)}
.gg-plan-pick:hover:not(:disabled){background:hsl(var(--muted))}
.gg-plan-pick:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:2px}
.gg-plan-pick:disabled{cursor:default;opacity:.6}
.gg-plan-pick .gg-photo,.gg-plan-pick .gg-thumb{width:48px;height:48px;flex:none}
.gg-plan-pick-nm{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.gg-plan-pick-name{font-size:14px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.gg-plan-pick-nm small{font-size:13px;color:var(--gg-muted)}
.gg-plan-pick-act{flex:none;min-width:44px;text-align:center;font-size:13px;font-weight:700;color:var(--gg-olive)}
.gg-plan-pick-act.add{font-size:22px;font-weight:600;line-height:1}
@media (max-width:479px){.gg-plan-idea{gap:4px}.gg-plan-idea .gg-photo,.gg-plan-idea .gg-thumb{width:34px;height:34px}.gg-plan-idea .gg-plan-price{width:62px}}
.gg-plan-head .gg-plan-budget,.gg-fun-row>.gg-plan-price,.gg-plan-idea .gg-plan-price{flex:0 0 auto}
.gg-plan-totals{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;text-align:center}
.gg-plan-totals b{display:block;font-size:18px}
.gg-plan-totals span{font-size:12px;color:var(--gg-muted)}
.gg-santa-link{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;border-top:1px solid var(--gg-line);padding:10px 0}
.gg-santa-link:first-child{border-top:0}
.gg-santa-link b{font-size:15px;overflow-wrap:anywhere}
.gg-santa-who{display:inline-flex;flex-wrap:wrap;align-items:baseline;gap:8px;min-width:0}
@media (max-width:479px){.gg-swipe-card .gg-photo,.gg-swipe-card .gg-letter,.gg-swipe-card .gg-thumb{width:200px;height:200px}.gg-plan-budget{width:92px}.gg-plan-price{width:78px}}
`;
