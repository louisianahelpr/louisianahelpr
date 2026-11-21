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
.gg-layout{display:grid;grid-template-columns:220px minmax(0,1fr)}
.gg-side{border-right:1px solid var(--gg-line);padding:16px 16px 20px 0;font-size:13px;position:sticky;top:var(--gg-side-top,72px);align-self:start;max-height:calc(100dvh - var(--gg-side-top,72px));overflow-y:auto;overscroll-behavior:contain}
.gg-search{position:relative;display:block;margin:0}
.gg-search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--gg-muted)}
.gg-search input{width:100%;min-height:40px;font:500 13px Montserrat,sans-serif;padding:9px 12px 9px 34px;border:1px solid #ddd8cc;border-radius:999px;background:hsl(var(--background));color:var(--gg-ink)}
.gg-search-none{padding:8px 10px;color:var(--gg-muted)}
.gg-tile-li{position:relative;display:flex;flex-direction:column}
.gg-heart{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;border:0;background:transparent;border-radius:999px;cursor:pointer}
/* Owner 11-21 ("remove the circle around the heart"): no circle, fill or shadow behind any card heart (.gg-heart-pick,
   -wish, -deal, -sb), only the heart with a thin white halo so it reads over a photo; the button keeps its 44px tap area. */
.gg-heart svg{filter:drop-shadow(0 0 1px rgba(255,255,255,.95)) drop-shadow(0 0 2px rgba(255,255,255,.8))}
.gg-list>li{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;column-gap:4px}
.gg-list>li>.gg-item{min-width:0}
.gg-shop-btn{grid-column:1/-1;justify-self:start;display:inline-flex;align-items:center;min-height:44px;margin:-4px 0 8px 100px;padding:0 6px 0 0;border:0;border-radius:0;background:none;font-size:14px;font-weight:700;color:var(--gg-olive);text-decoration:none}
.gg-shop-btn:hover,.gg-shop-btn:focus-visible{text-decoration:underline}
.gg-side details{border-top:0}
.gg-side summary{list-style:none;cursor:pointer;display:flex;align-items:center;min-height:38px;padding:0 10px;border-radius:8px;font-size:13px;font-weight:600;color:var(--gg-ink)}
.gg-side summary:hover{background:hsl(var(--muted) / .6)}
.gg-side-n::before{content:attr(data-n);margin-left:6px;font-size:11.5px;font-weight:500;color:var(--gg-muted)}
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
.gg-tools-search{position:relative;flex:1;min-width:0}
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
/* A phone: the search is a 44px magnifier on the pill's row and opens across the row while typing. */
.gg-headrow .gg-tools-search{flex:0 0 44px;min-width:44px}
.gg-headrow .gg-tools-search .gg-search input{padding-right:0;cursor:pointer}
.gg-headrow .gg-tools-search:focus-within{position:absolute;left:0;right:0;z-index:7;background:hsl(var(--background))}
.gg-headrow .gg-tools-search:focus-within .gg-search input{padding-right:12px;cursor:text}
.gg-headrow .gg-tools-search:not(:focus-within) .gg-search input::placeholder{color:transparent}
.gg-sort-check{display:inline-block;width:16px;flex:none}
[data-gift-sort-menu]{min-width:200px}[data-gift-sort-menu] button{white-space:nowrap}
@media (min-width:640px){.gg-headrow .gg-tools-search:not(:focus-within) .gg-search input::placeholder{color:var(--gg-muted)}.gg-headrow{padding-top:24px}.gg-headrow .gg-tools-search{flex:1 1 160px;max-width:300px}.gg-headrow .gg-tools-search:focus-within{position:relative;left:auto;right:auto}.gg-headrow .gg-tools-search .gg-search input{padding-right:12px;cursor:text}.gg-headrow .gg-tools{flex:1 1 300px}}
@media (min-width:768px){.gg-head-title{flex:0 0 auto}.gg-headrow{flex-wrap:nowrap}.gg-headrow .gg-tools{flex:1 1 auto;min-width:0}.gg-head-title .text-page-title{white-space:nowrap}}
.gg-search-results{position:absolute;z-index:6;top:calc(100% + 6px);left:0;right:0;list-style:none;margin:0;padding:4px;max-height:60vh;overflow-y:auto;text-align:left;background:hsl(var(--background));border:1px solid var(--gg-line);border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.12);font-size:14px}
.gg-search-results a{display:flex;align-items:center;min-height:44px;padding:0 12px;border-radius:8px;color:var(--gg-ink);text-decoration:none}
.gg-search-results a{gap:10px;padding:4px 12px}
.gg-search-thumb{width:36px;height:36px;flex:none;border-radius:8px;object-fit:cover}
.gg-search-head{padding:8px 12px 2px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--gg-muted)}
.gg-search-item{display:flex;flex-direction:column;min-width:0}.gg-search-item-name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.3}.gg-search-item small{font-size:12px;color:var(--gg-muted)}
.gg-search-results a:hover,.gg-search-results a:focus-visible{background:hsl(var(--muted) / .6)}
.gg-icon{position:relative;display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;border-radius:999px;color:var(--gg-ink);background:transparent;border:0;text-decoration:none}
.gg-icon:hover,.gg-icon:focus-visible,.gg-icon[aria-expanded="true"]{background:hsl(var(--muted) / .7)}
.gg-mylist-icon{color:#8c3b3b}
.gg-icon-count{position:absolute;top:4px;right:2px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#8c3b3b;color:#fff;font-size:10px;font-weight:700;line-height:16px;text-align:center}
.gg-share-wrap{position:relative;display:inline-flex;align-items:center}
.gg-share-menu{position:absolute;z-index:6;top:calc(100% + 6px);right:0;display:flex;flex-direction:column;min-width:150px;background:hsl(var(--background));border:1px solid var(--gg-line);border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.12);padding:4px}
.gg-share-menu a,.gg-share-menu button{display:flex;align-items:center;min-height:44px;padding:0 12px;font-size:13px;font-weight:600;color:var(--gg-ink);text-decoration:none;background:none;border:0;text-align:left;border-radius:8px}
.gg-share-menu a:hover,.gg-share-menu button:hover{background:hsl(var(--muted) / .6)}
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
.gg-deals{margin:22px 0;border:1px solid #ece6dc;border-radius:16px;padding:0 16px;background:#faf6ee;color:#3a2a20}
.gg-deals>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:10px;min-height:56px;font-size:15px;font-weight:700;color:#3a2a20}
.gg-deals-count{font-size:13px;font-weight:500;color:#6f6259}
.gg-deals>summary::-webkit-details-marker{display:none}
.gg-deals>summary::after{content:"+";margin-left:auto;font-size:17px;line-height:1}
.gg-deals[open]>summary::after{content:"\\2212"}
.gg-deals .gg-codes{padding-bottom:10px}
.gg-deals-sub{margin:6px 0 4px;font-size:14px;font-weight:700;color:var(--gg-ink)}
.gg-store-deals ul,.gg-deals ul{list-style:none;margin:0;padding:0}
.gg-store-deals li,.gg-codes li[data-gift-sale]{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 10px;padding:4px 0;border-top:1px solid var(--gg-line)}
.gg-store-deals li .gg-link,.gg-codes li[data-gift-sale] .gg-link{min-height:40px;font-weight:600}
.gg-sec-title{margin:24px 0 0;font-size:15px;font-weight:700;color:var(--gg-ink)}
/* Owner 11-21 price sections: the count beside a section heading, quiet. */
.gg-sec-count{font-weight:500;color:var(--gg-muted)}
.gg-sec+.gg-sec .gg-sec-title,.gg-sort+section .gg-sec-title{margin-top:20px}
.gg-more-picks{display:flex;align-items:center;justify-content:center;width:100%;min-height:44px;margin:12px 0 0;border-radius:999px;border:1px solid var(--gg-olive);background:transparent;color:var(--gg-olive);font-weight:700;font-size:13px}
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
.gg-nm .gg-nm-meta{display:flex;align-items:baseline;gap:8px;margin-top:4px;font-size:12px;font-weight:600;letter-spacing:.04em}
.gg-nm-meta .gg-price{font-size:15px;letter-spacing:0}
.gg-list>li{align-items:flex-start}
@media (min-width:1024px){
.gg-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px 20px;align-items:stretch}
.gg-list>li{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 44px;align-items:start;column-gap:2px;border-top:0}
.gg-list .gg-item{flex-direction:column;align-items:stretch;align-self:stretch;padding:0;gap:10px}
.gg-list .gg-photo{width:100%;border-radius:16px}
.gg-list .gg-thumb{width:100%;height:auto;aspect-ratio:1/1;padding:12px;border-radius:16px}
.gg-list .gg-letter{font-size:16px}
.gg-list .gg-heart-pick{position:static}
.gg-list .gg-item{margin-bottom:6px}
}
@media (min-width:768px) and (max-width:1023px){
.gg-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px 20px;align-items:stretch}
.gg-list>li{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 44px;align-items:start;column-gap:2px;border-top:0}
.gg-list .gg-item{flex-direction:column;align-items:stretch;align-self:stretch;padding:0;gap:10px}
.gg-list .gg-photo{width:100%;border-radius:16px}
.gg-list .gg-thumb{width:100%;height:auto;aspect-ratio:1/1;padding:12px;border-radius:16px}
.gg-list .gg-heart-pick{position:static}
.gg-list .gg-item{margin-bottom:6px}
}
.gg-letter{display:flex;align-items:center;justify-content:center;text-align:center;padding:3px;overflow:hidden;overflow-wrap:anywhere;line-height:1.05;font-family:'Bodoni Moda','Bodoni Moda Fallback',Georgia,serif;font-size:10px;font-weight:700;color:var(--gg-olive)}
.gg-nm{flex:1;min-width:0;overflow-wrap:anywhere}
.gg-nm small{display:block;font-size:12px;color:var(--gg-muted)}
.gg-badges{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}
.gg-bdg{font-style:normal;font-size:10px;font-weight:700;letter-spacing:.06em;padding:2px 7px;border-radius:999px;background:#eef2e6;color:#3f5a1c}
.gg-last-note{display:inline-block;white-space:normal;max-width:none;margin:0 0 10px}
.gg-bdg-sponsor{background:#f3dcd8;color:#8c3b3b}
.gg-bdg-tiktok{background:#e9e4f5;color:#4b3a7a}.gg-bdg-preorder{background:#fbefd9;color:#7a5413}.gg-bdg-code{background:var(--gg-soft,#f4efe6);color:var(--gg-ink);letter-spacing:.04em}.gg-bdg-ship{background:#e6eef3;color:#2d4f63}
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
.gg-codes li{display:flex;flex-direction:column;gap:2px;padding:8px 0;border-top:1px solid var(--gg-line)}
.gg-code-store{font-weight:700}
.gg-code-one{display:flex;flex-direction:column;gap:2px;margin-top:4px}
.gg-code-offer{font-size:12px;color:var(--gg-muted)}
.gg-code-row{display:flex;align-items:center;gap:8px;margin-top:4px}
.gg-code-row code{flex:1;border:1px dashed var(--gg-line);border-radius:8px;padding:6px 8px;font-size:13px;letter-spacing:.06em}
.gg-code-row button{min-height:44px;padding:0 12px;border-radius:999px;border:1px solid var(--gg-olive);color:var(--gg-olive);background:transparent;font-weight:700;font-size:12px}
.gg-soon{text-align:center;padding:36px 16px;border-top:1px solid var(--gg-line);margin-top:16px}
.gg-soon[data-gift-picks-loading]{min-height:100vh}
.gg-soon h3{font-size:18px;font-weight:700;margin:0 0 6px}
.gg-soon p{margin:0 auto 8px;max-width:44ch;color:var(--gg-muted);font-size:14px}
.gg-also{margin:12px 0 0;font-size:13px;color:var(--gg-muted)}
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
.gg-disc p{margin:2px 0}
.gg-disc .gg-more{justify-content:center}
@media (max-width:767px){

.gg-layout{grid-template-columns:minmax(0,1fr)}
/* Owner 11-21: on a phone the menu sits AFTER the page (not hidden), so the 25 Days sponsors and the Holiday Hub,
   which left the main column, stay one tap away. */
.gg-side{order:2;position:static;max-height:none;overflow:visible;border-right:0;border-top:1px solid var(--gg-line);padding:12px 0 8px}
.gg-main{padding:4px 0 24px;order:1}
.gg-item{gap:10px;padding:8px 0;font-size:14px}
.gg-banner-wrap{padding:0 0 4px}.gg-banner{height:96px;padding-top:8px;border-radius:12px}.gg-arch{width:min(260px,70%);padding:14px 10px 6px;box-shadow:0 0 0 5px rgba(255,253,247,.85)}.gg-banner .gg-lead{font-size:13px}.gg-banner h1{font-size:20px;-webkit-line-clamp:1}.gg-tools{margin-top:6px}
.gg-banner .gg-lead{margin-bottom:7px}
}
.gg-code-row code{white-space:nowrap;overflow-wrap:normal;font-size:12px}
`;
