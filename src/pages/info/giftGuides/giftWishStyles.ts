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
@media (max-width:767px){.gg-wish-mine>.gg-item{padding-right:52px}}
.gg-toast .gg-toast-undo{border:0;background:transparent;min-height:44px;padding:0 14px;font:inherit;font-weight:700;cursor:pointer}
.gg-wish-own{display:inline-block;margin:18px 0 4px}
.gg-deal{position:relative}
.gg-deal .gg-heart-deal,.gg-sb .gg-heart-sb{position:absolute;top:6px;right:6px}
.gg-sb{position:relative}
.gg-toast{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:60;display:flex;align-items:center;gap:10px;width:max-content;max-width:min(calc(100vw - 32px),30rem);box-sizing:border-box;padding:6px 6px 6px 16px;border-radius:999px;background:hsl(var(--ink-deep));color:hsl(var(--background));font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,.2);pointer-events:auto}
.gg-toast-text{flex:1 1 auto;min-width:0;line-height:1.3}
.gg-toast-short{display:none}
@media (max-width:400px){.gg-toast{gap:6px;padding:4px 4px 4px 14px}.gg-toast-text,.gg-toast-link{white-space:nowrap}.gg-toast .gg-toast-long{display:none}.gg-toast .gg-toast-short{display:inline}}
.gg-toast .gg-toast-link{color:inherit;font-weight:700;text-decoration:underline;white-space:nowrap}
.gg-wish-title{margin:2px 0 4px;font-size:26px;line-height:1.2;font-weight:700;overflow-wrap:anywhere}
.gg-wish-lead{margin:8px 0 0;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--gg-muted)}
.gg-wish-missing{margin:6px 0 0;font-size:13px;color:var(--gg-muted)}
.gg-shared-person{margin:18px 0 0}
.gg-shared-person-name{margin:0;font-size:20px;line-height:1.25;font-weight:700;overflow-wrap:anywhere}
`;
