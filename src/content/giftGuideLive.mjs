/**
 * The only gift guides live on the site (owner 2026-11-21 2:47 AM: "launch the 3 guides remove the rest that are live
 * ... should we jsut do him, her and kids?"; decided yes). Every other guide (the interest guides, every store page,
 * the deals and Small Business Saturday pages, any hub child) is retired for now: no tile, menu entry, search row,
 * sitemap or SEO entry, no picks chunk in the bundle, and an old link lands on /gift-guides. The research data and
 * chunk sources stay, so a guide comes back by adding its slug here and regenerating
 * (node scripts/gift-guide-picks.mjs && node scripts/gift-guide-search-index.mjs && node scripts/generate-sitemap.mjs).
 * The relationship pages (mom, wife, dad ... src/content/giftGuidePeople.mjs RELATION_PAGES) are views of Her and Him
 * and stay with them. "25-days-sponsors" is the 25 Days of Giveaways sponsors page, not a gift guide: it stays as is.
 * "black-friday-cyber-monday" is the deals page (owner 2026-11-21: "we still need to do the black friday section, small
 * business saturday, and cyber monday deals"): one page, three day sections, never inside Her, Him or Kids
 * (src/content/giftGuideDeals.mjs). The standalone Small Business Saturday page stays retired: its businesses are the
 * deals page's middle section.
 * Guard: src/test/giftGuideOnlyThree1121.test.ts.
 */
export const LIVE_GUIDES_1121 = ["her", "him", "kids", "25-days-sponsors", "black-friday-cyber-monday"];

/** Whether a guide slug is live (LIVE_GUIDES_1121). */
export const isLiveGuide = (slug) => LIVE_GUIDES_1121.includes(slug);
