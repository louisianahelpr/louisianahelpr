/**
 * The small business card's look (logo well, name, town, one line; the logo and the name are the links since owner
 * 2026-11-22 "remove visit, they can click the picture or title to visit"), shared by the Small Business Saturday page's
 * sponsor cards (GiftGuideSmallBiz.tsx) and the free "Featured local" cards (SmallBizLocal.tsx), which also show on
 * /shop-small without the sponsor page around them. Scoped under the guides' .gg tokens.
 */
export const SB_CARD_CSS = `
.gg-sb-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(1,minmax(0,1fr));gap:12px}
@media (min-width:640px){.gg-sb-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (min-width:1100px){.gg-sb-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
.gg-sb{display:flex;gap:12px;min-width:0;padding:12px;border:1px solid var(--gg-line);border-radius:14px;background:hsl(var(--card));color:var(--gg-ink)}
.gg-sb-logo{flex:none;display:flex;align-items:center;justify-content:center;width:72px;height:72px;border-radius:12px;background:#faf6ee;overflow:hidden}
.gg-sb-logo img{width:100%;height:100%;object-fit:contain}
.gg-sb-logo b{font-size:12px;line-height:1.15;text-align:center;padding:4px;color:var(--gg-olive);overflow-wrap:anywhere}
.gg-sb-body{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.gg-sb-name{margin:0;padding-right:40px;font-size:15px;font-weight:700;color:var(--gg-ink);overflow-wrap:anywhere}
.gg-sb-town{margin:0;font-size:12px;color:var(--gg-muted)}
.gg-sb-text{margin:0;font-size:13px;line-height:1.4;color:var(--gg-ink);overflow-wrap:anywhere}
.gg-sb-links{display:flex;flex-wrap:wrap;align-items:center;gap:0 14px;margin-top:auto;padding-top:2px}
/* Owner 2026-11-22 ("remove visit, they can click the picture or title to visit"): the 72px logo and the name are the
   links. The name's tap area is 44px tall (12px above and below the 20px line) without moving the card's text. */
.gg-sb a.gg-sb-logo{text-decoration:none}
.gg-sb .gg-sb-name-link{display:inline-block;padding:12px 0;margin:-12px 0;color:inherit;text-decoration:none}
.gg-sb .gg-sb-name-link:hover,.gg-sb .gg-sb-name-link:focus-visible{text-decoration:underline}
`;
