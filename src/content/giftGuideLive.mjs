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
 * The themed kids guides (THEME_GUIDE_NAMES_1124 below: Monster Jam, then Bluey, Pokémon ...) are live too, right after
 * Kids. Guard: src/test/giftGuideOnlyThree1121.test.tsx.
 */

/**
 * The themed kids guides (owner 2026-11-24: Monster Jam first, then Marvel, Bluey, KPop Demon Hunters ...): her own
 * researched lists in their own groups ("with every item we can find"), so the general guides' section sizes, type
 * variety, commission order and Amazon-price rules do not apply to them (each guard skips isThemeGuide).
 * slug -> the theme's name (the menu row's label; the page is "<name> Gift Guide"), in menu order. A theme is here
 * exactly when its rows file scripts/gift-guide-themes/<slug>.json exists: `node scripts/theme-guide-import.mjs` adds
 * both. Guard: src/test/giftGuideThemes1124.test.tsx.
 */
export const THEME_GUIDE_NAMES_1124 = { "monster-jam": "Monster Jam", "bluey": "Bluey", "marvel": "Marvel", "kpop-demon-hunters": "KPop Demon Hunters", "pokemon": "Pokémon", "minecraft": "Minecraft", "hot-wheels": "Hot Wheels", "cars": "Pixar Cars", "numberblocks": "Numberblocks", "melissa-and-doug": "Melissa & Doug" };
export const THEME_GUIDES_1124 = Object.keys(THEME_GUIDE_NAMES_1124);

export const LIVE_GUIDES_1121 = ["her", "him", "kids", ...THEME_GUIDES_1124, "25-days-sponsors", "black-friday", "small-business-saturday", "cyber-monday"];

/** Whether a guide slug is one of the themed kids guides (THEME_GUIDES_1124). */
export const isThemeGuide = (slug) => THEME_GUIDES_1124.includes(slug);

/** Whether a guide slug is live (LIVE_GUIDES_1121). */
export const isLiveGuide = (slug) => LIVE_GUIDES_1121.includes(slug);
