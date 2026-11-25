/**
 * KIDS ITEMS THAT BELONG ON A THEMED KIDS GUIDE (owner 2026-11-24 ~2:05 PM: "if we have any items in kids guide that fits
 * into the new guides like bluey etc then move those into the new page for it"). Each row: the Kids pick (by its link),
 * the theme page it belongs on, and that page's row id holding the same product (`themeId`, from the research lists in
 * ~/.lh-shots/theme-guides-1124/<slug>/items.json, whose notes name the owner's Kids picks).
 *
 * A move takes effect (the pick leaves Kids) only once its theme is live (scripts/gift-guide-themes/<to>.json exists)
 * AND that theme's rows hold `themeId`, so a Kids pick never disappears before its theme page shows it. Every live-theme
 * pick below was already on its theme page (the research lists brought the owner's Kids picks in, sometimes on a better
 * store), so nothing is added to a theme: the pick only leaves Kids. Pokémon, Minecraft and Hot Wheels are not imported
 * yet; their rows wait here and apply on import. `themeId: null`: the theme's research has no row for it yet, so it
 * stays on Kids until one is added. Owner-facing list: ~/.lh-shots/kids-theme-moves-1124.md.
 * Applied by scripts/giftGuideThemes1124.mjs applyThemeGuides1124 (the generator's last step).
 * Guard: src/test/giftGuideKidsThemeRow1124.test.tsx.
 */

/**
 * [Kids pick link, Kids pick name, theme slug, theme row id or null, held?]. `held`: why the pick stays on Kids for now
 * though its theme page has it (an owner decision this list cannot make), shown on the owner's list.
 */
export const KIDS_THEME_MOVES_1124 = [
  ["https://walmrt.us/4CcMa3A", "Monster Jam Grave Digger Toddler Slippers", "monster-jam", "MJ03"],
  ["https://go.shopmy.us/p-110125702", "Monster Jam Smash and Bash Toy Vehicle Playset", "monster-jam", "MJ30"],
  // Same Walmart Christmas-exclusive pack at $15; the theme row uses another short link to the same listing.
  ["https://walmrt.us/3V7qKEv", "Monster Jam 1:64 Truck 4-Pack with 3 Mini Jams", "monster-jam", "MJ10"],
  ["https://go.shopmy.us/p-110119731", "Monster Jam Air Hockey Tabletop Game", "monster-jam", "MJ50"],
  ["https://go.shopmy.us/p-110125353", "Monster Jam Grave Digger Remote Control Truck", "monster-jam", "MJ20"],
  ["https://mavely.app.link/yftqKoJ9j8b", "Monster Jam Megalodon & El Toro Loco Supercharge Speedway Playset", "monster-jam", "MJ31"],
  // Hot Wheels Monster Trucks: on the live Monster Jam page ("Monster truck extras (Hot Wheels)") with the same links.
  ["https://go.shopmy.us/p-110125781", "Hot Wheels Monster Trucks Mutant Chaos Truck, Car and Slime", "monster-jam", "MJ95"],
  ["https://go.shopmy.us/p-110125801", "Hot Wheels Monster Trucks Mutant Chaos Loop Challenge Playset", "monster-jam", "MJ97"],
  ["https://walmrt.us/3VHA424", "Bluey Toddler Pajama Set", "bluey", "BL40"],
  // Kids had these on Amazon; the Bluey page has the same product on Walmart (same or near price, better rate).
  ["https://www.amazon.com/dp/B083XNCRS3?tag=louisianahelpr-20", "Bluey Family Figure 4-Pack", "bluey", "BL11"],
  // Held: one of the six photos the owner pinned on the Kids cover (scripts/gift-guide-cover-pins.json, the Kids share
  // card), and it carries an approved "shop similar" on Kids; moving it means a new Kids cover photo, her call.
  ["https://www.amazon.com/dp/B0G3RKYTMS?tag=louisianahelpr-20", "Bluey Light and Surprise Heeler House", "bluey", "BL70", "on the Kids cover you pinned"],
  // Owner 11-24 (via the lead): moves WITH its approved dupe; its record in src/content/giftGuideDupes.json now names
  // "bluey", the one dupe a theme page shows (src/content/giftGuideCatalog.ts loadGuidePicks).
  ["https://go.shopmy.us/p-109156399", "Yoto Player 4th Gen + Bluey Adventure Bundle", "bluey", "BL74"],
  ["https://www.amazon.com/dp/B0BRTCTT6X?tag=louisianahelpr-20", "Shakespeare Spider-Man Kids Fishing Kit", "marvel", "MV74"],
  ["https://walmrt.us/4AQxuWv", "KPop Demon Hunters Girls Slippers", "kpop-demon-hunters", "KP01"],
  // Not imported yet (research waits on Walmart links): applies when Minecraft is imported.
  ["https://go.shopmy.us/p-110125837", "LEGO Minecraft Woodland Mansion Fighting Ring", "minecraft", "MC20"],
  // Owner 11-24 ~10:45 PM (via the lead): "the minecraft tooth brush in the kids guide can be moved to the minecraft
  // guide." The Minecraft research now holds it as her pick MC80 (Amazon, page only; read 10:47 PM, $5.42, in stock).
  ["https://www.amazon.com/dp/B0CFFZ389Y?tag=louisianahelpr-20", "Colgate Minecraft Kids Toothbrush", "minecraft", "MC80"],
  // Melissa & Doug (owner 11-24 ~11:05 PM: "create a lego and melissa and doug guide"): all seven Kids M&D picks move.
  // Same link on the theme page: the easel and beauty kiosk (Walmart.com doesn't sell them) and the 4-vehicle pull-back
  // set (Walmart.com has only a 2-pack; sold out at Macy's 11-24, kept on). The theme row is on Walmart for the SAME item
  // where Walmart is in stock or clearly cheaper (11-24 ~11:15 PM): Doorbell House (Macy's sold out, Walmart $23.49),
  // Cardboard Blocks 24 (Macy's $32.99, Walmart $17.49), Shopping Cart (Wayfair $55.99, Walmart $45.99).
  ["https://go.shopmy.us/p-108631978", "Melissa & Doug Pull-Back Vehicle Toys", "melissa-and-doug", "MD35"],
  ["https://go.shopmy.us/p-108632004", "Melissa & Doug Wooden Doorbell House", "melissa-and-doug", "MD40"],
  ["https://go.shopmy.us/p-109002741", "Melissa & Doug Jumbo Cardboard Blocks, 24 Pieces", "melissa-and-doug", "MD33"],
  ["https://go.shopmy.us/p-108631991", "Melissa & Doug Double-Sided Magnetic Tabletop Easel", "melissa-and-doug", "MD14"],
  ["https://go.shopmy.us/p-110119982", "Melissa & Doug Sort, Stock, Select Beauty Kiosk Play Set", "melissa-and-doug", "MD28"],
  ["https://go.shopmy.us/p-108632046", "Melissa & Doug Toy Shopping Cart", "melissa-and-doug", "MD27"],
  // Moves WITH its approved dupe, the owner's Yoto precedent (lead 11-24 ~11:40 PM): its record in
  // src/content/giftGuideDupes.json now names "melissa-and-doug".
  ["https://go.shopmy.us/p-108632077", "Melissa & Doug Wood Furnished Mansion", "melissa-and-doug", "MD44"],
];
