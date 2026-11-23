/**
 * Daily price re-checks for the owner's lists (For Her, For Him, For Kids): link -> { price, priceAt }. The daily price
 * job re-reads each pick's real product page (Desktop Link-library fill_prices.py fetcher; never go.shopmy.us, never
 * api.shopmy.us, never Amazon) and, when the price it reads EQUALS the price the pick already shows, appends the link
 * here with the check day. The builders (scripts/giftGuideHer1121.mjs her1121Picks, scripts/giftGuideHimKids1121.mjs
 * build) apply it last, so the page's "Prices as of" day moves forward without regenerating the guides (re-running
 * scripts/gift-guide-picks.mjs from the Desktop picks folder would undo hand edits); the committed picks JSON gets the
 * same priceAt by hand. A price that CHANGED is not a re-check: it is edited on its row. An entry whose price no longer
 * matches its pick is ignored here and fails src/test/giftGuidePriceRecheck1123.test.ts, so a stale entry never moves a
 * date. A newer day replaces the older one in place; one entry per link.
 */

/** @type {Record<string, { price: number, priceAt: string }>} */
export const PRICE_RECHECKS = {
  // 2026-11-23 (price-refresh-1123): 73 links re-read, every price unchanged. The product page read is beside each.
  // BaubleBar Mini 14K Gold Spaced Letter Custom Name Necklace: https://www.baublebar.com/products/mini-18k-gold-custom-spaced-letter-name-necklace
  // (re-read 11-23 PM, guides-under10: the page's own title is "Mini 14K Gold Spaced Letter Custom Name Necklace", metal
  // "14K Gold Plated Sterling Silver", $148; only its address says 18k, so the card's 14K name stays.)
  "https://go.shopmy.us/p-109205223": { price: 148, priceAt: "2026-11-23" },
  // Eberjey Gisele Slouchy PJ Set, Black/Ivory: https://eberjey.com/products/gisele-tencel-modal-slouchy-pj-set-black-ivory
  // (11-23 PM, guides-under10: store product data, $148 in every size)
  "https://go.shopmy.us/p-104580620": { price: 148, priceAt: "2026-11-23" },
  // BaubleBar Mini Fine Line Custom Hair Brush, Magenta: https://www.baublebar.com/products/fine-line-mini-custom-hair-brush-magenta
  "https://go.shopmy.us/p-109289957": { price: 48, priceAt: "2026-11-23" },
  // BURLEBO Cap: https://burlebo.com/products/burlebo-outdoors-cap
  "https://go.shopmy.us/p-109005373": { price: 28, priceAt: "2026-11-23" },
  // Burlebo Thermal Waffle Knit Hoodie: https://www.burlebo.com/products/thermal-hoodie-classic-deer-camo
  "https://go.shopmy.us/p-109005228": { price: 47.2, priceAt: "2026-11-23" },
  // CALPAK Insulated Lunch Bag, Polka Dot: https://www.calpaktravel.com/products/insulated-lunch-bag?variant=40771037691962 (Polka Dot variant, store product data)
  "https://go.shopmy.us/p-109201389": { price: 38.4, priceAt: "2026-11-23" },
  // Camp Snap 2 Screen-Free Camera, Strawberry Splash: https://campsnapphoto.com/products/camp-snap-2
  "https://go.shopmy.us/p-104219842": { price: 59.99, priceAt: "2026-11-23" },
  // Crocs Dylan Platform Clog: https://www.crocs.com/p/dylan-platform-clog/209869.html?cid=2EY
  "https://go.shopmy.us/p-108985937": { price: 35, priceAt: "2026-11-23" },
  // Crown Affair The Silk Pillowcase: https://crownaffair.com/products/the-silk-pillowcase
  "https://go.shopmy.us/p-109200757": { price: 88, priceAt: "2026-11-23" },
  // CrunchLabs The Crunchinator: https://www.crunchlabs.com/products/the-crunchinator
  "https://go.shopmy.us/p-109208209": { price: 34.99, priceAt: "2026-11-23" },
  // Duck Commander Youth Happy Tee, Cream: https://duckcommander.com/products/duck-commander-cream-youth-happy-tee
  "https://go.shopmy.us/p-109341055": { price: 19.99, priceAt: "2026-11-23" },
  // Esker The Bubble Soak: https://eskerbeauty.com/products/bubble-soak
  "https://go.shopmy.us/p-109207730": { price: 75, priceAt: "2026-11-23" },
  // Haydel's Bakery Christmas King Cake: https://www.goldbelly.com/restaurants/haydels-bakery/christmas-king-cake
  "https://go.shopmy.us/p-108155517": { price: 69.95, priceAt: "2026-11-23" },
  // Katie Kime New Orleans Toile Lucite Tray, Green: https://katiekime.com/products/new-orleans-lucite-tray
  "https://go.shopmy.us/p-108006579": { price: 58, priceAt: "2026-11-23" },
  // KREWE Olivier Sunglasses, Reed: https://www.krewe.com/products/olivier-reed-sunglasses
  "https://go.shopmy.us/p-109340844": { price: 255, priceAt: "2026-11-23" },
  // L'OCCITANE Softening Almond Trio: https://www.ulta.com/p/softening-almond-trio-gift-set-pimprod2060959?sku=2661577
  "https://go.shopmy.us/p-109002206": { price: 59, priceAt: "2026-11-23" },
  // Lake Men's Flannel Pajama Pants, Dark Sea Windowpane: https://lakepajamas.com/products/dark-sea-cozy-windowpane-mens-flannel-pajama-pants
  "https://go.shopmy.us/p-104054474": { price: 108, priceAt: "2026-11-23" },
  // Lodge 6 Quart Essential Enamel Dutch Oven: https://www.lodgecastiron.com/products/6-quart-enamel-dutch-oven
  "https://go.shopmy.us/p-109340963": { price: 89.9, priceAt: "2026-11-23" },
  // Marley Lilly Personalized Waxed Canvas Small Cooler: https://www.marleylilly.com/products/personalized-waxed-canvas-small-cooler
  "https://go.shopmy.us/p-109208941": { price: 34.99, priceAt: "2026-11-23" },
  // Match South x Café Du Monde Warm Beignets Candle: https://matchsouth.com/products/warm-beignets-candle-cafe-du-monde-x-match-south
  "https://go.shopmy.us/p-107207657": { price: 49, priceAt: "2026-11-23" },
  // Mignon Faget Fleur de Lis Cufflinks: https://www.mignonfaget.com/men/cufflinks/fleur-de-lis-cufflinks-0824/
  "https://go.shopmy.us/p-109342284": { price: 184, priceAt: "2026-11-23" },
  // Mignon Faget Heirloom Fleur de Lis Pendant: https://www.mignonfaget.com/jewelry/pendants/heirloom-fleur-de-lis-pendant-7661/
  "https://go.shopmy.us/p-109341967": { price: 75, priceAt: "2026-11-23" },
  // Mignon Faget Oyster Large Earrings: https://www.mignonfaget.com/jewelry/earrings/oyster-large-earrings-1795/
  "https://go.shopmy.us/p-109342173": { price: 120, priceAt: "2026-11-23" },
  // OOFOS OOahh PLUS Slide, Chalk: https://www.oofos.com/products/womens-ooahh-plus-slide-sandal-chalk
  "https://go.shopmy.us/p-109202100": { price: 69.95, priceAt: "2026-11-23" },
  // OOFOS OOcloog Limited Edition Clog, Nomad Leopard: https://www.oofos.com/products/womens-oocloog-limited-edition-clog-nomad-leopard
  "https://go.shopmy.us/p-109201629": { price: 89.95, priceAt: "2026-11-23" },
  // Patchology Rosé Fingers Renewing Hand Mask: https://www.dermstore.com/p/patchology-rose-fingers-renewing-hand-mask-54g/14014046/
  "https://go.shopmy.us/p-109205545": { price: 11, priceAt: "2026-11-23" },
  // Salt & Stone Hair & Body Spray: https://cosbar.com/products/saffron-cedar-body-mist-1
  "https://go.shopmy.us/p-109002459": { price: 45, priceAt: "2026-11-23" },
  // Shark Depuffi Hot & Cold Face Sculpting Tool: https://www.sharkninja.com/shark-depuffi-contrast-therapy-device-in-pink-sparkle/FH220PK1.html
  "https://go.shopmy.us/p-107555566": { price: 149.99, priceAt: "2026-11-23" },
  // Slip Pure Silk Queen Zippered Pillowcase, Seabreeze: https://www.slip.com/products/seabreeze-queen-zippered-pillowcase
  "https://go.shopmy.us/p-109201186": { price: 84, priceAt: "2026-11-23" },
  // Smathers & Branson Camo Needlepoint Belt: https://duckhead.com/products/smathers-branson-camo-belt-camo
  "https://go.shopmy.us/p-108628518": { price: 195, priceAt: "2026-11-23" },
  // Smathers & Branson Duck Decoys Needlepoint Key Fob: https://smathersandbranson.com/products/duck-decoys-needlepoint-key-fob-antique-blue
  "https://go.shopmy.us/p-108628349": { price: 35, priceAt: "2026-11-23" },
  // Smathers & Branson Fish and Tackle Toiletry Bag: https://www.smathersandbranson.com/products/fish-and-tackle-pattern-toiletry-bag
  "https://go.shopmy.us/p-108108555": { price: 155, priceAt: "2026-11-23" },
  // Smathers & Branson Fishing Flies Coasters: https://smathersandbranson.com/products/fishing-flies-needlepoint-coaster-set
  "https://go.shopmy.us/p-108628457": { price: 158, priceAt: "2026-11-23" },
  // Smathers & Branson Home Sweet Home Needlepoint Valet Tray: https://www.smathersandbranson.com/products/home-sweet-home-needlepoint-valet-tray
  "https://go.shopmy.us/p-109200363": { price: 95, priceAt: "2026-11-23" },
  // Smathers & Branson LSU Bi-Fold Wallet: https://smathersandbranson.com/products/lsu-needlepoint-bi-fold-wallet
  "https://go.shopmy.us/p-108628276": { price: 170, priceAt: "2026-11-23" },
  // Smathers & Branson LSU Bottle Opener: https://smathersandbranson.com/products/lsu-needlepoint-bottle-opener
  "https://go.shopmy.us/p-108628309": { price: 35, priceAt: "2026-11-23" },
  // Smathers & Branson LSU Card Wallet: https://smathersandbranson.com/products/lsu-needlepoint-card-wallet
  "https://go.shopmy.us/p-108628318": { price: 65, priceAt: "2026-11-23" },
  // Smathers & Branson LSU Cufflinks: https://smathersandbranson.com/products/lsu-needlepoint-cufflinks
  "https://go.shopmy.us/p-108628296": { price: 75, priceAt: "2026-11-23" },
  // Smathers & Branson LSU Driver Headcover: https://smathersandbranson.com/products/lsu-driver-headcover
  "https://go.shopmy.us/p-108628274": { price: 110, priceAt: "2026-11-23" },
  // Smathers & Branson LSU Flask: https://smathersandbranson.com/products/lsu-needlepoint-flask-purple
  "https://go.shopmy.us/p-108628018": { price: 75, priceAt: "2026-11-23" },
  // Smathers & Branson LSU Toiletry Bag: https://smathersandbranson.com/products/lsu-needlepoint-toiletry-bag
  "https://go.shopmy.us/p-108628280": { price: 155, priceAt: "2026-11-23" },
  // Smathers & Branson Mallard Can Cooler: https://www.smathersandbranson.com/products/mallard-needlepoint-can-cooler-classic-navy
  "https://go.shopmy.us/p-108108365": { price: 35, priceAt: "2026-11-23" },
  // Smathers & Branson Monogrammed Coasters: https://smathersandbranson.com/products/monogrammed-coasters
  "https://go.shopmy.us/p-108628052": { price: 183, priceAt: "2026-11-23" },
  // Smathers & Branson Monogrammed Key Fob: https://smathersandbranson.com/products/monogrammed-key-fob
  "https://go.shopmy.us/p-108628047": { price: 50, priceAt: "2026-11-23" },
  // Smathers & Branson Monogrammed Valet Tray: https://smathersandbranson.com/products/monogrammed-valet-tray
  "https://go.shopmy.us/p-108628058": { price: 115, priceAt: "2026-11-23" },
  // Smathers & Branson Monogrammed Wallet, Hunter Green: https://smathersandbranson.com/products/monogrammed-wallet
  "https://go.shopmy.us/p-109208695": { price: 195, priceAt: "2026-11-23" },
  // Smathers & Branson Rainbow Trout Tervis Tumbler: https://smathersandbranson.com/products/rainbow-trout-tumbler
  "https://go.shopmy.us/p-108628554": { price: 49.5, priceAt: "2026-11-23" },
  // Smathers & Branson Redfish Bottle Opener: https://smathersandbranson.com/products/redfish-needlepoint-needlepoint-bottle-opener-dark-navy
  "https://go.shopmy.us/p-108628535": { price: 35, priceAt: "2026-11-23" },
  // Smathers & Branson Redfish Key Fob: https://smathersandbranson.com/products/redfish-needlepoint-key-fob-dark-navy
  "https://go.shopmy.us/p-108628533": { price: 35, priceAt: "2026-11-23" },
  // Smathers & Branson Upland Shoot Can Cooler: https://smathersandbranson.com/products/upland-shoot-needlepoint-can-cooler
  "https://go.shopmy.us/p-108628411": { price: 35, priceAt: "2026-11-23" },
  // Smathers & Branson Upland Shoot Card Wallet: https://smathersandbranson.com/products/upland-shoot-needlepoint-credit-card-wallet
  "https://go.shopmy.us/p-108628421": { price: 65, priceAt: "2026-11-23" },
  // Smathers & Branson Upland Shoot Key Fob: https://smathersandbranson.com/products/upland-shoot-needlepoint-key-fob
  "https://go.shopmy.us/p-108628429": { price: 35, priceAt: "2026-11-23" },
  // Smathers & Branson Upland Shoot Sunglass Strap: https://smathersandbranson.com/products/upland-shoot-sunglass-strap
  "https://go.shopmy.us/p-108628379": { price: 79.5, priceAt: "2026-11-23" },
  // Smathers & Branson Upland Shoot Tervis Tumbler: https://smathersandbranson.com/products/upland-shoot-needlepoint-tervis-tumbler
  "https://go.shopmy.us/p-108628432": { price: 49.5, priceAt: "2026-11-23" },
  // Smathers & Branson Wood Duck Decoy Bottle Opener: https://smathersandbranson.com/products/wood-duck-decoy-needlepoint-bottle-opener-antique-blue
  "https://go.shopmy.us/p-108628348": { price: 35, priceAt: "2026-11-23" },
  // Smathers & Branson World's Best Dad Tervis Tumbler: https://smathersandbranson.com/products/worlds-best-dad-tervis-tumbler-with-lid
  "https://go.shopmy.us/p-108104267": { price: 54, priceAt: "2026-11-23" },
  // Therabody Theragun Mini: https://www.ulta.com/p/theragun-mini-3rd-generation-portable-massage-gun-pimprod2053315?sku=2647331
  "https://go.shopmy.us/p-107903671": { price: 154.99, priceAt: "2026-11-23" },
  // Toups and Co Baby Essentials Set: https://toupsandco.com/products/baby-essentials-set
  "https://go.shopmy.us/p-109341153": { price: 43, priceAt: "2026-11-23" },
  // Turtlebox Original Gen 3 Speaker: https://www.onwardreserve.com/products/turtlebox-gen-3-speaker-tan
  "https://go.shopmy.us/p-108999848": { price: 430, priceAt: "2026-11-23" },
  // Turtlebox Ranger Speaker: https://www.onwardreserve.com/products/turtlebox-ranger-tan
  "https://go.shopmy.us/p-108736312": { price: 250, priceAt: "2026-11-23" },
  // UGG Scuffette II Slipper, Chestnut: https://www.zappos.com/product/107219/color/888138
  "https://go.shopmy.us/p-104053242": { price: 99.95, priceAt: "2026-11-23" },
  // XTRATUF Ankle Deck Boot: https://xtratuf.com/products/22734
  "https://www.anrdoezrs.net/click-101930553-15735628?url=https%3A%2F%2Fxtratuf.com%2Fproducts%2F22734": { price: 115, priceAt: "2026-11-23" },
  // XTRATUF Big Kids Ankle Deck Boot, White and Blue: https://xtratuf.com/products/xkab100y
  "https://www.anrdoezrs.net/click-101930553-15735628?url=https%3A%2F%2Fxtratuf.com%2Fproducts%2Fxkab100y": { price: 44.99, priceAt: "2026-11-23" },
  // XTRATUF Mossy Oak Bottomland Ankle Deck Boot: https://xtratuf.com/products/xmabmob
  "https://www.anrdoezrs.net/click-101930553-15735628?url=https%3A%2F%2Fxtratuf.com%2Fproducts%2Fxmabmob": { price: 125, priceAt: "2026-11-23" },
  // XTRATUF Women's Camp Fleece Lined Ankle Deck Boot, Bone White/Dark Olive: https://xtratuf.com/products/xwadbc10
  "https://www.anrdoezrs.net/click-101930553-15735628?url=https%3A%2F%2Fxtratuf.com%2Fproducts%2Fxwadbc10": { price: 130, priceAt: "2026-11-23" },
  // YETI Crossroads 22L Backpack, Alpine Brown: https://yeti.com/bags/backpacks/18060131468.html
  "https://go.shopmy.us/p-107838580": { price: 160, priceAt: "2026-11-23" },
  // YETI Crossroads Duffel Bag, 60L: https://www.yeti.com/bags/duffels/26010000331.html
  "https://go.shopmy.us/p-109003951": { price: 200, priceAt: "2026-11-23" },
  // YETI Crossroads Luggage: https://www.yeti.com/bags/luggage/26010000370.html
  "https://go.shopmy.us/p-109003793": { price: 280, priceAt: "2026-11-23" },
  // YETI LoadOut GoBox 30 Gear Case: https://www.yeti.com/cases-storage/hard-cases/26010000539.html
  "https://go.shopmy.us/p-109003412": { price: 250, priceAt: "2026-11-23" },
  // YETI Panga Waterproof Duffel: https://www.yeti.com/bags/duffels/26010000231.html
  "https://go.shopmy.us/p-109003630": { price: 400, priceAt: "2026-11-23" },
  // YETI Rambler 12 oz Colster Can Insulator: https://www.yeti.com/drinkware/barware/21071508953.html
  "https://go.shopmy.us/p-109004254": { price: 25, priceAt: "2026-11-23" },
  // YETI Rambler 20 oz Tumbler, Upland: https://www.yeti.com/drinkware/tumblers/21071509313.html
  "https://go.shopmy.us/p-109004159": { price: 40, priceAt: "2026-11-23" },
  // YETI Sidekick Dry 3L Gear Case, Olive: https://www.yeti.com/bags/bags-accessories/18060131320.html
  "https://go.shopmy.us/p-109004058": { price: 55, priceAt: "2026-11-23" },
  // YETI Tundra 45 Hard Cooler: https://www.yeti.com/coolers/hard-coolers/tundra/10045450025.html
  "https://go.shopmy.us/p-109001581": { price: 325, priceAt: "2026-11-23" },
};

/** The as-of day a pick shows: the re-check day when one lists this link at this exact price and is newer, else `priceAt`. */
export function recheckedPriceAt(href, price, priceAt) {
  const r = PRICE_RECHECKS[href];
  if (!r || r.price !== price || typeof priceAt !== "string" || r.priceAt <= priceAt) return priceAt;
  return r.priceAt;
}
