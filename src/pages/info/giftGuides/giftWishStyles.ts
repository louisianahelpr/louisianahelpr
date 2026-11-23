/**
 * My Wish List, its share and the how-to hints (owner 2026-11-20). Shipped in the gift guides' own lazy chunk next to
 * GIFT_GUIDES_CSS. The first heart's note is portaled to <body>, outside .gg, so its rules are not scoped and carry
 * their own colours from the app's tokens.
 */
export const GIFT_WISH_CSS = `
.gg-hint{display:flex;align-items:flex-start;gap:6px;margin:8px 0;padding:8px 6px 8px 12px;border-radius:12px;background:var(--gg-soft);color:var(--gg-ink);font-size:13px;line-height:1.4;max-width:46rem}
.gg-hint-text{flex:1;min-width:0;padding-top:4px}
.gg-hint-x{display:inline-flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;border:0;border-radius:999px;background:transparent;color:inherit;font-size:20px;line-height:1;cursor:pointer}
.gg-hint-x:focus-visible{outline:2px solid hsl(var(--bark));outline-offset:1px}
.gg-wish-name{display:flex;flex-direction:column;gap:4px;margin:4px 0 12px;max-width:26rem}
.gg-wish-share{margin:8px 0}
.gg-wish-share-btn{min-height:44px;border-radius:999px;padding:0 20px;font-weight:700}
.gg-wish-share-menu{display:flex;flex-direction:column;gap:8px;margin-top:10px;padding:12px;border:1px solid var(--gg-line);border-radius:14px;max-width:34rem}
.gg-wish-link{width:100%;min-height:40px;padding:8px 12px;border:1px solid var(--gg-line);border-radius:10px;font-size:13px;background:hsl(var(--background));color:var(--gg-ink)}
.gg-wish-list>li.gg-wish-row{grid-template-columns:minmax(0,1fr)}
.gg-wish-mine{position:relative}
.gg-wish-mine .gg-heart-wish{position:absolute;top:6px;right:6px}
/* Phone (owner 2026-11-22, on the guides' rows: "On the phone the heart goes in the bottom right below the price"): a wish
   row reads like a guide row. Its "On Amazon · ~$4" line sat in the name's top-right column and squeezed the name to
   about four letters ("Mrs. Mey..." at 375), so below 768px the name takes the whole text column and the store and
   price go on one line under it; on My Wish List the heart sits at the row's bottom-right (its icon at the box's right
   edge) and that line stops 48px short of it (the name is two lines at most, so only that line reaches the heart's
   height), so a row stays the photo's height. The computer keeps the card. */
@media (max-width:767px){
.gg-wish-list .gg-nm{grid-template-columns:minmax(0,1fr)}
.gg-wish-list .gg-nm .gg-nm-meta{grid-column:1;grid-row:2;justify-content:flex-start;flex-wrap:wrap;gap:0 6px;margin-top:4px;min-width:0}
.gg-wish-mine .gg-heart-wish{top:auto;bottom:0;right:0;justify-content:flex-end}
.gg-wish-mine .gg-nm .gg-nm-meta{padding-right:48px}
}
.gg-toast .gg-toast-undo{border:0;background:transparent;min-height:44px;padding:0 14px;font:inherit;font-weight:700;cursor:pointer}
.gg-wish-own{display:inline-block;margin:18px 0 4px}
.gg-deal{position:relative}
.gg-deal .gg-heart-deal,.gg-sb .gg-heart-sb{position:absolute;top:6px;right:6px}
/* Lead 11-22 night (train l screenshot crop-sales-hearts-375): a deal card's heart sits on the store's photo, and on a
   full-bleed logo (Oriental Trading's purple, The Home Depot's orange) the thin rose outline vanished. Still no circle
   behind it (owner 11-21): an unsaved deal heart is white inside its rose outline, with a firmer white edge and a soft
   shadow, so it reads on any colour; a saved one stays filled rose. Same spot. */
.gg-deal .gg-heart-deal[aria-pressed="false"] path{fill:#fff}
.gg-deal .gg-heart-deal svg{filter:drop-shadow(0 0 1px #fff) drop-shadow(0 0 1px #fff) drop-shadow(0 1px 2px rgba(0,0,0,.35))}
.gg-sb{position:relative}
.gg-toast{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:10px;width:max-content;max-width:min(calc(100vw - 32px),30rem);box-sizing:border-box;padding:6px 6px 6px 16px;border-radius:999px;background:hsl(var(--ink-deep));color:hsl(var(--background));font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,.2);pointer-events:auto}
.gg-toast-text{flex:1 1 auto;min-width:0;line-height:1.3}
.gg-toast-short{display:none}
@media (max-width:400px){.gg-toast{gap:6px;padding:4px 4px 4px 14px}.gg-toast-text,.gg-toast-link{white-space:nowrap}}
@media (max-width:340px){.gg-toast .gg-toast-long{display:none}.gg-toast .gg-toast-short{display:inline}}
.gg-toast .gg-toast-link{color:inherit;font-weight:700;text-decoration:underline;white-space:nowrap}
.gg-wish-title{margin:2px 0 4px;font-size:26px;line-height:1.2;font-weight:700;overflow-wrap:anywhere}
.gg-wish-lead{margin:8px 0 0;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--gg-muted)}
.gg-wish-missing{margin:6px 0 0;font-size:13px;color:var(--gg-muted)}
.gg-shared-person{margin:18px 0 0}
.gg-shared-person-name{margin:0;font-size:20px;line-height:1.25;font-weight:700;overflow-wrap:anywhere}
/* Managing a list (owner 11-21, ManageList.tsx): the budget line and the list's own actions, here so the planner (fun pages)
   and the guides' sheet both have them. */
.gg-list-over{color:hsl(var(--amber-ink));font-weight:700}
.gg-list-left{color:var(--gg-muted)}
.gg-mylists-actions{display:inline-flex;gap:14px;align-items:center}
.gg-list-delete{align-self:flex-start;margin-top:8px;color:hsl(var(--amber-ink))}
/* The Save for someone sheet's box (owner 11-21): the save/remove tap, then one quiet icon row: Open, Edit, Delete. */
.gg-savefor-box{border:1px solid var(--gg-line);border-radius:14px;background:hsl(var(--card))}
.gg-savefor-box[data-on]{border-color:hsl(var(--bark));box-shadow:inset 0 0 0 1px hsl(var(--bark))}
.gg .gg-savefor-box .gg-savefor-row{border:0;box-shadow:none;background:transparent;border-radius:14px}
/* Polish audit 1122 #22: the box's icons sit on the same line as its + / check (the open icon sat alone on a second
   line under the text); an edit form opened from them takes the full width under the row. */
.gg-savefor-box{display:flex;flex-wrap:wrap;align-items:center}
.gg-savefor-box>.gg-savefor-row{flex:1 1 0;min-width:0}
.gg-savefor-tools{display:flex;flex:none;justify-content:flex-end;gap:2px;padding:0 6px 0 0}
.gg-savefor-box>:not(.gg-savefor-row):not(.gg-savefor-tools){flex-basis:100%}
.gg-savefor-tool{color:var(--gg-muted)}
@media (hover:hover){.gg-savefor-tool:hover{background:hsl(var(--muted));color:var(--gg-ink)}}
.gg-savefor-tool:disabled{opacity:.5}
.gg-savefor-tool svg{width:18px;height:18px}
.gg-savefor-tool:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:1px}
.gg-savefor-box .gg-savefor-form{padding:0 12px 10px}
.gg-mylists-gift{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;flex:none;border-radius:10px;background:var(--gg-soft);color:var(--gg-olive)}
.gg-mylists-gift svg{width:20px;height:20px}
/* Owner 11-22 #13: My Wish List opens on its banner, whose own hairline sits right above; no second rule over the empty list. */
.gg [data-gift-my-list-empty]{border-top:0;margin-top:0}
`;
