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
.gg-howto{margin:6px 0 12px;padding:10px 8px 10px 14px;border:1px solid var(--gg-line);border-radius:14px;background:hsl(var(--background))}
.gg-howto-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.gg-howto-title{margin:0;font-size:14px;font-weight:700}
.gg-howto-steps{margin:4px 0 0;padding:0 0 0 20px;font-size:13px;line-height:1.5;color:var(--gg-ink)}
@media (min-width:768px){.gg-howto-steps{display:flex;gap:28px;padding-left:18px}.gg-howto-steps li{padding-left:2px}}
.gg-wish-name{display:flex;flex-direction:column;gap:4px;margin:4px 0 12px;max-width:26rem}
.gg-wish-share{margin:8px 0}
.gg-wish-share-btn{min-height:44px;border-radius:999px;padding:0 20px;font-weight:700}
.gg-wish-share-menu{display:flex;flex-direction:column;gap:8px;margin-top:10px;padding:12px;border:1px solid var(--gg-line);border-radius:14px;max-width:34rem}
.gg-wish-link{width:100%;min-height:40px;padding:8px 12px;border:1px solid var(--gg-line);border-radius:10px;font-size:13px;background:hsl(var(--background));color:var(--gg-ink)}
.gg-wish-list>li.gg-wish-row{grid-template-columns:minmax(0,1fr)}
.gg-wish-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:-4px 0 12px 62px}
.gg-wish-actions .gg-shop-btn{margin:0}
.gg-wish-remove{min-height:44px;color:var(--gg-muted)}
.gg-wish-own{display:inline-block;margin:18px 0 4px}
.gg-deal{position:relative}
.gg-deal .gg-heart-deal,.gg-sb .gg-heart-sb{position:absolute;top:6px;right:6px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.15)}
.gg-sb{position:relative}
.gg-toast{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 32px);padding:6px 6px 6px 16px;border-radius:999px;background:hsl(var(--ink-deep));color:hsl(var(--background));font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,.2);pointer-events:auto}
.gg-toast-link{color:inherit;font-weight:700;text-decoration:underline;white-space:nowrap}
`;
