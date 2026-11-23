/**
 * The /gift-guides look: the owner's FINAL design (2026-11-18 mockup, ~/Desktop/Gift-guide-mockup-final-1118.html).
 * App white with the app's own olive tokens (no tan on the landing): a 220px sticky sidebar listing every guide by group
 * (groups collapsed until tapped, on phones too), one sideways-scrolling row of square cover tiles per group with "See all", and for
 * one guide the same words-only header above a numbered list (small product photo on white, name, Shop).
 *
 * Scoped under .gg and shipped inside the page's own lazy chunk, so it adds nothing to the app stylesheet (the CSS
 * budget) or the critical path. Colours are the app's tokens, so dark mode follows the app's own theme. Fonts are the
 * app's Montserrat (body) and Bodoni Moda (the text covers), both already self-hosted.
 */
export const GIFT_GUIDES_CSS = `
.gg{--gg-olive:hsl(var(--bark));--gg-soft:hsl(var(--bark) / .14);--gg-line:hsl(var(--card-hairline));--gg-muted:hsl(var(--muted-foreground));
--gg-ink:hsl(var(--ink-deep));
color:var(--gg-ink)}
.gg-layout{display:grid;grid-template-columns:220px minmax(0,1fr);grid-template-rows:auto 1fr}
.gg-layout>.gg-side{grid-column:1;grid-row:1/span 2}
.gg-layout>.gg-main{grid-column:2;grid-row:1}
.gg-layout>.gg-disc{grid-column:2;grid-row:2;margin-left:24px;align-self:start}
.gg-side{border-right:1px solid var(--gg-line);padding:16px 16px 20px 0;font-size:13px;position:sticky;top:var(--gg-side-top,72px);align-self:start;max-height:calc(100dvh - var(--gg-side-top,72px));overflow-y:auto}
.gg-search{position:relative;display:block;margin:0}
.gg-search svg{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--gg-muted)}
.gg-search input{width:100%;min-height:44px;font:500 16px Montserrat,sans-serif;padding:0 12px 0 40px;border:1px solid hsl(var(--bark) / .2);border-radius:12px;background:hsl(var(--card));color:var(--gg-ink)}
.gg-search-none{padding:8px 10px;color:var(--gg-muted)}
.gg-tile-li{position:relative;display:flex;flex-direction:column}
.gg-heart{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;border:0;background:transparent;border-radius:999px;cursor:pointer}
/* Owner 11-21 ("remove the circle around the heart"): no circle, fill or shadow behind any card heart (.gg-heart-pick,
   -wish, -deal, -sb), only the heart with a thin white halo so it reads over a photo; the button keeps its 44px tap area. */
.gg-heart svg{filter:drop-shadow(0 0 1px rgba(255,255,255,.95)) drop-shadow(0 0 2px rgba(255,255,255,.8))}
.gg-list>li{position:relative;display:grid;grid-template-columns:minmax(0,1fr);align-items:start}
.gg-list>li>.gg-item{min-width:0}
.gg-shop-btn{grid-column:1/-1;justify-self:start;display:inline-flex;align-items:center;min-height:44px;margin:-4px 0 8px 100px;padding:0 6px 0 0;border:0;border-radius:0;background:none;font-size:14px;font-weight:700;color:var(--gg-olive);text-decoration:none}
.gg-shop-btn:hover,.gg-shop-btn:focus-visible{text-decoration:underline}
.gg-side details{border-top:0}
.gg-side summary{list-style:none;cursor:pointer;display:flex;align-items:center;min-height:38px;padding:0 10px;border-radius:8px;font-size:13px;font-weight:600;color:var(--gg-ink)}
.gg-side summary:hover{background:hsl(var(--muted) / .6)}
.gg-side-n{margin-left:auto;padding-left:8px;font-size:12px;font-weight:400;color:var(--gg-muted);font-variant-numeric:tabular-nums}
.gg-side-h{margin:14px 10px 4px;padding-top:12px;border-top:1px solid var(--gg-line);font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--gg-muted)}
.gg-side summary::-webkit-details-marker{display:none}
.gg-side summary::after{content:"+";margin-left:auto;font-size:15px;line-height:1}
.gg-side details[open] summary::after{content:"\\2212"}
.gg-side ul{list-style:none;margin:0 0 8px;padding:0}
.gg-side>.gg-side-h:first-child{margin-top:0;padding-top:0;border-top:0}
.gg-side details a{padding-left:28px}
.gg-side ul ul a{padding-left:44px;font-size:12.5px}
.gg-side ul ul{margin:0}

.gg-side a{display:flex;align-items:center;min-height:44px;padding:4px 10px;border-radius:8px;color:var(--gg-ink);text-decoration:none}
.gg-side a:hover{background:hsl(var(--muted) / .6)}
.gg-side a[aria-current="page"]{background:var(--gg-soft);color:var(--gg-olive);font-weight:700}
@media (hover:hover) and (pointer:fine){.gg-side a{min-height:36px}.gg-side .gg-side-h{margin-top:10px}}
@media (hover:hover) and (pointer:fine) and (max-height:889px),(not ((hover:hover) and (pointer:fine))) and (max-height:1039px){.gg-side{position:static;max-height:none;overflow:visible}}
.gg-main{padding:8px 0 28px 24px;min-width:0}
.gg-rowhead{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:18px 0 10px}
.gg-rowcount{font-weight:500;letter-spacing:.06em}.gg-rowhead h2,.gg-rowhead h3{display:flex;align-items:center;font-size:13px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--gg-muted);margin:0}
.gg-link{display:inline-flex;align-items:center;min-height:44px;font-size:13px;font-weight:700;color:var(--gg-olive);text-decoration:none}
.gg-link:hover,.gg-link:focus-visible{text-decoration:underline}
.gg-row{display:flex;gap:14px;overflow-x:auto;padding-bottom:8px;scrollbar-width:thin;list-style:none;margin:0;padding-left:0;scroll-snap-type:x proximity}
.gg-row>li{width:150px;flex:none;scroll-snap-align:start}
.gg-wrap{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:18px 14px;list-style:none;margin:0;padding:0}
.gg-tile{display:block;color:var(--gg-ink);text-decoration:none}
.gg-cover{display:block;width:100%;height:auto;aspect-ratio:1/1;object-fit:cover;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.gg-tile:hover .gg-cover,.gg-tile:focus-visible .gg-cover{outline:2px solid var(--gg-olive);outline-offset:2px}
/* The three cover families, exactly the covers' gingham (scripts/gift-guide-photo-covers.py FAMILY: check, band, cream;
   owner 11-21: "a more christmas red and christmas green", beige softened as on the covers), so a guide's banner, text
   cover and menu dot match its cover photo. */
.gg-green{--c-cross:rgb(38 94 60);--c-band:rgb(150 178 154);--c-dot:#265e3c}.gg-red{--c-cross:rgb(168 36 42);--c-band:rgb(222 150 148);--c-dot:#a8242a}.gg-oat{--c-cross:rgb(219 204 180);--c-band:rgb(231 220 202);--c-dot:#ceba98}
.gg-words{text-align:center;padding:10px 16px 14px;border-bottom:1px solid var(--gg-line);margin-bottom:4px}.gg-banner-wrap{padding:4px 0 10px}.gg-banner{display:flex;justify-content:center;align-items:flex-end;height:184px;padding:14px 16px 0;border-radius:14px;overflow:hidden}.gg-arch{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:min(440px,72%);height:100%;padding:34px 18px 10px;background:#fffdf7;border:1px solid #e6dccd;border-bottom:0;border-radius:999px 999px 0 0;box-shadow:0 0 0 7px rgba(255,253,247,.85)}.gg-banner .gg-lead{font-size:18px;line-height:1.1}.gg-banner h1{font-size:30px;line-height:1.08;margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}@media (max-width:767px){.gg-banner{height:148px;padding-top:10px}.gg-arch{width:min(300px,64%);padding:22px 10px 8px}.gg-banner .gg-lead{font-size:15px}.gg-banner h1{font-size:22px}}:root[data-theme="dark"] .gg-banner .gg-lead,:root[data-theme="dark"] .gg-banner h1{color:#3b2a20}
.gg-words .gg-lead{font-family:'Bodoni Moda','Bodoni Moda Fallback',Georgia,serif;font-style:italic;font-size:22px;color:#6b5a48;margin:0}
.gg-words h1{font-family:'Bodoni Moda','Bodoni Moda Fallback',Georgia,serif;font-weight:500;font-size:34px;line-height:1.1;margin:0 0 8px;color:#3b2a20;text-wrap:balance}
/* Owner 11-21 ("move gifts for up, it's too close to the main title"): a clear gap between the banner's lead and its name. */
.gg-banner .gg-lead{margin:0 0 12px}

.gg-ship{margin:0;font-size:12px;font-weight:600;line-height:1.3;color:#3f5a1c;background:#eef2e6;border-radius:999px;padding:5px 12px;white-space:nowrap}@media (max-width:479px){.gg-ship{white-space:normal;max-width:52vw;font-size:11px;text-align:center;padding:4px 10px;border-radius:14px}}
.gg-tools{display:flex;align-items:center;justify-content:center;gap:4px;max-width:440px;margin:8px auto 0}
/* Owner 11-21 ("make search an icon always"): a 44px magnifier like the heart and Share at every width; opened, the field
   is 300px beside them (a phone lays it over the icon row, inside the screen). */
.gg-tools{position:relative}
.gg-tools-search{position:relative;flex:0 0 auto;min-width:0}
.gg-tools-search.is-open{width:min(360px,calc(100vw - 40px));display:flex;align-items:center}.gg-tools-search.is-open .gg-search{flex:1 1 auto;min-width:0}
.gg-tools-search .gg-search input{padding-right:44px}
.gg-search-close{position:absolute;right:0;top:50%;transform:translateY(-50%);background:transparent;color:var(--gg-muted)}
/* Owner 2026-11-22 (polish the search bar; her iPhone: the open field slid over the row and cut off "83 gift",
   with a heavy dark-olive ring): a soft field (thin light-olive border, white, 12px corners) whose focus darkens the
   border and adds a light ring. Owner 2026-11-22 evening ("keep count on row", for every guide too): on a phone the
   open search keeps the count ("146 gifts", never wrapped) at the left of its row and the field takes the rest of the
   row in place at the same 44px height; the order-by pill and the other icons step out (display:none, nothing under
   it, nothing cut), the results drop under the whole row, and the ✕ or Escape puts the row back exactly. The computer
   keeps its row (below). */
.gg-search:focus-within input{border-color:hsl(var(--bark) / .55)}
.gg-search-count{padding:6px 12px 4px;font-size:12px;font-weight:600;color:var(--gg-muted)}
@media (max-width:767px){
.gg-tools-search.is-open{position:relative;flex:1 1 auto;width:100%}
.gg-tools-search.is-open [data-search-trigger-slot]{display:none}
.gg-countrow:has(.gg-tools-search.is-open){position:relative;flex-wrap:nowrap}
.gg-countrow:has(.gg-tools-search.is-open)>.gg-countrow-left{flex:none;flex-wrap:nowrap}
.gg-countrow:has(.gg-tools-search.is-open)>.gg-countrow-left>:not(.gg-itemcount){display:none}
.gg-countrow:has(.gg-tools-search.is-open) .gg-itemcount{white-space:nowrap}
.gg-countrow:has(.gg-tools-search.is-open)>.gg-tools{flex:1 1 0;min-width:0;margin:0;position:static}
.gg-countrow .gg-tools-search.is-open{position:static}
.gg-tools:has(>.gg-tools-search.is-open)>:not(.gg-tools-search){display:none}
}
/* The Holiday Hub's own search row (owner 2026-11-22: "keep count on row"): open, the count keeps the left of the row
   (it may wrap in its own column, never onto a line of its own), the soft field takes the room to its right (at least
   160px, at most 360px from 768px up, pushed to the right), then the held magnifier slot and the filter. A row under
   500px (every phone) shows the count as its number only; the words stay for screen readers. Under 300px (a 320
   phone) the field drops its own magnifier so the whole placeholder fits. */
[data-holiday-searchrow]{container-type:inline-size}
[data-holiday-searchrow="open"]{gap:2px}
.hh-count-open{flex:0 1 auto;min-width:auto}
.hh-count-short{display:none}
.hh-search{flex:1 0 160px;min-width:160px;margin-left:auto}
@container (min-width:500px){.hh-search{flex-basis:192px}}
.hh-search input{padding-right:44px}
@media (min-width:768px){.hh-search{max-width:360px}}
@container (max-width:499px){.hh-count-full{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.hh-count-short{display:inline}}
@container (max-width:299px){.hh-search>svg{display:none}.hh-search input{padding:0 34px 0 8px;text-overflow:ellipsis}}
/* The computer: the open field takes up to 360px and gives way before it would reach the title (at 768 it ran over
   "Holiday gift guides"); below 1280px the order-by pill steps out while the search is open. */
@media (min-width:768px){.gg-tools-search.is-open{flex:0 1 360px;width:auto;min-width:0}.gg-tools:has(>.gg-tools-search.is-open){max-width:none}}
@media (min-width:768px) and (max-width:1279px){.gg-headrow:has(.gg-tools-search.is-open)>.gg-ship{display:none}}
/* Owner 11-21: ONE header row from 768px up: back arrow + title, the shipping pill, then search + heart + share
   pushed right, all centred; a phone wraps it (arrow + title, then the pill and the icons). The shell's own header row
   is off, so this row keeps the shell's air above it (--shell-gap on a phone, 24px from sm up). */
.gg-headrow{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:var(--shell-gap,12px) 0 12px}
.gg-head-title{display:flex;align-items:center;gap:12px;min-width:0;flex:1 1 100%}
/* Holiday audit 1121 (High): on a phone the title may wrap. Kept on one line it set the whole page's minimum width
   (arrow 36 + gap + ~266px of title), so signed in, where the shell's column shrinks to fit its content, the page grew
   wider than the screen and clipped share, the hearts and sort (at 375 on the old header, at 320 on today's). One line
   from 768px up (the owner's one header row). */
.gg-head-title .text-page-title{margin:0;min-width:0;overflow-wrap:anywhere}
.gg-headrow .gg-ship{flex:none;max-width:none}
.gg-headrow .gg-tools{margin:0 0 0 auto;flex:0 1 auto;justify-content:flex-end}
.gg-search input::placeholder{color:var(--gg-muted);opacity:1}
.gg-sort-check{display:inline-block;width:16px;flex:none}
[data-gift-sort-menu]{min-width:200px}[data-gift-sort-menu] button{white-space:nowrap}
@media (min-width:640px){.gg-headrow{padding-top:24px}}
@media (min-width:768px){.gg-head-title{flex:0 0 auto}.gg-headrow{flex-wrap:nowrap}.gg-headrow .gg-tools{flex:1 1 auto;min-width:0}.gg-head-title .text-page-title{white-space:nowrap}}
.gg-search-results{position:absolute;z-index:6;top:calc(100% + 6px);left:0;right:0;list-style:none;margin:0;padding:4px;max-height:60vh;overflow-y:auto;text-align:left;background:hsl(var(--background));border:1px solid var(--gg-line);border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.12);font-size:14px}
.gg-search-results a{display:flex;align-items:center;min-height:44px;padding:0 12px;border-radius:8px;color:var(--gg-ink);text-decoration:none}
.gg-search-results a{gap:10px;padding:4px 12px}
.gg-search-thumb{width:36px;height:36px;flex:none;border-radius:8px;object-fit:cover}.gg-search-thumb-item{object-fit:contain}
.gg-search-head{padding:8px 12px 2px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--gg-muted)}
.gg-search-item{display:flex;flex-direction:column;min-width:0}.gg-search-item-name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.3}.gg-search-item small{font-size:12px;color:var(--gg-muted)}
.gg-search-results a:hover,.gg-search-results a:focus-visible{background:hsl(var(--muted) / .6)}
.gg-icon{position:relative;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;border-radius:999px;color:var(--gg-ink);background:transparent;border:0;text-decoration:none}
/* Owner 11-22, no circles on header icons: a tap on a phone leaves :hover set on iOS, so the hover and open-menu fill
   apply only where a real pointer hovers; keyboard focus shows a ring, never a filled circle. */
.gg-icon:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:-2px;border-radius:8px}
@media (hover:hover){.gg-icon:hover,.gg-icon[aria-expanded="true"]{background:hsl(var(--muted) / .7)}}
.gg-mylist-icon{color:#8c3b3b}
.gg-icon-dot{position:absolute;top:9px;right:9px;width:9px;height:9px;border-radius:50%;background:#8c3b3b;box-shadow:0 0 0 2px hsl(var(--background))}
.gg-icon-count{position:absolute;top:4px;right:2px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#8c3b3b;color:#fff;font-size:10px;font-weight:700;line-height:16px;text-align:center}
.gg-share-wrap{position:relative;display:inline-flex;align-items:center}
.gg-share-menu{position:absolute;z-index:6;top:calc(100% + 6px);right:0;display:flex;flex-direction:column;min-width:200px;white-space:nowrap;background:hsl(var(--background));border:1px solid var(--gg-line);border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.12);padding:4px}
.gg-share-menu a,.gg-share-menu button{display:flex;align-items:center;min-height:44px;padding:0 12px;font-size:13px;font-weight:600;color:var(--gg-ink);text-decoration:none;background:none;border:0;text-align:left;border-radius:8px}
.gg-share-menu a:hover,.gg-share-menu button:hover{background:hsl(var(--muted) / .6)}
/* Polish audit 1122 #10: one sub-page title (the frame pages, My Wish List, a shared list): the serif, left-aligned at
   the top of the content column under the head row. */
.gg-words.gg-pagehead{text-align:left;padding:0 0 12px;margin:0 0 16px}
.gg-pagehead h1,.gg .gg-wish-title{font-family:'Bodoni Moda','Bodoni Moda Fallback',Georgia,serif;font-weight:500;font-size:32px;line-height:1.15;margin:0;color:#3b2a20;text-wrap:balance}
@media (max-width:767px){.gg-pagehead h1,.gg .gg-wish-title{font-size:28px}.gg-words.gg-pagehead{padding-top:14px}
}
:root[data-theme="dark"] .gg .gg-wish-title{color:var(--gg-ink)}
:root[data-theme="dark"] .gg-words .gg-lead,:root[data-theme="dark"] .gg-words h2,:root[data-theme="dark"] .gg-words > h1{color:var(--gg-ink)}
.gg-check{background-color:rgb(250 247 239);background-image:conic-gradient(at 30px 30px,var(--c-band) 0 90deg,transparent 0 180deg,var(--c-band) 0 270deg,var(--c-cross) 0);background-size:60px 60px}
.gg-dot{display:inline-block;width:11px;height:11px;border-radius:3px;border:1px solid rgba(0,0,0,.1);margin-right:8px;flex:none;background:var(--c-dot)}
.gg-textcover{display:flex;align-items:center;justify-content:center;padding:14%;text-align:center;border:1px solid var(--gg-line)}
.gg-textcover strong{display:block;background:#fffdf7;border:1px solid #e6dccd;border-radius:999px 999px 10px 10px;padding:30% 8% 18%;width:100%;font-family:'Bodoni Moda','Bodoni Moda Fallback',Georgia,serif;font-size:15px;font-weight:500;line-height:1.15;color:#3b2a20;overflow-wrap:anywhere}
.gg-name{display:block;font-size:14px;font-weight:600;margin-top:7px;text-align:center;line-height:1.3}
.gg-count{display:block;font-size:11px;color:var(--gg-muted);text-align:center}
.gg-list{list-style:none;margin:16px 0 0;padding:0;counter-reset:gg}
article[data-gift-guide]>section:first-child>.gg-list,article[data-gift-guide]>.gg-itemcount+section>.gg-list{margin-top:0}article[data-gift-guide]>section:first-child>.gg-list>li:first-child,article[data-gift-guide]>.gg-itemcount+section>.gg-list>li:first-child{border-top:0}
.gg-itemcount{margin:6px 0 4px;font-size:12px;font-weight:600;letter-spacing:.06em;color:var(--gg-muted)}
.gg-chips{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:0;padding:0}
.gg-chip{border-radius:999px;font-weight:600;white-space:nowrap}
.gg-ages{margin:12px 0 4px;padding:12px 14px;border:1px solid var(--gg-line);border-radius:14px;background:#fffdf7}
.gg-ages ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.gg-ages li{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px}
.gg-age-name{min-width:120px;font-size:14px;font-weight:700}.gg-age-name small{font-weight:500;color:var(--gg-muted)}
.gg-people{margin:4px 0 12px}.gg-people-q{margin:0 0 6px;font-size:13px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--gg-muted)}
.gg-ages-title{display:block;margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--gg-muted)}
.gg-agechips{margin:4px 0 10px}
.gg-toprow>li{width:148px}
@media (min-width:1024px){.gg-toprow>li{width:200px}.gg-topcard .gg-thumb{width:200px;height:200px}}
.gg-topcard{display:flex;flex-direction:column;gap:4px;color:var(--gg-ink);text-decoration:none}
.gg-topcard-photo{position:relative;display:block}
.gg-topcard .gg-photo{border-radius:14px;background:#fff}
.gg-topcard .gg-thumb{width:148px;height:148px;border-radius:14px;padding:10px}
.gg-topcard-n{position:absolute;left:8px;bottom:2px;font-family:'Bodoni Moda','Bodoni Moda Fallback',Georgia,serif;font-size:28px;font-weight:700;line-height:1;color:#b8913a;-webkit-text-stroke:2px #fff;paint-order:stroke fill}
.gg-topcard .gg-letter{font-size:14px}
.gg-topcard-name{font-size:13px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.gg-topcard-meta{display:flex;justify-content:space-between;align-items:baseline;gap:6px}
.gg-topcard-meta small{font-size:12px;color:var(--gg-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gg-topcard:hover .gg-topcard-name,.gg-topcard:focus-visible .gg-topcard-name{text-decoration:underline}
.gg-store-deals ul{list-style:none;margin:0;padding:0}
.gg-store-deals li{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 10px;padding:4px 0;border-top:1px solid var(--gg-line)}
.gg-store-deals li .gg-link{min-height:40px;font-weight:600}
.gg-sec-title{margin:24px 0 0;font-size:15px;font-weight:700;color:var(--gg-ink)}
/* Owner 11-21 price sections: the count beside a section heading, quiet. */
.gg-sec-count{font-weight:500;color:var(--gg-muted)}
.gg-sec+.gg-sec .gg-sec-title,.gg-sort+section .gg-sec-title{margin-top:20px}
.gg-list>li{border-top:1px solid var(--gg-line);counter-increment:gg}
.gg-item{display:flex;align-items:center;gap:14px;padding:11px 0;color:var(--gg-ink);text-decoration:none;font-size:15px;min-height:44px}
.gg-photo{display:flex;flex:none;border-radius:10px;background:#fff;isolation:isolate;overflow:hidden}
.gg-thumb{width:52px;height:52px;flex:none;border-radius:10px;border:1px solid var(--gg-line);background:#fff;object-fit:contain}
img.gg-thumb{background:transparent;border:0;mix-blend-mode:multiply}
.gg-list .gg-item{align-items:flex-start;gap:12px;padding:14px 0 2px}
.gg-list .gg-photo{border-radius:12px;background:#fff}
.gg-list .gg-thumb{width:88px;height:88px;border-radius:12px;padding:6px;background:#fff;border:0}
.gg-list img.gg-thumb{background:transparent}
.gg-list .gg-letter{font-size:12px}
.gg-nm-name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:16px;font-weight:500;line-height:1.3}
/* Holiday audit 1121 #67: a sponsor's name carries the show or the product at its end ("... at The Strand Theatre A
   Christmas Carol"), so the sponsors page lets a name run to three lines before it clips. */
[data-gift-guide="25-days-sponsors"] .gg-nm-name{-webkit-line-clamp:3}
/* Visual audit 1122-night #1: on a phone the name column is narrow (126px at 320, 181px at 375), so two lines cut names
   to their brand: Him showed "Smathers & Bran..." on row after row (48 Her/Him/Kids rows at 320 and 4 at 375 read the
   same as another gift, measured on www). A phone row's name runs to three lines (four under 360px wide) before it clips,
   which sits beside the photo and the heart strip; desktop keeps two.
   Guide visual audit 1123b #6: tablets (768-1023, the two-column grid) cut 41+ names a guide at two lines
   ("Touchland Power Mist Hand Sanitiz..."); they now get the phone's three lines too. */
@media (max-width:1023px){.gg-list:not(.gg-top10) .gg-nm-name{-webkit-line-clamp:3}}
@media (max-width:359px){.gg-list:not(.gg-top10) .gg-nm-name{-webkit-line-clamp:4}}
.gg-nm .gg-nm-meta{display:flex;align-items:baseline;gap:8px;margin-top:4px;font-size:12px;font-weight:600;letter-spacing:.04em}
.gg-nm-meta .gg-price{font-size:15px;letter-spacing:0}
.gg-nm-meta .gg-price[data-gift-type]{white-space:nowrap}
.gg-list>li{align-items:flex-start}
@media (min-width:1024px){
.gg-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px 20px;align-items:stretch}
.gg-list>li{position:relative;display:grid;grid-template-columns:minmax(0,1fr);align-items:start;border-top:0}
.gg-list .gg-item{flex-direction:column;align-items:stretch;align-self:stretch;padding:0;gap:10px}
.gg-list .gg-photo{width:100%;border-radius:16px}
.gg-list .gg-thumb{width:100%;height:auto;aspect-ratio:1/1;padding:12px;border-radius:16px}
.gg-list .gg-letter{font-size:16px}
.gg-list .gg-item{margin-bottom:6px}
}
@media (min-width:768px) and (max-width:1023px){
.gg-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 20px;align-items:stretch}
.gg-list>li{position:relative;display:grid;grid-template-columns:minmax(0,1fr);align-items:start;border-top:0}
.gg-list .gg-item{flex-direction:column;align-items:stretch;align-self:stretch;padding:0;gap:10px}
.gg-list .gg-photo{width:100%;border-radius:16px}
.gg-list .gg-thumb{width:100%;height:auto;aspect-ratio:1/1;padding:12px;border-radius:16px}
.gg-list .gg-item{margin-bottom:6px}
}
.gg-letter{display:flex;align-items:center;justify-content:center;text-align:center;padding:3px;overflow:hidden;overflow-wrap:anywhere;line-height:1.05;font-family:'Bodoni Moda','Bodoni Moda Fallback',Georgia,serif;font-size:10px;font-weight:700;color:var(--gg-olive)}
.gg-nm{flex:1;min-width:0;overflow-wrap:anywhere}
/* Owner 2026-11-21 ("Put the price in the top right corner where the heart is ..."): every card (the phone's list row,
   the tablet/desktop grid card, the Top 10 and the finder's results: one PickRow) has the name on the left with the
   price top-right beside its first line. */
.gg-list .gg-nm{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:10px;align-items:start}
.gg-list .gg-nm-name{grid-column:1;grid-row:1}
.gg-list .gg-nm .gg-nm-meta{grid-column:2;grid-row:1;margin-top:0;justify-content:flex-end;min-width:44px}
/* A 25 Days sponsor logo card: its gift sits under the name, never in the narrow price column (owner 11-22). */
.gg-list .gg-badges{grid-column:1/-1;grid-row:2}
/* Owner 2026-11-22 ("move the heart and shopping cart back to the top right of picture. maybe put the shopping cart
   below the heart instead of on the side"): on every card (Her/Him/Kids rows, the 25 Days sponsors page, the finder's
   results and the Top 10) the 44px heart sits on the photo's top-right corner and an Amazon pick's 44px cart right
   under it, one column, both on the photo and outside the card's link. No circle behind either (owner 11-21); the thin
   white halo keeps them readable over a photo. Tablet and desktop: the photo is the card's top, so the column sits 2px
   in from the card's top-right.
   Owner 2026-11-22 later, on her phone ("On the phone the heart goes in the bottom right below the price and the cart
   goes on the left of that. The computer stays the same"): below 768px a guide row (Her/Him/Kids, the sponsors page,
   the finder's results) draws both OFF its 88px photo, in one line at the row's bottom-right under the price: the cart
   left, the heart right, each still a 44px box, its icon pushed to the box's right edge so the heart lines up under the
   price. The name column keeps a 44px strip at its foot, so a two-line name or the chips never run under them (a short
   row stays the photo's height). The Top 10 card (photo on top at every width) and My Wish List keep their own spots. */
.gg-cart{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;margin:0;border-radius:999px;color:var(--gg-olive)}
.gg-list .gg-heart-pick,.gg-list .gg-cart{position:absolute;z-index:1}
@media (max-width:767px){
.gg-list>:where([data-gift-pick])>.gg-heart-pick{bottom:0;right:0;justify-content:flex-end}
.gg-list>:where([data-gift-pick])>.gg-cart{bottom:0;right:44px;justify-content:flex-end}
.gg-list>:where([data-gift-pick]) .gg-nm{padding-bottom:44px}
}
@media (min-width:768px){
.gg-list .gg-heart-pick{top:2px;left:auto;right:2px}
.gg-list .gg-cart{top:46px;left:auto;right:2px}
}
.gg-cart svg{width:20px;height:20px;filter:drop-shadow(0 0 1px rgba(255,255,255,.95)) drop-shadow(0 0 2px rgba(255,255,255,.8))}
.gg-cart:hover{color:hsl(var(--bark))}
.gg-cart:focus-visible{outline:2px solid hsl(var(--bark));outline-offset:1px}

.gg-nm small{display:block;font-size:12px;color:var(--gg-muted)}
.gg-badges{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}
.gg-bdg{font-style:normal;font-size:12px;font-weight:700;letter-spacing:.06em;padding:2px 7px;border-radius:999px;background:#eef2e6;color:#3f5a1c}
.gg-last-note{display:inline-block;white-space:normal;max-width:none;margin:0 0 10px}
.gg-bdg-sponsor{background:#f3dcd8;color:#8c3b3b}
.gg-bdg-tiktok{background:#e9e4f5;color:#4b3a7a}.gg-bdg-preorder{background:#fbefd9;color:#7a5413}.gg-bdg-code{background:var(--gg-soft,#f4efe6);color:var(--gg-ink);letter-spacing:.04em}.gg-bdg-ship{background:#e6eef3;color:#2d4f63}.gg-bdg-back{background:#f6e7e4;color:#7a3b2e}
.gg-sort{margin:8px 0 12px;max-width:440px}
.gg-secnav,.gg-budget{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 12px}.gg-secnav{align-items:center}.gg-secnav-label{flex-basis:100%;font-size:13px;color:var(--gg-muted)}.gg-sec{scroll-margin-top:84px}
/* Holiday audit A #6/#71: the section jump links were 24px bold text; now 44px chips like the budget chips. */
.gg-secnav .gg-chip{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid var(--gg-line);background:hsl(var(--card));color:var(--gg-ink);font-size:14px;text-decoration:none}
.gg-secnav .gg-chip:hover,.gg-secnav .gg-chip:focus-visible{border-color:var(--gg-olive)}
.gg-finder{margin:12px 0 4px;padding:16px 16px 8px;border:1px solid var(--gg-line);border-radius:16px;background:hsl(var(--card))}.gg-finder-step{margin:6px 0 10px}.gg-finder-q{margin:0 0 6px;font-size:14px;font-weight:700;color:var(--gg-ink)}
.gg-finder-title{margin:0;font-family:'Bodoni Moda','Bodoni Moda Fallback',Georgia,serif;font-size:22px;line-height:1.15;font-weight:600;color:var(--gg-ink)}.gg-finder-lead{margin:4px 0 10px;font-size:14px;color:var(--gg-muted)}
@media (min-width:768px){.gg-finder{padding:18px 22px 10px}.gg-finder-title{font-size:24px}}
.gg-finder-folded{padding:0}
.gg-finder-open{display:flex;align-items:center;justify-content:flex-start;gap:12px;width:100%;min-height:64px;padding:12px 16px;border:0;border-radius:16px;background:transparent;text-align:left;cursor:pointer;color:var(--gg-ink);font:inherit;white-space:normal;letter-spacing:normal}
.gg-finder-open:focus-visible{outline:2px solid var(--gg-olive);outline-offset:2px}
.gg-finder-open-words{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.gg-finder-open-words>span{font-family:'Bodoni Moda','Bodoni Moda Fallback',Georgia,serif;font-size:19px;font-weight:600;line-height:1.2}
.gg-finder-open-words small{font-family:Montserrat,sans-serif;font-size:13px;font-weight:500;color:var(--gg-muted)}
.gg-finder-arrow{flex:none;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:999px;background:var(--gg-soft);color:var(--gg-olive);font-family:Montserrat,sans-serif;font-size:17px;font-weight:600}
.gg-finder-open:hover .gg-finder-arrow{background:hsl(var(--bark) / .22)}
.gg-browse{margin:20px 0 4px}
/* The landing's greeting (owner 11-21, option B without gifts): a candy-cane border (red, white, green, white stripes)
   around a cream card; Bodoni italic in the covers' Christmas red, one plain line under it. */
.gg-greet{margin:4px 0 0;padding:9px;border-radius:14px;background:repeating-linear-gradient(-45deg,#a8242a 0 12px,#fff 0 18px,#265e3c 0 30px,#fff 0 36px)}
.gg-greet-in{padding:34px 16px 30px;border-radius:6px;background:linear-gradient(90deg,#f8f0e0,#fffdf7 50%,#f8f0e0);text-align:center}
.gg-greet-h{margin:0;font:italic 600 clamp(24px,7vw,60px)/1.1 'Bodoni Moda','Bodoni Moda Fallback',Georgia,serif;color:#a8242a}
.gg-greet-p{margin:10px 0 0;font-size:clamp(14px,1.6vw,18px);color:#3b2a20}
@media (max-width:767px){.gg-greet{padding:7px}.gg-greet-in{padding:22px 12px 18px}}
.gg-entries{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 14px;list-style:none;margin:0;padding:0}
@media (min-width:640px){.gg-entries{grid-template-columns:repeat(3,minmax(0,1fr));gap:24px 18px}}
@media (min-width:1180px){.gg-entries{grid-template-columns:repeat(6,minmax(0,1fr))}}
.gg-entries>li{min-width:0}
.gg-entry{display:flex;flex-direction:column;color:var(--gg-ink);text-decoration:none}
.gg-entry-photo{display:block;width:100%;height:auto;aspect-ratio:1/1;object-fit:cover;border-radius:14px;box-shadow:0 1px 6px rgba(0,0,0,.07)}
.gg-entry:hover .gg-entry-photo,.gg-entry:focus-visible .gg-entry-photo{outline:2px solid var(--gg-olive);outline-offset:2px}
.gg-entry-title{margin-top:10px;font-size:15px;font-weight:700;line-height:1.25}
.gg-entry-sub{margin-top:2px;font-size:12.5px;line-height:1.35;color:var(--gg-muted)}
.gg-more-groups{display:flex;flex-wrap:wrap;align-items:center;gap:0 18px;margin-top:16px;padding-top:6px;border-top:1px solid var(--gg-line)}
.gg-more-groups-k{font-size:13px;font-weight:600;color:var(--gg-muted)}
.gg-more-groups ul{display:flex;flex-wrap:wrap;gap:0 18px;list-style:none;margin:0;padding:0}
.gg-gated{display:flex;flex-direction:column;gap:6px;margin:4px 0 12px}
.gg-item:hover .gg-nm-name,.gg-item:focus-visible .gg-nm-name{text-decoration:underline;text-underline-offset:3px}
.gg-price{font-size:13px;font-weight:700;color:var(--gg-ink);white-space:nowrap;font-variant-numeric:tabular-nums}
.gg-price-note{margin:8px 0 0;font-size:12px;color:var(--gg-muted)}
/* Guide visual audit 1123b #15: the Prime line's tap was 42px tall; 44px now (min-height, the text centred). */
.gg-prime-trial{display:inline-flex;align-items:center;min-height:44px;padding:12px 0;color:inherit;text-decoration:underline;text-underline-offset:2px}
.gg-code-offer{font-size:12px;color:var(--gg-muted)}
.gg-soon{text-align:center;padding:36px 16px;border-top:1px solid var(--gg-line);margin-top:16px}
.gg-soon[data-gift-picks-loading]{min-height:100vh}
.gg-soon h2,.gg-soon h3{font-size:18px;font-weight:700;margin:0 0 6px}
.gg-soon p{margin:0 auto 8px;max-width:44ch;color:var(--gg-muted);font-size:14px}
/* Guide consistency audit 1122 #23: an empty My Wish List starts at the content column's left edge on a desktop, as the
   other pages do (a phone keeps it centred). */
@media (min-width:768px){.gg-soon[data-gift-my-list-empty]{text-align:left;padding-left:0;padding-right:0}.gg-soon[data-gift-my-list-empty] p{margin-left:0}}
.gg-also{margin:16px 0 0}
.gg-also-h{margin:0 0 8px;font-size:13px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--gg-muted)}
/* Polish audit 1122 #8: plain names with dots between (outlined pills read as buttons that did nothing). */
.gg-also-list{list-style:none;margin:0;padding:0;font-size:13px;line-height:1.7;color:var(--gg-ink)}
.gg-also-list li{display:inline;white-space:nowrap}
.gg-also-list li+li::before{content:"·";margin:0 8px;color:var(--gg-muted)}
.gg-helpr{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:20px 0;padding:14px 16px;border-radius:14px;background:#f3f4ea;border:1px solid #e3e6d2;color:#2f3020}
.gg-helpr b{display:block;font-size:15px}
.gg-helpr span{font-size:13px;color:#55554a}
.gg-helpr-btn{display:inline-flex;align-items:center;min-height:44px;background:hsl(var(--bark));color:#fff;font-weight:700;font-size:13px;padding:0 16px;border-radius:999px;white-space:nowrap;text-decoration:none}
@media (max-width:480px){.gg-helpr{flex-direction:column;align-items:flex-start}}
.gg-divider{height:0;margin:20px 0 0;border:0;border-top:1px solid var(--gg-line)}
.gg .gg-landing{padding-top:8px}
.gg .gg-landing>*{margin-top:0;margin-bottom:0}
.gg .gg-landing>*+*{margin-top:28px}
.gg-wrap-three{grid-template-columns:repeat(3,minmax(0,1fr));gap:14px 12px}
@media (min-width:768px){.gg-wrap-three{gap:20px 20px}}
/* Lead 11-21 landing polish: the tiles' quiet line under each cover. */
.gg-tile-line{display:block;margin-top:8px;font-size:13px;line-height:1.3;text-align:center;color:var(--gg-muted)}
.gg-fun-tool{display:flex;flex-direction:column;justify-content:center;height:100%;min-height:76px;border:1px solid var(--gg-line);border-radius:14px;padding:12px 16px;text-decoration:none;color:var(--gg-ink);background:hsl(var(--card))}
.gg-fun-tool:hover,.gg-fun-tool:focus-visible{border-color:var(--gg-olive)}
.gg-fun-tool b{display:block;font-size:14px;color:var(--gg-olive)}
.gg-fun-tool span{display:block;font-size:13px;line-height:1.4;color:var(--gg-muted);margin-top:2px}
.gg-more{display:flex;flex-wrap:wrap;gap:0 20px;margin-top:12px}

.gg-disc{border-top:1px solid var(--gg-line);margin-top:26px;padding-top:14px;font-size:12px;color:var(--gg-muted);text-align:center}
.gg-disc p{margin:2px 0;text-wrap:balance}
.gg-disc .gg-more{justify-content:center}
@media (max-width:767px){

.gg-layout{grid-template-columns:minmax(0,1fr)}
/* Owner 11-21 (the phones need a way to organize this): a phone draws no sidebar (it sat at the page's foot);
   the head row's three-line icon opens the same menu in a sheet (GuidesMenuButton, owner 11-22). The DOM order is
   page, menu, disclosures (holiday audit 1121 #22/#27), so a phone needs no order rule; the desktop grid
   placement resets to one column. */
.gg-layout{grid-template-rows:none}
.gg-layout>.gg-side,.gg-layout>.gg-main,.gg-layout>.gg-disc{grid-column:auto;grid-row:auto}
.gg-layout>.gg-disc{margin-left:0}
.gg-side{display:none}
.gg-main{padding:4px 0 24px}
.gg-item{gap:10px;padding:8px 0;font-size:14px}
.gg-banner-wrap{padding:0 0 4px}.gg-banner{height:96px;padding-top:8px;border-radius:12px}.gg-arch{width:min(260px,70%);padding:14px 10px 6px;box-shadow:0 0 0 5px rgba(255,253,247,.85)}.gg-banner .gg-lead{font-size:13px}.gg-banner h1{font-size:20px;-webkit-line-clamp:1}.gg-tools{margin-top:6px}
.gg-banner .gg-lead{margin-bottom:7px}
}
/* The phone's head row (owner 11-22: everything under the holiday gift guides comes off the phone view; "Only thing
   that will stay is the 3 line with no circle around it and the heart. Both of those will go on the right"; "change
   holiday gift guides to just gift guides"): up to 767px ONE line, back arrow + the Gift guides title on the left, the heart and
   the three-line menu on the right (44x44 targets, no circle, border or fill, even on a tap); the pill, the search and
   Share are hidden. It replaces 11-21's sticky chip row. Hidden from 768px up, where the sidebar is the menu. */
.gg-head-phone{display:none}
@media (max-width:767px){
.gg-headrow{flex-wrap:nowrap;gap:4px}
.gg-head-title{flex:1 1 auto}
.gg-headrow>.gg-ship,.gg-headrow>.gg-tools{display:none}
.gg-head-holiday{display:none}
.gg-head-title [data-gift-head-name]::first-letter{text-transform:uppercase}
.gg-head-phone{display:flex;align-items:center;flex:none;margin:0 -10px 0 auto}
.gg-head-phone .gg-icon,.gg-head-phone .gg-icon:hover,.gg-head-phone .gg-icon[aria-expanded="true"]{background:transparent;border:0;box-shadow:none}
.gg-head-phone .gg-icon:focus-visible{background:transparent;outline:2px solid hsl(var(--ring));outline-offset:-2px;border-radius:8px}
}
/* The menu sheet: the sidebar's groups, rows and current-page look.
   Guide visual audit 1123b #2: the sheet box itself scrolled too (outer scrollHeight 1013 over a 652px box, the list
   567px inside it), so a swipe or a wheel pushed the Gift guides title and the close button off the top and opened
   ~360px of blank under the last row. ONE scroller now: the box is a column that never scrolls, the title stays put,
   and only the list scrolls in the room left under it. The root cause of the extra height: each row's screen-reader
   "N gifts" (.sr-only, position:absolute) took the fixed sheet as its containing block, so the hidden words of the
   bottom rows hung ~360px below the list and stretched the sheet's own scroll area (measured: the deepest element was
   an sr-only " gifts" at 1030px in a 668px box). The list is now their containing block (position:relative), so they
   stay inside the one scroller. */
.gg.gg-sheet-menu{display:flex;flex-direction:column;overflow:hidden}
.gg-sheet-menu>.gg-sheet-menu-body{position:relative;flex:1 1 auto;min-height:0}
.gg-sheet-menu .gg-sheet-menu-body{max-height:70dvh;overflow-y:auto;overscroll-behavior:contain;padding-bottom:calc(8px + env(safe-area-inset-bottom,0px))}
/* Visual audit 1122-night #3: rows scrolled up under the sheet's Gift guides title and showed half-cut ("Banners" sliced at
   320). The scrolling list now starts under a hairline below the title and a row fades out in the 16px under it (at
   rest that strip is the list's own top padding, so nothing is faded; the 1px line itself stays unmasked), and the first group sits 16px under the line
   like the gap between groups (was ~5px). */
.gg-sheet-menu .gg-sheet-menu-body{margin-top:8px;border-top:1px solid var(--gg-line);padding-top:16px}
.gg-sheet-menu .gg-sheet-menu-body{-webkit-mask-image:linear-gradient(to bottom,#000 1px,transparent 1px,#000 17px);mask-image:linear-gradient(to bottom,#000 1px,transparent 1px,#000 17px)}
.gg-sheet-menu-body ul{list-style:none;margin:0 0 8px;padding:0}
.gg-sheet-menu-body a{display:flex;align-items:center;min-height:44px;padding:4px 10px;border-radius:8px;color:var(--gg-ink);text-decoration:none;font-size:15px}
.gg-sheet-menu-body a[aria-current="page"]{background:var(--gg-soft);color:var(--gg-olive);font-weight:700}
.gg-sheet-menu-body .gg-side-h{scroll-margin-top:8px}
.gg-sheet-menu-body>.gg-side-h:first-child{margin-top:0;padding-top:0;border-top:0}
/* The landing's Top 10 (owner 11-21 ~5:05 PM): the guides' card standing up (photo on top, name, price, heart over the
   photo's corner), a sideways row on a phone and a grid of five from 768px. After the .gg-list rules so it wins. */
.gg-top10-wrap{margin:24px 0 8px}
.gg-top10-h{margin:0;font-size:20px;font-weight:600;color:var(--gg-ink)}
.gg-top10{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(148px,44%);grid-template-columns:none;gap:16px;overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x proximity;margin:12px 0 0;padding:0 0 8px;scrollbar-width:thin}
.gg-top10>li{position:relative;display:block;border-top:0;scroll-snap-align:start;min-width:0}
.gg-top10 .gg-item{flex-direction:column;align-items:stretch;padding:0;gap:8px;margin:0}
.gg-top10 .gg-photo{width:100%;border-radius:14px}
.gg-top10 .gg-thumb{width:100%;height:auto;aspect-ratio:1/1;padding:10px;border-radius:14px}
.gg-top10 .gg-nm-name{font-size:14px}
/* Owner 11-21 evening: the Top 10 heart sits on the photo's top-right "like all the others" (the rank badge is top-left). */
.gg-top10 .gg-heart-pick{position:absolute;top:2px;right:2px;z-index:1}
/* Owner 11-22 (the price-top-right / heart-bottom-right card "is only for product listings, common sense"): under a Top
   10 photo the name, then the price on its own line; the price lines of a row line up. An Amazon pick's cart sits
   under the heart on the photo (owner 2026-11-22). */
.gg-top10>li{display:flex;flex-direction:column}.gg-top10>li>.gg-item{flex:1}
.gg-top10 .gg-nm{display:flex;flex:1;flex-direction:column;padding-bottom:0}
/* Polish audit 1122 #20: the price right under a name held to two lines' height, and any chip under the price, so a
   card with a code chip (Camp Snap) keeps its price in line with the row's others. */
/* Guide visual audit 1123b #13/#4: Top 10 names cut at two lines (5 of 10 on a phone, all 10 at 768); three lines like
   the guide rows, and the price lines still line up (every name holds three lines' height). A code chip stays on one
   line ("Code LEXILOMBAS7" broke into three at 768). */
.gg-top10 .gg-nm-name{-webkit-line-clamp:3;min-height:3lh}
.gg-top10 .gg-bdg{white-space:nowrap}
.gg-top10 .gg-nm .gg-nm-meta{justify-content:flex-start;margin-top:0;padding-top:4px;min-height:28px}
.gg-top10 .gg-badges{padding-right:0}
/* Owner 2026-11-22: the cart right under the heart on the photo's top-right (see .gg-list .gg-cart); the Top 10's photo
   is the card's top at every width, so neither takes the phone row's bottom-right line (owner 2026-11-22 later). */
.gg-top10 .gg-cart{position:absolute;top:46px;right:2px;z-index:1}
.gg-top10 .gg-heart-pick,.gg-top10 .gg-cart{left:auto;bottom:auto;justify-content:center}
/* Top 10 rank (owner 11-21 evening: "number the top 10 gifts"): a small cream disc with an olive serif numeral on the
   photo's top-left corner, clear of the heart (top right) and inside the photo's padding, so it never covers the product. */
.gg-top10 .gg-item{position:relative}
.gg-rank{position:absolute;top:6px;left:6px;z-index:1;display:inline-flex;align-items:center;justify-content:center;min-width:26px;height:26px;padding:0 6px;border-radius:999px;background:#fbf7ee;border:1px solid hsl(var(--bark) / .35);color:hsl(var(--bark));font-family:'Bodoni Moda','Bodoni Moda Fallback',Georgia,serif;font-size:15px;font-weight:700;line-height:1;box-shadow:0 1px 2px rgba(0,0,0,.08);pointer-events:none}
/* Guide visual audit 1123b #4: a grid of five at 768 (beside the rail) squeezed each card to a ~60px photo under the rank
   and the heart. Up to 1023px the Top 10 stays the phone's sideways row, three cards and a bit in view; five across
   from 1024. */
@media (min-width:768px) and (max-width:1023px){.gg-top10{grid-auto-columns:minmax(160px,30%)}}
@media (min-width:1024px){.gg-top10{grid-auto-flow:row;grid-auto-columns:auto;grid-template-columns:repeat(5,minmax(0,1fr));overflow:visible;gap:20px 16px}}
/* The gift quiz (owner 11-21 ~6:15 PM): one question per screen, big answers (two across on a phone, up to four wide),
   then the result as the guides' list. */
.gg-quiz{padding:18px 16px 14px}
.gg-quiz-step{margin:10px 0 0}
.gg-quiz-progress{margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:.04em;color:var(--gg-muted)}
.gg-quiz-q{margin:0 0 12px;font-size:18px;font-weight:600;color:var(--gg-ink)}
.gg-quiz-answers{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.gg-quiz-answer{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:60px;height:auto;padding:12px 10px;border-radius:14px;font-size:15px;font-weight:600;white-space:normal;text-align:center;line-height:1.25}
.gg-quiz-answer small{font-size:12px;font-weight:500;color:var(--gg-muted)}
.gg-quiz-back{margin-top:10px;min-height:44px}
.gg-quiz-list{margin-top:4px}
@media (min-width:768px){.gg-quiz-list[data-quiz-count="4"]{grid-template-columns:repeat(2,minmax(0,1fr))}}
.gg-quiz-after{align-items:center;gap:12px 16px;margin-top:14px}
@media (min-width:768px){.gg-quiz{padding:22px 24px 16px}.gg-quiz-answers{grid-template-columns:repeat(auto-fill,minmax(170px,1fr))}.gg-quiz-answer{min-height:64px}}
/* Owner 11-21 (phone guide page): the count, the order-by pill and the icons on ONE row under the banner (wraps at 320);
   the search is a bare magnifier like the other icons until tapped. */
.gg-countrow{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:4px 8px;margin:10px 0 2px}
.gg-countrow-left{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;min-width:0}
.gg-countrow .gg-itemcount{margin:0}
.gg-countrow .gg-ship{flex:none;font-size:11px;padding:4px 10px;max-width:none}
.gg-countrow .gg-tools{position:relative;margin:0 0 0 auto;flex:0 0 auto;gap:0}
@media (max-width:479px){.gg-countrow,.gg-countrow-left{gap:4px}.gg-countrow .gg-ship-order{display:none}.gg-countrow .gg-ship::first-letter{text-transform:uppercase}}
/* Consistency audit 1122 #17 (Her and the sponsors page at 320: the four icons dropped to a second line under
   "146 gifts" and the pill): under 360px the count and the icons share the first line (as at 375) and the pill sits
   under the count, whole; the open search goes back to the one flex row above (the count stays, the pill steps out). */
@media (max-width:359px){
.gg-countrow{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:2px 4px}
.gg-countrow-left{display:contents}
.gg-countrow .gg-itemcount{grid-column:1;grid-row:1}
.gg-countrow .gg-tools{grid-column:2;grid-row:1;justify-self:end}
.gg-countrow .gg-ship{grid-column:1/-1;grid-row:2;justify-self:start}
.gg-countrow:has(.gg-tools-search.is-open){display:flex}
}

/* Owner 11-21 (no more "Show more", every gift listed): every gift is drawn, so an off-screen card skips its layout
   and paint until it nears the screen; its reserved height keeps the scrollbar steady (no layout shift). */
.gg-list>li{content-visibility:auto;contain-intrinsic-size:auto 128px}
@media (min-width:768px){.gg-list>li{contain-intrinsic-size:auto 420px}}
.gg-top10>li{content-visibility:visible}
/* Guide audit 1123 I2: the gift a search result opened wears a short outline so the eye lands on it. */
.gg-list>li[data-gift-pick-found]{outline:2px solid hsl(var(--bark));outline-offset:3px;border-radius:12px}
/* Owner 2026-11-22 (her phone: the quiz's picks had blank photo areas): the finder's results (12 rows at most) always
   draw. Safari skipped rows that were on screen when the list arrived after an answer tap, so no row of it skips. */
.gg-quiz-list>li{content-visibility:visible}
/* Owner 11-21: each price section's header opens and closes it (first open): a full-width 44px row with a chevron. */
.gg-sec-toggle-h{margin:24px 0 0}
.gg-sec-toggle{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;min-height:48px;padding:6px 4px;border:0;border-bottom:1px solid var(--gg-line);border-radius:0;background:transparent;font:inherit;font-weight:700;color:var(--gg-ink);text-align:left;white-space:normal;cursor:pointer}
.gg-sec-toggle:focus-visible{outline:2px solid var(--gg-olive);outline-offset:2px;border-radius:6px}
.gg-sec-chev{flex:none;color:var(--gg-muted);transition:transform .15s}
.gg-sec-toggle[aria-expanded="true"] .gg-sec-chev{transform:rotate(180deg)}
.gg-sec-toggle-h+.gg-list{margin-top:8px}
/* Owner 2026-11-22 ("Add some kind of shading or something so you can tell where each section is better"): each price
   section's header is a band in a light tint of its guide's own colour (the cover family on the h2: Her oat, Him green,
   Kids red), full width, padded, with a 4px bar of the guide's colour on its left, more room above it (24px, was 14px)
   and its words a little bolder; the same on a phone and a computer. Words and count stay at least 4.5:1 on the tint in
   both themes (src/test/giftGuideSectionBands1122.test.tsx computes it). Every section still starts open; the chevron
   stays. The band keeps the button's own 48px height (Button size md, h-12; the sweep's size-class check). */
.gg-sec-toggle-h .gg-sec-toggle{padding:10px 12px 10px 14px;border:0;border-left:4px solid var(--gg-sec-bar);border-radius:10px;background:var(--gg-sec-bg);color:var(--gg-sec-ink);font-weight:800}
.gg-sec-toggle-h .gg-sec-count{color:var(--gg-sec-muted);font-weight:600}
.gg-sec-toggle-h .gg-sec-chev{color:var(--gg-sec-ink)}
.gg-sec-toggle-h .gg-sec-toggle:focus-visible{border-radius:10px}
.gg-sec-oat{--gg-sec-bg:#f2e9da;--gg-sec-ink:#3b2a20;--gg-sec-muted:#5c4a3a;--gg-sec-bar:#ceba98}
.gg-sec-green{--gg-sec-bg:#e3eee5;--gg-sec-ink:#1d4a2f;--gg-sec-muted:#3c5d47;--gg-sec-bar:#265e3c}
.gg-sec-red{--gg-sec-bg:#f7e4e3;--gg-sec-ink:#7a1c22;--gg-sec-muted:#8a3439;--gg-sec-bar:#a8242a}
:root[data-theme="dark"] .gg-sec-oat{--gg-sec-bg:#3a3127;--gg-sec-ink:#f3e8d6;--gg-sec-muted:#d9c9b0}
:root[data-theme="dark"] .gg-sec-green{--gg-sec-bg:#1f3328;--gg-sec-ink:#dcebdf;--gg-sec-muted:#b7cdbb;--gg-sec-bar:#4f8a63}
:root[data-theme="dark"] .gg-sec-red{--gg-sec-bg:#3e2325;--gg-sec-ink:#f5dad8;--gg-sec-muted:#e0b6b4;--gg-sec-bar:#c4474d}
/* The sponsors page's Filter panel (owner 11-21): section links and price limits, 44px rows. */
.gg-filter-panel{min-width:240px;max-height:70vh;overflow-y:auto}
.gg-filter-group{display:flex;flex-direction:column}
.gg-filter-group+.gg-filter-group{border-top:1px solid var(--gg-line);margin-top:4px;padding-top:4px}
.gg-filter-h{padding:8px 12px 2px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--gg-muted)}
/* Owner 11-21 (guide and deal-day banners): "the arches and letters are just small and squished together" and "add like
   some effect so it doesn't look flat": same design, larger airy type centred in a slightly larger arch, and a printed-
   card depth: a soft shadow under the card, a faint inner vignette on the gingham, the arch raised off it, and the
   covers' thin gold inner arch line. */
.gg-banner{position:relative;height:252px;box-shadow:0 2px 10px rgba(0,0,0,.10)}
.gg-banner::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 28px rgba(60,40,20,.14);pointer-events:none}
.gg-arch{position:relative;width:min(680px,76%);padding:30px 28px 16px;box-shadow:0 -3px 14px rgba(60,40,20,.12),0 0 0 7px rgba(255,253,247,.85)}
.gg-arch::before{content:"";position:absolute;inset:9px 9px 0;border:1px solid rgba(176,141,87,.75);border-bottom:0;border-radius:999px 999px 0 0;pointer-events:none}
/* Pass 2, owner 11-21 night: "gifts for her is still too small text size and still close together": "gifts for" 26 ->
   36px, the name 46 -> 80px, a 16px gap between the two lines (line-height 1 so the gap is the gap), band 216 -> 252px.
   The long two-line titles (deal days, 25 Days Sponsors) take 60px from 768px up so two lines still sit inside the arch
   (only there: on a phone every guide has the count row after its banner). */
.gg-banner .gg-lead{font-size:36px;line-height:1.1;margin:0 0 16px}
.gg-banner h1{font-size:80px;line-height:1.04}
@media (min-width:768px){.gg:has([data-gift-deals-page]) .gg-banner h1,.gg:has([data-gift-guide="25-days-sponsors"]) .gg-banner h1{font-size:60px;line-height:1.04}}
@media (min-width:768px) and (max-width:1023px){.gg-banner{height:220px}.gg-arch{width:min(600px,80%)}.gg-banner .gg-lead{font-size:30px;margin-bottom:14px}.gg-banner h1{font-size:64px}.gg:has([data-gift-deals-page]) .gg-banner h1,.gg:has([data-gift-guide="25-days-sponsors"]) .gg-banner h1{font-size:48px}}
@media (max-width:767px){.gg-banner{height:184px;padding-top:10px}.gg-arch{width:min(340px,94%);padding:22px 10px 8px;box-shadow:0 -2px 10px rgba(60,40,20,.12),0 0 0 5px rgba(255,253,247,.85)}.gg-arch::before{inset:6px 6px 0}.gg-banner .gg-lead{font-size:clamp(20px,6vw,24px);margin-bottom:12px}.gg-banner h1{font-size:clamp(34px,11vw,44px);line-height:1.02;-webkit-line-clamp:2}}
/* Dark mode: the arch stays cream, so its "gifts for" keeps the cover brown (the later .gg-words dark rule turned it near-white, 11-21). */
:root[data-theme="dark"] .gg-words .gg-banner .gg-lead{color:#6b5a48}
/* Owner 11-22 #13: every other guides page's banner (GuidesTop: the printables, the fun pages, My Wish List, the Holiday
   Hub) in Small Business Saturday's sizes: 60px from 768px (48px to 1023px), up to three lines at a phone's 25-34px. */
@media (min-width:768px){.gg-banner-sub .gg-banner h1{font-size:60px;line-height:1.04}}
@media (min-width:768px) and (max-width:1023px){.gg-banner-sub .gg-banner h1{font-size:48px}}
@media (max-width:767px){.gg-banner-sub .gg-banner h1{-webkit-line-clamp:3;font-size:clamp(25px,8vw,34px);line-height:1.05}}
/* The phone's one-line menu tip (owner 11-22 11:40 PM, GiftGuideMenuHint.tsx; "not as big as the mockup": slim): a 38px
   cream box with a 1px border, 14px green words with the three-line icon in a small outlined chip, and a 14px Close on
   the right. Both controls draw 36px tall but tap 44x44 (a ::before reaching past the box), so the box stays slim. Only
   up to 767px, where the head row's three-line icon is; from 768px the left menu is always on screen. */
.gg-menuhint{display:none}
@media (max-width:767px){
/* Owner 11-22 11:40 PM (phone: too much space under the head row; "If you change that spacing for one page you need to
   do the other pages that are similar"): the space ABOVE stays the app's PageHeader standard (--shell-gap, as /legal and
   /declutter); BELOW, the title's bottom sits 12px over the first content on every page with the row (the title ends
   6.6px above the 44px row's bottom, so 5px of padding; was 12px, and the landing's divider 20px + 1px + 12px; the
   landing's own 4px + 8px tops go too). No divider under the row on a phone (PageHeader pages have none); the 44px
   targets and the title size stay. */
.gg-headrow{padding-bottom:5px}
.gg-divider{display:none}
.gg .gg-landing{padding-top:0}
.gg-main:has(>.gg-landing){padding-top:0}
.gg-menuhint{display:flex;align-items:center;height:38px;margin:12px 0 10px;padding:0 0 0 10px;border:1px solid #e7dccb;border-radius:10px;background:#faf7ef}
.gg-menuhint-go,.gg-menuhint-x{position:relative;height:36px;padding:0;border:0;background:none;cursor:pointer}
.gg-menuhint-go::before,.gg-menuhint-x::before{content:"";position:absolute;top:-4px;bottom:-4px;left:0;right:0}
.gg-menuhint-x::before{left:-4px;right:-4px}
.gg-menuhint-go{flex:1;min-width:0;text-align:left;font:600 14px/1.2 Montserrat,sans-serif;letter-spacing:-.01em;color:#265e3c}
.gg-menuhint-t{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gg-menuhint-ico{display:inline-flex;align-items:center;justify-content:center;width:18px;height:16px;border:1px solid currentColor;border-radius:4px;vertical-align:-3px}
.gg-menuhint-x{flex:none;display:inline-flex;align-items:center;justify-content:center;width:36px;font-size:14px;color:#6b6b5f}
.gg-menuhint-go:focus-visible,.gg-menuhint-x:focus-visible{outline:2px solid hsl(var(--ring));outline-offset:-2px;border-radius:8px}
/* Owner 11-22 11:40 PM: ~12px above and below the tip (the landing's 28px between blocks, and the guide column's gaps, were too much). */
.gg .gg-landing>.gg-menuhint,.gg .gg-landing>.gg-menuhint+*{margin-top:12px}
article[data-gift-guide]>.gg-menuhint{margin:4px 0 0}
article[data-gift-guide]>.gg-menuhint+section>.gg-sec-title{margin-top:12px}
article[data-gift-guide]>.gg-menuhint+section>.gg-list{margin-top:0}article[data-gift-guide]>.gg-menuhint+section>.gg-list>li:first-child{border-top:0}
/* The tip's two controls are the shared Button (ghost, sm: 44px, the app's button floor they rendered at by hand;
   noNewHandMadeControls). These rules keep the look the owner approved, measured on the hand-made buttons: the words
   start at the left (block, not a centered flex row), the 12px menu icon (the Button sizes every svg 18px), a regular
   weight Close glyph on its own line height, and no pill, hover wash or focus ring shadow (the focus outline above stays). */
.gg-menuhint-go,.gg-menuhint-x{border-radius:0;white-space:normal}
.gg-menuhint-go{display:block}
.gg-menuhint-x{font-weight:400;letter-spacing:normal;line-height:1.5}
.gg-menuhint-ico svg{width:12px;height:12px;flex-shrink:1}
.gg-menuhint-go:hover,.gg-menuhint-x:hover{background:none}
.gg-menuhint-go:focus-visible,.gg-menuhint-x:focus-visible{box-shadow:none}
}
/* Guide train p 11-23: the tip stays one line at every phone width, measured on the build (Chromium and WebKit, Montserrat
   600 14px): the owner's words need 277px of text room, which a phone has from 373px wide (375: 279px), so under 375px the
   words drop "free" (245px, room from 341px), and under 346px they are 12.5px (221px; 320px has 224px). */
.gg-menuhint-s{display:none}
@media (max-width:374px){.gg-menuhint-l{display:none}.gg-menuhint-s{display:inline}}
@media (max-width:345px){.gg-menuhint-go{font-size:12.5px}}
`;
