/**
 * The only gift guides live on the site (owner 2026-11-21 2:47 AM: "launch the 3 guides remove the rest that are live
 * ... should we jsut do him, her and kids?"; decided yes). Every other guide (the interest guides, every store page,
 * the deals and Small Business Saturday pages, any hub child) is retired for now: no tile, menu entry, search row,
 * sitemap or SEO entry, no picks chunk in the bundle, and an old link lands on /gift-guides. The research data and
 * chunk sources stay, so a guide comes back by adding its slug here and regenerating
 * (node scripts/gift-guide-picks.mjs && node scripts/gift-guide-search-index.mjs && node scripts/generate-sitemap.mjs).
 * The relationship pages (mom, wife, dad ... src/content/giftGuidePeople.mjs RELATION_PAGES) are views of Her and Him
 * and stay with them. "25-days-sponsors" is the 25 Days of Giveaways sponsors page, not a gift guide: it stays as is.
 * "black-friday", "small-business-saturday" and "cyber-monday" are the deals days (owner 2026-11-21: "we still need to
 * do the black friday section, small business saturday, and cyber monday deals"; later "like each day has its own
 * section, no need to put them all in 1"): one page per day, never inside Her, Him or Kids (src/content/giftGuideDeals.mjs
 * DEAL_DAY_SLUGS). Small Business Saturday is the confirmed Louisiana 25 Days sponsors only. The old one-page address
 * "black-friday-cyber-monday" opens Black Friday. The store codes and sales live on the deals days too (owner 11-21:
 * "Codes and deals shouldn't randomly show in sections"), each day only its own, with a sidebar entry and no tile.
 * Guard: src/test/giftGuideOnlyThree1121.test.tsx.
 */
export const LIVE_GUIDES_1121 = ["her", "him", "kids", "25-days-sponsors", "black-friday", "small-business-saturday", "cyber-monday"];

/** Whether a guide slug is live (LIVE_GUIDES_1121). */
export const isLiveGuide = (slug) => LIVE_GUIDES_1121.includes(slug);
