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
.gg-search{position:relative;display:block;margin:0 0 8px}
.gg-search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--gg-muted)}
.gg-search input{width:100%;min-height:40px;font:500 13px Montserrat,sans-serif;padding:9px 12px 9px 34px;border:1px solid #ddd8cc;border-radius:999px;background:hsl(var(--background));color:var(--gg-ink)}
.gg-search-none{padding:8px 10px;color:var(--gg-muted)}
.gg-side details{border-top:1px solid var(--gg-line)}
.gg-side summary{list-style:none;cursor:pointer;display:flex;align-items:center;min-height:44px;padding:0 10px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--gg-muted)}
.gg-side summary::-webkit-details-marker{display:none}
.gg-side summary::after{content:"+";margin-left:auto;font-size:15px;line-height:1}
.gg-side details[open] summary::after{content:"\\2212"}
.gg-side ul{list-style:none;margin:0 0 8px;padding:0}
.gg-side details a{padding-left:28px}
.gg-side ul ul a{padding-left:44px;font-size:12.5px}
.gg-side ul ul{margin:0}

.gg-side a{display:flex;align-items:center;min-height:36px;padding:6px 10px;border-radius:8px;color:var(--gg-ink);text-decoration:none}
.gg-side a:hover{background:hsl(var(--muted) / .6)}
.gg-side a[aria-current="page"]{background:var(--gg-soft);color:var(--gg-olive);font-weight:700}
.gg-main{padding:8px 0 28px 24px;min-width:0}
.gg-rowhead{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:18px 0 10px}
.gg-rowhead h2,.gg-rowhead h3{display:flex;align-items:center;font-size:13px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--gg-muted);margin:0}
.gg-link{display:inline-flex;align-items:center;min-height:44px;font-size:13px;font-weight:700;color:var(--gg-olive);text-decoration:none}
.gg-link:hover,.gg-link:focus-visible{text-decoration:underline}
.gg-row{display:flex;gap:14px;overflow-x:auto;padding-bottom:8px;scrollbar-width:thin;list-style:none;margin:0;padding-left:0;scroll-snap-type:x proximity}
.gg-row>li{width:150px;flex:none;scroll-snap-align:start}
.gg-wrap{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:18px 14px;list-style:none;margin:0;padding:0}
.gg-tile{display:block;color:var(--gg-ink);text-decoration:none}
.gg-cover{display:block;width:100%;height:auto;aspect-ratio:1/1;object-fit:cover;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.gg-tile:hover .gg-cover,.gg-tile:focus-visible .gg-cover{outline:2px solid var(--gg-olive);outline-offset:2px}
.gg-green{--c-dark:rgba(124,148,118,.55);--c-dot:#7c9476}.gg-red{--c-dark:rgba(178,104,98,.55);--c-dot:#b26862}.gg-oat{--c-dark:rgba(206,186,152,.55);--c-dot:#ceba98}
.gg-words{text-align:center;padding:10px 16px 14px;border-bottom:1px solid var(--gg-line);margin-bottom:4px}
.gg-words .gg-lead{font-family:"Bodoni Moda","Bodoni Moda Fallback",Georgia,serif;font-style:italic;font-size:22px;color:#6b5a48;margin:0}
.gg-words h2{font-family:"Bodoni Moda","Bodoni Moda Fallback",Georgia,serif;font-weight:500;font-size:34px;line-height:1.1;margin:0 0 8px;color:#3b2a20;text-wrap:balance}
.gg-top{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:44px}
.gg-ship{margin:0;font-size:12px;font-weight:600;color:#3f5a1c;background:#eef2e6;border-radius:999px;padding:5px 12px}
.gg-share-wrap{position:relative;display:inline-block}
.gg-share{min-height:32px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;border:1px solid #ddd8cc;background:#fff;color:var(--gg-ink);border-radius:999px;padding:5px 14px}
.gg-share-menu{position:absolute;z-index:5;top:calc(100% + 6px);left:50%;transform:translateX(-50%);display:flex;flex-direction:column;min-width:150px;background:hsl(var(--background));border:1px solid var(--gg-line);border-radius:12px;box-shadow:0 6px 20px rgba(0,0,0,.12);padding:4px}
.gg-share-menu a,.gg-share-menu button{display:flex;align-items:center;min-height:44px;padding:0 12px;font-size:13px;font-weight:600;color:var(--gg-ink);text-decoration:none;background:none;border:0;text-align:left;border-radius:8px}
.gg-share-menu a:hover,.gg-share-menu button:hover{background:hsl(var(--muted) / .6)}
:root[data-theme="dark"] .gg-words .gg-lead,:root[data-theme="dark"] .gg-words h2{color:var(--gg-ink)}
.gg-check{background-color:#faf7f0;background-image:repeating-linear-gradient(0deg,var(--c-dark) 0 30px,transparent 30px 60px),repeating-linear-gradient(90deg,var(--c-dark) 0 30px,transparent 30px 60px)}
.gg-dot{display:inline-block;width:11px;height:11px;border-radius:3px;border:1px solid rgba(0,0,0,.1);margin-right:8px;flex:none;background:var(--c-dot)}
.gg-textcover{display:flex;align-items:center;justify-content:center;padding:14%;text-align:center;border:1px solid var(--gg-line)}
.gg-textcover strong{display:block;background:#fffdf7;border:1px solid #e6dccd;border-radius:999px 999px 10px 10px;padding:30% 8% 18%;width:100%;font-family:"Bodoni Moda","Bodoni Moda Fallback",Georgia,serif;font-size:15px;font-weight:500;line-height:1.15;color:#3b2a20;overflow-wrap:anywhere}
.gg-name{display:block;font-size:14px;font-weight:600;margin-top:7px;text-align:center;line-height:1.3}
.gg-count{display:block;font-size:11px;color:var(--gg-muted);text-align:center}
.gg-list{list-style:none;margin:16px 0 0;padding:0;counter-reset:gg}
.gg-list>li{border-top:1px solid var(--gg-line);counter-increment:gg}
.gg-item{display:flex;align-items:center;gap:14px;padding:11px 0;color:var(--gg-ink);text-decoration:none;font-size:15px;min-height:44px}
.gg-item::before{content:counter(gg);width:20px;flex:none;font-size:12px;color:var(--gg-muted);font-variant-numeric:tabular-nums}
.gg-thumb{width:52px;height:52px;flex:none;border-radius:10px;border:1px solid var(--gg-line);background:#fff;object-fit:contain}
.gg-letter{display:flex;align-items:center;justify-content:center;font-family:"Bodoni Moda","Bodoni Moda Fallback",Georgia,serif;font-size:22px;color:var(--gg-olive)}
.gg-nm{flex:1;min-width:0;overflow-wrap:anywhere}
.gg-nm small{display:block;font-size:12px;color:var(--gg-muted)}
.gg-badges{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px}
.gg-bdg{font-style:normal;font-size:10px;font-weight:700;letter-spacing:.06em;padding:2px 7px;border-radius:999px;background:#eef2e6;color:#3f5a1c}
.gg-bdg-trending{background:#f6e3d5;color:#8a3d18}.gg-bdg-sponsor{background:#f3dcd8;color:#8c3b3b}
.gg-item:hover .gg-nm,.gg-item:focus-visible .gg-nm{text-decoration:underline}
.gg-shop{font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--gg-olive);white-space:nowrap}
.gg-codes ul{padding:0 10px}
.gg-codes li{display:flex;flex-direction:column;gap:2px;padding:8px 0;border-top:1px solid var(--gg-line)}
.gg-code-store{font-weight:700}
.gg-code-one{display:flex;flex-direction:column;gap:2px;margin-top:4px}
.gg-code-offer{font-size:12px;color:var(--gg-muted)}
.gg-code-row{display:flex;align-items:center;gap:8px;margin-top:4px}
.gg-code-row code{flex:1;border:1px dashed var(--gg-line);border-radius:8px;padding:6px 8px;font-size:13px;letter-spacing:.06em}
.gg-code-row button{min-height:44px;padding:0 12px;border-radius:999px;border:1px solid var(--gg-olive);color:var(--gg-olive);background:transparent;font-weight:700;font-size:12px}
.gg-soon{text-align:center;padding:36px 16px;border-top:1px solid var(--gg-line);margin-top:16px}
.gg-soon h3{font-size:18px;font-weight:700;margin:0 0 6px}
.gg-soon p{margin:0 auto 8px;max-width:44ch;color:var(--gg-muted);font-size:14px}
.gg-more{display:flex;flex-wrap:wrap;gap:0 20px;margin-top:12px}
.gg-disc{border-top:1px solid var(--gg-line);margin-top:26px;padding-top:14px;font-size:12px;color:var(--gg-muted);text-align:center}
.gg-disc p{margin:2px 0}
.gg-disc .gg-more{justify-content:center}
@media (max-width:767px){
.gg-top{flex-wrap:wrap}
.gg-layout{grid-template-columns:minmax(0,1fr)}
.gg-side{position:static;max-height:none;border-right:0;border-bottom:1px solid var(--gg-line);padding:8px 0}
.gg-main{padding:4px 0 24px}
}
`;
