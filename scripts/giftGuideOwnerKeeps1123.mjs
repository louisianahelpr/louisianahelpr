/**
 * OWNER KEEPS 11-23 (Mon Nov 23 ~10:50 AM): the gifts the owner kept from the under-$25 suggestions (Desktop note
 * "Gift guides and affiliate/Affordable-under-25-1123/owner-keeps-1123.json": 17 For Him, 22 For Kids). These are the
 * Amazon ones (14 Him, 16 Kids), each priced on its amazon.com product page 2026-11-23 between 10:11 and 10:21 AM CT.
 * Rows: [ASIN, price, Amazon photo id, name, brand, type, commission %, line]. They are her picks, so the brand and type
 * caps do not apply. The Fire TV Stick uses Amazon's own second photo (its main photo has a beige backdrop and text).
 * HELD (waiting on affiliate links from her ShopMy / Walmart Creator accounts, signed out 11-23): Blackstone burger press,
 * Walmart Dearfoams slippers, Lodge skillet (Him); OOLY hair crayons, Floss & Rock memory match, Tender Leaf binoculars,
 * Sweet Wink cape, Brainstorm shark torch (Maisonette via ShopMy), Burt's Bees Baby pajamas (Kids).
 * SECOND KEEPS (owner ~11:55 AM, owner-keeps-1123b.json): 19 Her and 9 Him Amazon picks (HER_KEEPS_1123_ROWS and the
 * end of HIM_KEEPS_1123_ROWS), re-read on amazon.com 11-23 12:02-12:04 PM; the 7 non-Amazon ones are held (below).
 * HELD LINKS MADE (11-23 12:18-12:34 PM): the Maisonette, Burt's Bees Baby, Ulta and Lodge keeps are *_LINKS_1123_ROWS
 * below; the Capri Blue car diffuser went to Amazon. Still out: Blackstone press (no link possible). Dearfoams came in with her Walmart Creator link (HIM_WALMART_1123_ROWS).
 * Guard: src/test/giftGuideStockingStuffers1123.test.tsx.
 */

/** The day these prices were checked (Louisiana day). */
export const KEEPS_PRICE_AT = "2026-11-23";

/** For Him (owner 11-23 keeps, Amazon). */
export const HIM_KEEPS_1123_ROWS = [
  ["B0HDDLPQV5", 6.39, "814w+rL0ddL", "Duke Cannon Lump of Coal Big Brick of Soap, 10 oz", "Duke Cannon", "soap", 3, "A giant holiday bar of soap shaped like a lump of coal."],
  ["B002ZK45IQ", 7.99, "81szodoguqL", "Gerber Shard 7-in-1 Keychain Tool, Black", "Gerber", "accessory", 3, "A tiny keychain tool with a pry bar, screwdrivers and a bottle opener."],
  ["B003IWI66W", 9.99, "81PlUc85NNL", "Bear Paws Original Meat Claws, Black", "Bear Paws", "grilling", 4.5, "Claws for pulling pork and lifting a turkey off the pit."],
  ["B0070XAL0E", 10.0, "71+oR54g6mL", "Jack Black Intense Therapy Lip Balm SPF 25", "Jack Black", "lip-balm", 3, "A men's lip balm with sunscreen for long days outside."],
  ["B009IH0ICG", 12.98, "71LQReawJES", "Weber Rapidfire Compact Chimney Starter", "Weber", "grilling", 3, "A small chimney that gets charcoal going without lighter fluid."],
  ["B000O8OTNC", 14.02, "71z3QZWi3OL", "Smith's PP1 Pocket Pal Knife Sharpener", "Smith's", "knife-sharpener", 3, "A pocket sharpener to touch up a blade in the field."],
  ["B01HRCU3SW", 14.99, "91v-qotxdLL", "RAK Magnetic Wristband for Tools", "RAK", "tool-wristband", 3, "A wristband with magnets that holds screws and bits while he works."],
  ["B001E5FLT0", 15.71, "71CtxoQh03L", "Zippo Classic Brushed Chrome Lighter", "Zippo", "lighter", 3, "The classic windproof flip-top lighter."],
  ["B0G4XRP464", 19.99, "61blUHa9vvL", "Amazon Fire TV Stick 4K (newest model)", "Amazon", "streaming-stick", 4, "Plugs into any TV to stream the game and his shows."],
  ["B0CXGXT6W8", 19.99, "714e6+cl0kL", "JLab Go Air Pop+ Earbuds, Black", "JLab", "earbuds", 3, "Small wireless earbuds with a long battery life."],
  ["B0C6XK77HJ", 21.99, "61G6PTRL9PL", "Anker Nano Power Bank, 5,000mAh, Built-In USB-C", "Anker", "power-bank", 4, "A small charger with a built-in USB-C plug for newer phones."],
  ["B0G6GTRHCJ", 22.0, "71+R08lJ1bL", "Levi's Men's Reversible Casual Jeans Belt", "Levi's", "belt", 4, "A leather belt that flips from black to brown."],
  ["B07JCQ8GQJ", 23.88, "81WFd13Cq2L", "Thermacell Fuel-ZoneGuard Extreme Mosquito Repeller, Green", "Thermacell", "mosquito-repeller", 3, "A portable mosquito repeller for the stand, the boat or the porch."],
  ["B0DHT5XZR1", 24.99, "71Lkb3jAQnL", "Callaway Supersoft Golf Balls, 1 Dozen", "Callaway", "golf", 3, "A dozen soft golf balls for weekend rounds."],
  // Second keeps (owner ~11:55 AM, owner-keeps-1123b.json "Him S2".."Him S10"): stocking stuffers, each re-read on its
  // amazon.com page 2026-11-23 12:03-12:04 PM CT (sold by Amazon.com). The worms and the spinnerbait name the color the
  // listing opens on (B00EO96HAA is Tequila Sunrise, 7 in.). The spinnerbait (B003CTQ4U6, opens on Chartreuse) carries no
  // color in its name: "chartreuse" reads as neon to the men's style rule (src/test/giftGuideOwner1120d.test.ts).
  ["B0051USN3A", 2.74, "71TeJyhZ+0L", "HotHands Hand Warmers, 3 Pairs", "HotHands", "hand-warmer", 3, "Pocket hand warmers for cold mornings in the stand or on the boat."],
  ["B000WUIGYA", 2.97, "711hCdRB86L", "Nite Ize S-Biner Dual Carabiner, Size 2, Black", "Nite Ize", "carabiner", 3, "A stainless double-gate clip for keys or a belt loop."],
  ["B000WNED08", 3.26, "61XkrUHeBJL", "Rain-X Windshield Treatment, 3.5 oz Spray", "Rain-X", "car-care", 4.5, "Makes rain bead off his windshield."],
  ["B000050GET", 3.39, "616z-2GZeCL", "Bicycle Standard Playing Cards", "Bicycle", "game", 3, "A classic deck for card night or deer camp."],
  ["B004MMEHKQ", 3.68, "71G1Fkrj15L", "Nite Ize Original Gear Tie, 2-Pack", "Nite Ize", "gear-tie", 3, "Bendable rubber twist ties for cords, tools and truck gear."],
  ["B0BM5XZFWM", 3.79, "61pa4fWliRL", "CRAFTSMAN Keychain Tape Measure, 6 ft", "CRAFTSMAN", "accessory", 3, "A tiny tape measure that lives on his keyring."],
  ["B06XFQNM8J", 4.66, "61F6+mLDiYL", "HME 3-Color Camo Face Paint Stick", "HME", "hunting", 3, "A mess-free camo face paint stick for hunting."],
  ["B00EO96HAA", 4.81, "61qGzw5ywoL", "Berkley PowerBait Power Worms, 7 in., Tequila Sunrise", "Berkley", "fishing", 3, "A pack of classic soft plastic worms for bass fishing."],
  ["B003CTQ4U6", 4.97, "51aOoqbmkLL", "Strike King Redfish Magic Saltwater Spinnerbait", "Strike King", "fishing", 3, "A gold-blade spinnerbait made for redfish."],
];

/**
 * For Her (owner's second keeps ~11:55 AM, owner-keeps-1123b.json, the 19 Amazon ones), each re-read on its amazon.com
 * page 2026-11-23 12:02-12:03 PM CT. The OCOOPA link (B0FHHG23TP) is the Black hand warmers (its page's own color, and
 * its photo is black; the listing has no White), so the card says Black. The candle warmer names the Amber shade the
 * listing opens on. Her S1, S2, S4, S6, S9, S10 (Ulta) are HER_LINKS_1123_ROWS below; Her 21 (Capri Blue) is the last row.
 */
export const HER_KEEPS_1123_ROWS = [
  ["B079FV8PLK", 3.17, "71oHjVJxhUL", "Sally Hansen Insta-Dri Nail Polish, Just In Wine", "Sally Hansen", "nail-polish", 3, "A quick-dry polish in a deep holiday wine shade."],
  ["B00A8S6HM4", 3.98, "61WISQB7KNL", "Gold Bond Healing Hand Cream, 3 oz", "Gold Bond", "hand-care", 3, "A tube of hand cream that holds up to all-day handwashing."],
  ["B0CB23NZGT", 4.78, "51WgHWxdSAL", "e.l.f. Lip Exfoliator, Brown Sugar", "e.l.f.", "lip", 3, "A brown sugar lip scrub for soft winter lips."],
  ["B00EUBPHR6", 4.9, "71-gXRUepFL", "Real Techniques Miracle Complexion Sponge", "Real Techniques", "makeup", 3, "The makeup sponge beauty fans rebuy again and again."],
  ["B0B2WL4CSB", 6.97, "71uX7sknZYL", "Corissy Personalized Leather Travel Jewelry Box with Name and Birth Flower", "Corissy", "jewelry-box", 4, "A small leather jewelry case with her name and birth flower."],
  ["B0BX2TZZWG", 7.49, "61teCug7yHL", "Tree Hut Vanilla Shea Sugar Scrub, 18 oz", "Tree Hut", "body-scrub", 3, "A vanilla sugar body scrub."],
  ["B07L5QGF38", 8.49, "812oXq0wPPL", "Cleverfy Shower Steamers, 6-Pack", "Cleverfy", "shower-steamers", 3, "Six aromatherapy tablets that scent the shower."],
  ["B00GSH0KR2", 9.8, "61+-Ue8E4nL", "Kiehl's Lip Balm #1, 0.5 oz", "Kiehl's", "lip-balm", 10, "Kiehl's classic lip balm."],
  ["B01N9B27XA", 9.95, "71tfYZmjXkL", "Mont Bleu Crystal Glass Nail Files, Set of 3 in Pouch", "Mont Bleu", "nail-file", 3, "Three glass nail files in a gift pouch."],
  ["B010TCP3SC", 10.99, "6172rXS7RSL", "Dash Mini Waffle Maker, Red", "Dash", "kitchen-appliance", 4.5, "A 4-inch waffle maker for one."],
  ["B01M10G9WJ", 11.99, "71rP7u8aCJL", "Jade Leaf Matcha Traditional Starter Set", "Jade Leaf", "matcha-set", 4.5, "A bamboo matcha whisk, scoop, sifter and handbook."],
  ["B0DWMNVVQV", 14.99, "81w+ZTsSNrL", "Candle Warmer Lamp with Timer and Dimmer, Amber", "Funistree", "candle-warmer", 3, "A small lamp that melts a candle from the top, no flame."],
  ["1401971369", 17.05, "91ZVf3kNrcL", "The Let Them Theory by Mel Robbins (hardcover)", "Hay House", "book", 4.5, "Mel Robbins' book on letting go of what you can't control."],
  ["B01EXQ582Q", 18, "61Tti3h7s-L", "Sol de Janeiro Brazilian Bum Bum Cream, 2.5 oz", "Sol de Janeiro", "lotion", 10, "Sol de Janeiro's body cream in the travel jar."],
  ["B0GXGV6FRN", 19.99, "91BBhXvpvlL", "Carhartt Women's Rib Knit Beanie, Stone Brown", "Carhartt", "hat", 4, "A soft ribbed knit beanie."],
  ["B00023IT5S", 21.99, "51oiwmh2pIL", "Le Creuset Stoneware Mini Round Cocotte, 8 oz, Cerise", "Le Creuset", "cookware", 4.5, "A small red stoneware baking dish with a lid."],
  ["006282015X", 24.98, "81PxN0B7CmL", "Magnolia Table, Volume 1 (Joanna Gaines)", "Harper Horizon", "cookbook", 4.5, "Joanna Gaines' first Magnolia Table cookbook."],
  ["B0FHHG23TP", 24.99, "71UMvWt5y7L", "OCOOPA Dual-Sided Rechargeable Hand Warmers, 2-Pack, Black", "OCOOPA", "hand-warmer", 3, "Two rechargeable pocket hand warmers."],
  ["B092GM9NWH", 25, "616XeR9df9L", "We're Not Really Strangers Card Game", "We're Not Really Strangers", "game", 3, "A conversation card game for friends."],
  // Her 21 (lead 11-23 ~12:40 PM): the ShopMy link to capri-blue.com pays only 4%, and Amazon sells the same item (model
  // CB-553-VOL-R, the capri-blue.com SKU) at the same $23.00 for 4.5%, so the card links to Amazon. Re-read on amazon.com
  // 2026-11-23 12:44 PM CT: $23.00, In Stock, ships from Amazon, sold by CURiO Brands (Capri Blue's maker; "Visit the Capri
  // Blue Store"). Amazon's main photo (the boxed diffuser on white); the other gallery photos are scenes.
  ["B09X55PDB7", 23, "51q7YVnVwnL", "Capri Blue Volcano Car Diffuser + Refills", "Capri Blue", "car-fragrance", 4.5, "A clip-on car diffuser with Volcano scent reeds."],
];

/**
 * HELD-LINK KEEPS (links made in her ShopMy 11-23 12:18-12:34 PM, Desktop held-links-1123.json): the owner's keeps that
 * waited on a ShopMy link. Rows: [ShopMy pin, price, store photo (no query), name, brand, store, type, commission %, line].
 * Each price re-read on the store's own product page 2026-11-23 12:40 PM CT (Shopify product data for Maisonette, Burt's
 * Bees Baby and Lodge; the Ulta page's product data for Ulta). The Ulta prices are Ulta's Black Friday sale prices
 * (regularly: sheet mask $3.75, body wash $4.00, spot dots $4.99, Star Balm $6.99); the bath fizzer and claw clip are full
 * price. Photos: each store's own, cut out (LINKS_CUTOUTS_1123 below). Left out: the Blackstone Smash Burger Press (no
 * ShopMy partner, and Amazon does not sell that press, SKU 6154) and the Walmart Dearfoams slippers (held: Walmart
 * Creator sign-in).
 */
export const HER_LINKS_1123_ROWS = [
  ["109732072", 2.62, "https://media.ulta.com/i/ulta/2661162", "TONYMOLY I Am Sugar Plum Sheet Mask", "TONYMOLY", "store-ulta-beauty", "skincare", 13, "A holiday-edition Korean sheet mask for a cozy night in."],
  // ShopMy picked the Simply Nourish scent, the one the Ulta page opens on (sku 2635694).
  ["109732263", 2.8, "https://media.ulta.com/i/ulta/2635694", "method Mini Body Wash, Simply Nourish, 3.4 oz", "method", "store-ulta-beauty", "body-wash", 13, "A travel-size body wash that smells like coconut and shea butter."],
  ["109732413", 3.24, "https://media.ulta.com/i/ulta/2567110", "Peach Slices Acne Spot Dots", "Peach Slices", "store-ulta-beauty", "skincare", 13, "Clear pimple patches that work overnight."],
  ["109732687", 4.54, "https://media.ulta.com/i/ulta/2655694", "STARFACE Star Balm Lip Balm", "STARFACE", "store-ulta-beauty", "lip-balm", 13, "A cult-favorite scented lip balm in a fun tube."],
  ["109737953", 4.99, "https://media.ulta.com/i/ulta/2658859", "Sweet & Shimmer Coconut Swirl Candy Cane Bath Fizzer", "Sweet & Shimmer", "store-ulta-beauty", "bath-fizzer", 13, "A candy cane bath fizzer that smells like coconut."],
  // Ulta's own description calls it the "Bow Claw Clip" (its photo is a black bow), so the card says so.
  ["109738168", 4.99, "https://media.ulta.com/i/ulta/2658887", "Sweet & Shimmer Bow Claw Clip", "Sweet & Shimmer", "store-ulta-beauty", "hair", 13, "A black bow claw clip for a quick updo."],
];
export const HIM_LINKS_1123_ROWS = [
  // Her link opens lodgecastiron.com on the 10.25-inch size (variant 51685752439156, L8SK3, $24.90; list $29.95).
  ["109739556", 24.9, "https://cdn.shopify.com/s/files/1/0889/2707/6724/files/l8sk3_9b279cb3-889b-440f-8fff-6956291583ad.jpg", "Lodge 10.25 in. Classic Cast Iron Skillet", "Lodge", "store-lodge", "cookware", 12, "The classic cast iron skillet, ready to cook on day one."],
];
/**
 * WALMART KEEP (lead 11-23 ~2:20 PM: her Walmart Creator link made): the Dearfoams slippers held above. Rows: [Walmart
 * Creator link, price, Walmart photo (no query), name, brand, type, commission %, line]. Price and photo read on the
 * walmart.com product page (ip/19586459270) 2026-11-23 2:37 PM CT: $20.00, sold by Walmart.com, in stock, the page opens
 * on Brown. 14% is Walmart Creator's apparel rate (scripts/giftGuideSort.mjs walmartRate, "shoes"). Photo cut out
 * (Apple Vision), LINKS_CUTOUTS_1123 below.
 */
export const HIM_WALMART_1123_ROWS = [
  ["https://walmrt.us/4j41V4c", 20, "https://i5.walmartimages.com/seo/Dearfoams-Cozy-Comfort-Men-s-Cozy-Moccasin-Slippers_030d4a31-7d3f-4228-96e2-75cc069d1e59.b74fb5e53a19de44532aa81d0ee3ab60.jpeg", "Dearfoams Cozy Comfort Men's Cozy Moccasin Slippers, Brown", "Dearfoams", "shoes", 14, "Knit moccasin slippers with a soft lined collar for slow mornings."],
  // https://walmrt.us/4CoyfaY: walmart.com/ip/20119609720, $9.00, in stock (opens on Color:Black; Clothing Size:L), sold by Walmart.com.
  ["https://walmrt.us/4CoyfaY",9,"https://i5.walmartimages.com/seo/Hanes-Beefy-Mens-Hoodie-Pullover-Hooded-Sweatshirt-Heavyweight-Fleece-S-XL_895f839a-194f-4725-bbeb-8991c9738fbe.149d96ad32256f3b55d29dfb3c1ca2d0.jpeg","Hanes Men's Beefy Heavyweight Fleece Pullover Hoodie, Black","Hanes","sweatshirt",15,"A heavyweight fleece hoodie for cool mornings."],
  // https://walmrt.us/4iWWS6T: walmart.com/ip/20183207695, $9.00, in stock (opens on Color:Black; Clothing Size:L), sold by Walmart.com.
  ["https://walmrt.us/4iWWS6T",9,"https://i5.walmartimages.com/seo/Hanes-Beefy-Mens-Joggers-Fleece-Sweatpants-Heavyweight-Fleece-Drawcord-Waist-S-XL_3a4e4830-ffee-4226-a69f-b1633bcaf8b8.9b2a81927a6908f0386bbd07a5d40907.jpeg","Hanes Men's Beefy Heavyweight Fleece Joggers, Black","Hanes","pants",15,"Heavyweight fleece joggers with a drawcord waist."],
  // https://walmrt.us/4jl0CiB: walmart.com/ip/5460417912, $150.00, in stock (opens on Actual Color:28" Griddle), sold by Walmart.com.
  ["https://walmrt.us/4jl0CiB",150,"https://i5.walmartimages.com/seo/Blackstone-Original-Outdoor-Griddle-28-inch-2-Burner-Flat-Top-Grill-with-Hard-Cover-Black_bee2f3d9-8478-4651-88fa-09cce965ea92.44780d1d232d9dcd6a4839e722a71191.jpeg","Blackstone Original 28 in. 2-Burner Outdoor Griddle with Hard Cover","Blackstone","grilling",7,"A 28-inch flat-top griddle for smash burgers and breakfast outside."],
  // https://walmrt.us/4eV9TLM: walmart.com/ip/17768001716, $169.00, in stock (opens on Actual Color:Silver), sold by Walmart.com.
  ["https://walmrt.us/4eV9TLM",169,"https://i5.walmartimages.com/seo/Ninja-SLUSHi-96-Oz-Frozen-Drink-Machine-with-RapidChill-Technology-5-Presets-Dishwasher-Safe-Slushy-Maker-FS310-Silver_1e2984c3-e65e-4f98-9af4-98529c9ff0b8.717b0dd2aab72370cbd5971207634bc7.jpeg","Ninja SLUSHi 96 oz. Frozen Drink Machine, Silver","Ninja","slushie-maker",9,"Makes slushies and frozen drinks with no ice needed."],
  // https://walmrt.us/4ksXu5n: walmart.com/ip/14270212928, $329.00, in stock (opens on Size:Adventurer 5X), sold by Flashforge 3D Printer.
  ["https://walmrt.us/4ksXu5n",329,"https://i5.walmartimages.com/seo/Flashforge-AD5X-3D-Printer-Multi-Color-Printer-600mm-s-High-Speed-1Count-8-7-x-8-7-x-8-7_b5a19d11-a368-4d73-bf11-dfa3fdbc6710.0a7af472afd512f12bbf35789748e6f5.jpeg","Flashforge AD5X Multi-Color 3D Printer","Flashforge","3d-printer",7,"A fast multi-color 3D printer for making parts and gadgets at home."],
];
/**
 * WALMART "CLAUDE" COLLECTION (lead 11-23 ~2:50 PM): the gifts the owner put in her own hidden Walmart Creator collection
 * "Claude" (Desktop Walmart-claude-list-1123.json, 27 links; her walmrt.us links; commission = the collection card's
 * elevated Black Friday rate). They are OWNER PICKS: never removed by a sweep, and exempt from the $100 cap and the
 * Walmart store-brand rule (the Better Homes & Gardens holder). Each re-read on its walmart.com/ip page 2026-11-23
 * 2:50-3:00 PM CT (the page's own product data: price, stock of the variant it opens on, photo, seller), noted on its row.
 * Skipped as unavailable: Monster Jam pajama set (out of stock), Fuggler Bigg Fuggs (the page is gone, 404) and the
 * Better Homes & Gardens marble coasters (out of stock). The Ninja SLUSHi is on Her and Him (her placement).
 */
export const HER_WALMART_1123_ROWS = [
  // https://walmrt.us/48Ibtx1: walmart.com/ip/18494606801, $9.43, in stock, sold by Walmart.com.
  ["https://walmrt.us/48Ibtx1",9.43,"https://i5.walmartimages.com/seo/Better-Homes-Gardens-Countertop-Paper-Towel-Holder-Wood-Marble_4752c860-d430-4e1c-a9a9-9f93d6c143a1.b44486d26f9cae608ee7c120df6a66f6.jpeg","Better Homes & Gardens Wood and Marble Paper Towel Holder","Better Homes & Gardens","kitchen-decor",9,"A marble-base paper towel holder with a wood rod."],
  // https://walmrt.us/4j8bXmh: walmart.com/ip/18888755406, $16.47, in stock, sold by Walmart.com.
  ["https://walmrt.us/4j8bXmh",16.47,"https://i5.walmartimages.com/seo/The-Pioneer-Woman-Agetha-6-Piece-Acacia-Wood-Bamboo-Melamine-Crock-Set-Brown_427519e3-1fd0-44a9-b805-fa914a5bdfb5.06a67b3b0329e7cb490e0adb7d77bf92.jpeg","The Pioneer Woman Agetha 6-Piece Acacia Wood Utensil Crock Set","The Pioneer Woman","kitchen-utensils",9,"Acacia wood spoons in a floral crock for the counter."],
  // https://walmrt.us/3VcyVzm: walmart.com/ip/21410773712, $19.99, in stock (opens on Actual Color:Beige Black), sold by guanshanliu.
  ["https://walmrt.us/3VcyVzm",19.99,"https://i5.walmartimages.com/seo/Striped-Woven-Clutch-Makeup-Bag-for-Women-Elegant-Stylish-Large-Capacity-Everything-Dumpling-Pouch-for-Everyday_2ae6b1c4-1329-4aa7-a916-c74e034046b2.ba025667771e8c41320d8eb22d624d33.jpeg","Striped Woven Clutch Makeup Bag, Beige and Black","Ryhmsj","makeup-bag",9,"A big striped woven pouch for makeup or everyday things."],
  // https://walmrt.us/48C9Oco: walmart.com/ip/17148110592, $27.99, in stock (opens on Color:A-Beige; Clothing Size:M), sold by UVN.
  ["https://walmrt.us/48C9Oco",27.99,"https://i5.walmartimages.com/seo/UVN-Winter-Pajama-for-Women-Sweater-Set-Ladies-V-neck-Tops-and-Long-Pants-Warm-2-Piece-Loungewear_f467c897-8815-43b9-8527-4d7c7877eecb.b5ba424f870ccca0e9a16104d26c9569.png","UVN V-Neck Sweater Knit Lounge Set, Beige","UVN","lounge-set",15,"A soft sweater-knit V-neck top and pants set for lounging."],
  // https://walmrt.us/4iZjpzV: walmart.com/ip/11629001633, $28.99, in stock (opens on Actual Color:Parchment; Clothing Size:L), sold by SHEWIN.
  ["https://walmrt.us/4iZjpzV",28.99,"https://i5.walmartimages.com/seo/SHEWIN-Women-s-Puffer-Jacket-Button-Down-Quilted-Coat-Casual-Winter-Lightweight-Outwear-with-Pockets_b257334e-ebf1-4107-a76c-267f25a4a020.87b594931e4a0cc58f74475f3ad6b129.jpeg","SHEWIN Quilted Button-Down Puffer Jacket, Parchment","SHEWIN","jacket",15,"A light quilted jacket with buttons and pockets."],
  // https://walmrt.us/4A97K7U: walmart.com/ip/16229053784, $29.97, in stock (opens on Actual Color:Brown), sold by Walmart.com.
  ["https://walmrt.us/4A97K7U",29.97,"https://i5.walmartimages.com/seo/The-Pioneer-Woman-Agatha-2-0-Quart-Whistling-Tea-Kettle-Enamel-on-Steel-Brown_a36a204a-0be5-4e88-9096-1084283d4eec.dc879795c7fad34e232f6b5a88bd0a9f.jpeg","The Pioneer Woman Agatha 2-Quart Whistling Tea Kettle, Brown","The Pioneer Woman","tea-kettle",9,"A floral enamel kettle that whistles when it boils."],
  // https://walmrt.us/4A3Me4a: walmart.com/ip/18979202854, $54.69, in stock, sold by Walmart.com.
  ["https://walmrt.us/4A3Me4a",54.69,"https://i5.walmartimages.com/seo/The-Pioneer-Woman-Agatha-11-Piece-Knife-Block-Set-Stainless-Steel-Brown_874bd320-32f1-4b82-bc6a-423ff541e441.fbe0ac6004e605570e35737f53d58c2b.jpeg","The Pioneer Woman Agatha 11-Piece Knife Block Set","The Pioneer Woman","kitchen-knives",9,"Stainless knives in a floral block."],
  // https://walmrt.us/4fRxJID: walmart.com/ip/20142303692, $97.00, in stock (opens on Actual Color:Cream), sold by Walmart.com.
  ["https://walmrt.us/4fRxJID",97,"https://i5.walmartimages.com/seo/The-Pioneer-Woman-Vintage-Speckle-Cream-40-Piece-Nonstick-Cookware-Bakeware-Set_780d949e-d3dc-4b04-b1db-72e3ea489959.9801015821dd707fb6794c85b721363e.jpeg","The Pioneer Woman 40-Piece Nonstick Cookware and Bakeware Set, Vintage Speckle Cream","The Pioneer Woman","cookware",9,"Pots, pans and bakeware in a cream speckle finish."],
  // https://walmrt.us/4tjYU4D: walmart.com/ip/14427170541, $119.87, in stock (opens on Actual Color:Blue Agatha), sold by Walmart.com.
  ["https://walmrt.us/4tjYU4D",119.87,"https://i5.walmartimages.com/seo/The-Pioneer-Woman-12-Piece-Classic-Aluminum-Cookware-Set-Ceramic-Nonstick-Pots-and-Pans-Set-with-Decal-Pattern-Agatha-Blue_1ee63a5d-4fa5-4891-bd3e-671f1b539481.bbf14086b10836e93fe277fd051cc047.jpeg","The Pioneer Woman Classic 12-Piece Ceramic Nonstick Cookware Set, Blue Agatha","The Pioneer Woman","cookware",9,"Ceramic nonstick pots and pans with a blue floral pattern."],
  // https://walmrt.us/4eV9TLM: walmart.com/ip/17768001716, $169.00, in stock (opens on Actual Color:Silver), sold by Walmart.com.
  ["https://walmrt.us/4eV9TLM",169,"https://i5.walmartimages.com/seo/Ninja-SLUSHi-96-Oz-Frozen-Drink-Machine-with-RapidChill-Technology-5-Presets-Dishwasher-Safe-Slushy-Maker-FS310-Silver_1e2984c3-e65e-4f98-9af4-98529c9ff0b8.717b0dd2aab72370cbd5971207634bc7.jpeg","Ninja SLUSHi 96 oz. Frozen Drink Machine, Silver","Ninja","slushie-maker",9,"Makes slushies and frozen drinks with no ice needed."],
  // https://walmrt.us/4eNd740: walmart.com/ip/5760503332, $178.00, in stock (opens on Actual Color:Homestead Brown), sold by Walmart.com.
  ["https://walmrt.us/4eNd740",178,"https://i5.walmartimages.com/seo/Pioneer-Woman-Harper-Counter-Height-Wood-Stools-2-Pack-Homestead-Brown_59c30299-4863-4fde-9427-e72af5687380.27e743df235acdd048219d396dc232d1.jpeg","The Pioneer Woman Harper Counter-Height Wood Stools, 2-Pack, Homestead Brown","The Pioneer Woman","furniture",9,"A pair of farmhouse wood counter stools."],
  // https://walmrt.us/4zZkihX: walmart.com/ip/19883465673, $179.00, in stock (opens on Actual Color:Charcoal Grey), sold by Walmart.com.
  ["https://walmrt.us/4zZkihX",179,"https://i5.walmartimages.com/seo/GE-Profile-Opal-Mini-Nugget-Countertop-Ice-Maker-with-Descaler-36lb-Daily-Capacity-with-WIFI-Charcoal-Gray_d654d424-b612-4ab4-9b40-dd4601a73c1f.afe665b60cd90b79522d9dd708ee901a.jpeg","GE Profile Opal Mini Nugget Ice Maker, Charcoal Gray","GE Profile","ice-maker",9,"A countertop maker of soft, chewable nugget ice."],
  // https://walmrt.us/4A9fV3W: walmart.com/ip/6256217788, $484.00, in stock, sold by Walmart.com.
  ["https://walmrt.us/4A9fV3W",484,"https://i5.walmartimages.com/seo/Pioneer-Woman-Harper-Kitchen-Island-with-Drawers-Homestead-Brown_b98a3317-9ee7-457d-9344-9bc627249e29.99bb04aa95a8033eefb7c30a799ee9ec.jpeg","The Pioneer Woman Harper Kitchen Island with Drawers, Homestead Brown","The Pioneer Woman","furniture",9,"A farmhouse kitchen island with drawers and shelves."],
];
export const KIDS_WALMART_1123_ROWS = [
  // https://walmrt.us/3XJ8SAw: walmart.com/ip/1737384545, $28.98, in stock, sold by Warmies.
  ["https://walmrt.us/3XJ8SAw",28.98,"https://i5.walmartimages.com/seo/Axolotl-Warmies-Cozy-Plush-Heatable-Lavender-Scented-Stuffed-Animal_e9ef018a-9408-423c-beac-3f62532082ce.694362d25311e5e9a81e94274d62c3b1.jpeg","Warmies Axolotl Heatable Lavender-Scented Plush","Warmies","plush",6,"A microwavable axolotl plush that smells like lavender."],
  // https://walmrt.us/4zHTXnA: walmart.com/ip/19494063374, $69.00, in stock, sold by Walmart.com.
  ["https://walmrt.us/4zHTXnA",69,"https://i5.walmartimages.com/seo/6V-FROZEN-WIGGLE-CAR_30aea4dd-828f-4eca-bbd1-0f37b77f26df.428a7baf7339bb0629fc66b728b53de1.jpeg","Kid Trax Disney Frozen 6V Wiggle Car Ride-On, Blue","Kid Trax","ride-on",6,"A light-up Frozen wiggle car kids ride and steer."],
  // https://walmrt.us/3VOWIFL: walmart.com/ip/19605318506, $69.00, in stock, sold by Walmart.com.
  ["https://walmrt.us/3VOWIFL",69,"https://i5.walmartimages.com/seo/Kid-Trax-Marvel-Spidey-6V-Wiggle-Car-Ride-On-Toy-Ages-3-8-Red_9afb1b73-6bdd-468b-a240-4c5ddb4e2b52.8691c98792dd492914ffee440feb6809.jpeg","Kid Trax Marvel Spidey 6V Wiggle Car Ride-On, Red","Kid Trax","ride-on",6,"A light-up Spidey wiggle car kids ride and steer."],
  // https://walmrt.us/4A2ZBBB: walmart.com/ip/646369283, $89.00, in stock (opens on Actual Color:Green), sold by Walmart.com.
  ["https://walmrt.us/4A2ZBBB",89,"https://i5.walmartimages.com/seo/Razor-Black-Label-E90-Electric-Scooter-Green-for-Child-Ages-8-and-up-to-120-lbs-up-to-10-mph_9cf1f543-2dce-4726-9aa3-d018eb059a1b.9fab5ab88eb88544bc6b94a828476109.png","Razor Black Label E90 Electric Scooter, Green","Razor","scooter",6,"An electric scooter for ages 8 and up, up to 10 mph."],
  // https://walmrt.us/4krstyF: walmart.com/ip/980979848, $104.99, in stock (opens on Actual Color:White), sold by Madame Alexander Doll Company.
  ["https://walmrt.us/4krstyF",104.99,"https://i5.walmartimages.com/seo/Madame-Alexander-19-inch-Newborn-Nursery-Baby-Doll-Little-Sweetheart-Light-Skin-Tone-Blue-Eyes-Blonde-Hair_c7caf6db-e3af-48f5-a9e4-b0b5abe359ee.c918721070cab2e8e15c38236bb6c684.jpeg","Madame Alexander 19 in. Newborn Nursery Baby Doll, Little Sweetheart","Madame Alexander","doll",6,"A lifelike 19-inch newborn baby doll."],
  // https://walmrt.us/4AOi7xC: walmart.com/ip/17561822223, $104.99, in stock (opens on Actual Color:Blue), sold by Newdood.
  ["https://walmrt.us/4AOi7xC",104.99,"https://i5.walmartimages.com/seo/Xuanlur-12V-Power-Ride-on-Toys-for-Toddlers-Licensed-Ford-GT-Ride-on-Cars-for-Kids-Kid-Electric-Car-Aged-1-5Y-3-Speed-Blue_2e6e2e91-8662-44ef-b1d2-2b777215bc2b.10d93d69f9a4bee7c04e6550b0970992.png","Xuanlur 12V Licensed Ford GT Ride-On Car, Blue","Xuanlur","ride-on",6,"A 12-volt licensed Ford GT ride-on with three speeds."],
  // https://walmrt.us/4kxFTcw: walmart.com/ip/19382812773, $116.87, in stock, sold by Madame Alexander Doll Company.
  ["https://walmrt.us/4kxFTcw",116.87,"https://i5.walmartimages.com/seo/Madame-Alexander-8-inch-Library-Chic-Collectible-Doll_e68deef8-9287-451e-a277-db4711e8ebf3.bf7124a0c5fb8ba18a5b626462a602a5.jpeg","Madame Alexander 8 in. Library Chic Collectible Doll","Madame Alexander","doll",6,"A small collectible doll in a library-day outfit."],
  // https://walmrt.us/4tASiPv: walmart.com/ip/2271352006, $148.00, in stock, sold by Walmart.com.
  ["https://walmrt.us/4tASiPv",148,"https://i5.walmartimages.com/seo/Marvel-Spider-Man-Plastic-Indoor-Outdoor-Playhouse-with-Easy-Assembly-by-Delta-Children-Blue-Red_3653e596-6a76-423a-954c-f83bc4bead56.5d34141de67f13ec0af1ba688d3a9034.jpeg","Delta Children Marvel Spider-Man Indoor/Outdoor Playhouse","Delta Children","playhouse",6,"A Spider-Man playhouse for the playroom or the backyard."],
];
export const KIDS_LINKS_1123_ROWS = [
  ["109730393", 9.95, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/CThEQGkzRX6kMttAU-PieEPx0_7c08fc80-0e1f-4686-b73a-8434b4de75b3.jpg", "OOLY Hair Doodlers Hair Crayons, Set of 6", "OOLY", "store-maisonette", "hair-crayons", 16, "Six washable hair crayons in bright colors."],
  ["109730847", 16.15, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/sdKQAgU9XS8pVG8iU6Kx22JCM.jpg", "Floss & Rock Construction Memory Match", "Floss & Rock", "store-maisonette", "game", 16, "18 pairs of picture cards with trucks and diggers."],
  ["109730984", 18.99, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/Zu6ntd--O4jMfhwuJN6eJDzdw.jpg", "Tender Leaf Toys Safari Binoculars", "Tender Leaf Toys", "store-maisonette", "binoculars", 16, "Wooden binoculars with kaleidoscope lenses."],
  ["109731305", 22.5, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/2G8yemdd5Rlijzpq1apzVaMhg.jpg", "Sweet Wink Pink Confetti Cape", "Sweet Wink", "store-maisonette", "dress", 16, "A sparkly pink dress-up cape."],
  ["109731598", 23.99, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/0seL9w_79n2bkf7Ko6DqIpgO0_1b6ddf56-898a-433e-a488-98025927d544.jpg", "Brainstorm Toys Shark Torch & Projector", "Brainstorm Toys", "store-maisonette", "projector-flashlight", 16, "A flashlight that projects 24 shark pictures."],
  // $10.78 is the youth sizes' sale price (6Y-12Y; list $26.95); the 12M-5T sizes are $8.78 but were all sold out at the
  // re-read, as were 6Y and 10Y (8Y and 12Y in stock).
  ["109731941", 10.78, "https://cdn.shopify.com/s/files/1/0893/7439/2690/files/LY33506-nostalgic-christmas-organic-cotton-two-piece-pajamas-front.jpg", "Burt's Bees Baby Nostalgic Christmas Two-Piece Pajamas", "Burt's Bees Baby", "store-burts-bees-baby", "pajamas", 12, "Organic cotton Christmas pajamas in kids' sizes."],
];
/**
 * Their cutouts (merged into scripts/giftGuideCutouts1120.mjs CUTOUTS_1120): Apple Vision (scripts/gift-guide-cutout.swift)
 * for the store photos; the OOLY box by a white flood fill instead (Vision dropped its clear window); the Ulta photos
 * are already transparent, so each is its own alpha, cropped. Checked on red 11-23.
 */
export const LINKS_CUTOUTS_1123 = [
  ["https://media.ulta.com/i/ulta/2661162", "tonymoly-sugar-plum-sheet-mask-be6d57.webp"],
  ["https://media.ulta.com/i/ulta/2635694", "method-mini-body-wash-simply-nourish-3634b9.webp"],
  ["https://media.ulta.com/i/ulta/2567110", "peach-slices-acne-spot-dots-cb0ce7.webp"],
  ["https://media.ulta.com/i/ulta/2655694", "starface-star-balm-lip-balm-f95d62.webp"],
  ["https://media.ulta.com/i/ulta/2658859", "sweet-shimmer-candy-cane-bath-fizzer-26713b.webp"],
  ["https://media.ulta.com/i/ulta/2658887", "sweet-shimmer-bow-claw-clip-3ebe1f.webp"],
  ["https://cdn.shopify.com/s/files/1/0889/2707/6724/files/l8sk3_9b279cb3-889b-440f-8fff-6956291583ad.jpg", "lodge-classic-skillet-10-25-in-ca4f91.webp"],
  ["https://i5.walmartimages.com/seo/Dearfoams-Cozy-Comfort-Men-s-Cozy-Moccasin-Slippers_030d4a31-7d3f-4228-96e2-75cc069d1e59.b74fb5e53a19de44532aa81d0ee3ab60.jpeg", "dearfoams-cozy-comfort-mens-moccasin-slippers-90e6c7.webp"],
  ["https://i5.walmartimages.com/seo/Hanes-Beefy-Mens-Hoodie-Pullover-Hooded-Sweatshirt-Heavyweight-Fleece-S-XL_895f839a-194f-4725-bbeb-8991c9738fbe.149d96ad32256f3b55d29dfb3c1ca2d0.jpeg","hanes-beefy-fleece-hoodie-black-bd9698.webp"],
  ["https://i5.walmartimages.com/seo/Hanes-Beefy-Mens-Joggers-Fleece-Sweatpants-Heavyweight-Fleece-Drawcord-Waist-S-XL_3a4e4830-ffee-4226-a69f-b1633bcaf8b8.9b2a81927a6908f0386bbd07a5d40907.jpeg","hanes-beefy-fleece-joggers-black-b36ee2.webp"],
  ["https://i5.walmartimages.com/seo/UVN-Winter-Pajama-for-Women-Sweater-Set-Ladies-V-neck-Tops-and-Long-Pants-Warm-2-Piece-Loungewear_f467c897-8815-43b9-8527-4d7c7877eecb.b5ba424f870ccca0e9a16104d26c9569.png","uvn-v-neck-sweater-lounge-set-beige-22c400.webp"],
  ["https://i5.walmartimages.com/seo/SHEWIN-Women-s-Puffer-Jacket-Button-Down-Quilted-Coat-Casual-Winter-Lightweight-Outwear-with-Pockets_b257334e-ebf1-4107-a76c-267f25a4a020.87b594931e4a0cc58f74475f3ad6b129.jpeg","shewin-quilted-puffer-jacket-parchment-d257a7.webp"],
  ["https://i5.walmartimages.com/seo/Madame-Alexander-19-inch-Newborn-Nursery-Baby-Doll-Little-Sweetheart-Light-Skin-Tone-Blue-Eyes-Blonde-Hair_c7caf6db-e3af-48f5-a9e4-b0b5abe359ee.c918721070cab2e8e15c38236bb6c684.jpeg","madame-alexander-19-in-newborn-doll-a28a05.webp"],
  ["https://i5.walmartimages.com/seo/Madame-Alexander-8-inch-Library-Chic-Collectible-Doll_e68deef8-9287-451e-a277-db4711e8ebf3.bf7124a0c5fb8ba18a5b626462a602a5.jpeg","madame-alexander-8-in-library-chic-doll-833cdf.webp"],
  ["https://i5.walmartimages.com/seo/6V-FROZEN-WIGGLE-CAR_30aea4dd-828f-4eca-bbd1-0f37b77f26df.428a7baf7339bb0629fc66b728b53de1.jpeg","kid-trax-frozen-wiggle-car-0bddb6.webp"],
  ["https://i5.walmartimages.com/seo/Kid-Trax-Marvel-Spidey-6V-Wiggle-Car-Ride-On-Toy-Ages-3-8-Red_9afb1b73-6bdd-468b-a240-4c5ddb4e2b52.8691c98792dd492914ffee440feb6809.jpeg","kid-trax-spidey-wiggle-car-bc801c.webp"],
  ["https://i5.walmartimages.com/seo/Axolotl-Warmies-Cozy-Plush-Heatable-Lavender-Scented-Stuffed-Animal_e9ef018a-9408-423c-beac-3f62532082ce.694362d25311e5e9a81e94274d62c3b1.jpeg","warmies-axolotl-plush-7ab3eb.webp"],
  ["https://i5.walmartimages.com/seo/Xuanlur-12V-Power-Ride-on-Toys-for-Toddlers-Licensed-Ford-GT-Ride-on-Cars-for-Kids-Kid-Electric-Car-Aged-1-5Y-3-Speed-Blue_2e6e2e91-8662-44ef-b1d2-2b777215bc2b.10d93d69f9a4bee7c04e6550b0970992.png","xuanlur-12v-ford-gt-ride-on-c36955.webp"],
  ["https://i5.walmartimages.com/seo/Razor-Black-Label-E90-Electric-Scooter-Green-for-Child-Ages-8-and-up-to-120-lbs-up-to-10-mph_9cf1f543-2dce-4726-9aa3-d018eb059a1b.9fab5ab88eb88544bc6b94a828476109.png","razor-e90-electric-scooter-green-3b1256.webp"],
  ["https://i5.walmartimages.com/seo/GE-Profile-Opal-Mini-Nugget-Countertop-Ice-Maker-with-Descaler-36lb-Daily-Capacity-with-WIFI-Charcoal-Gray_d654d424-b612-4ab4-9b40-dd4601a73c1f.afe665b60cd90b79522d9dd708ee901a.jpeg","ge-profile-opal-mini-ice-maker-walmart-ef2a74.webp"],
  ["https://i5.walmartimages.com/seo/Ninja-SLUSHi-96-Oz-Frozen-Drink-Machine-with-RapidChill-Technology-5-Presets-Dishwasher-Safe-Slushy-Maker-FS310-Silver_1e2984c3-e65e-4f98-9af4-98529c9ff0b8.717b0dd2aab72370cbd5971207634bc7.jpeg","ninja-slushi-frozen-drink-machine-19b527.webp"],
  ["https://i5.walmartimages.com/seo/Blackstone-Original-Outdoor-Griddle-28-inch-2-Burner-Flat-Top-Grill-with-Hard-Cover-Black_bee2f3d9-8478-4651-88fa-09cce965ea92.44780d1d232d9dcd6a4839e722a71191.jpeg","blackstone-28-in-griddle-hard-cover-999304.webp"],
  ["https://i5.walmartimages.com/seo/Flashforge-AD5X-3D-Printer-Multi-Color-Printer-600mm-s-High-Speed-1Count-8-7-x-8-7-x-8-7_b5a19d11-a368-4d73-bf11-dfa3fdbc6710.0a7af472afd512f12bbf35789748e6f5.jpeg","flashforge-ad5x-3d-printer-65ef75.webp"],
  ["https://i5.walmartimages.com/seo/Striped-Woven-Clutch-Makeup-Bag-for-Women-Elegant-Stylish-Large-Capacity-Everything-Dumpling-Pouch-for-Everyday_2ae6b1c4-1329-4aa7-a916-c74e034046b2.ba025667771e8c41320d8eb22d624d33.jpeg","striped-woven-clutch-makeup-bag-53fea1.webp"],
  ["https://i5.walmartimages.com/seo/The-Pioneer-Woman-Agetha-6-Piece-Acacia-Wood-Bamboo-Melamine-Crock-Set-Brown_427519e3-1fd0-44a9-b805-fa914a5bdfb5.06a67b3b0329e7cb490e0adb7d77bf92.jpeg","pioneer-woman-agetha-crock-set-60d013.webp"],
  ["https://i5.walmartimages.com/seo/The-Pioneer-Woman-Vintage-Speckle-Cream-40-Piece-Nonstick-Cookware-Bakeware-Set_780d949e-d3dc-4b04-b1db-72e3ea489959.9801015821dd707fb6794c85b721363e.jpeg","pioneer-woman-40-pc-cookware-bakeware-25e6b4.webp"],
  ["https://i5.walmartimages.com/seo/Pioneer-Woman-Harper-Counter-Height-Wood-Stools-2-Pack-Homestead-Brown_59c30299-4863-4fde-9427-e72af5687380.27e743df235acdd048219d396dc232d1.jpeg","pioneer-woman-harper-counter-stools-52fa8a.webp"],
  ["https://i5.walmartimages.com/seo/The-Pioneer-Woman-Agatha-11-Piece-Knife-Block-Set-Stainless-Steel-Brown_874bd320-32f1-4b82-bc6a-423ff541e441.fbe0ac6004e605570e35737f53d58c2b.jpeg","pioneer-woman-agatha-knife-block-9f79b6.webp"],
  ["https://i5.walmartimages.com/seo/Pioneer-Woman-Harper-Kitchen-Island-with-Drawers-Homestead-Brown_b98a3317-9ee7-457d-9344-9bc627249e29.99bb04aa95a8033eefb7c30a799ee9ec.jpeg","pioneer-woman-harper-kitchen-island-660766.webp"],
  ["https://i5.walmartimages.com/seo/The-Pioneer-Woman-Agatha-2-0-Quart-Whistling-Tea-Kettle-Enamel-on-Steel-Brown_a36a204a-0be5-4e88-9096-1084283d4eec.dc879795c7fad34e232f6b5a88bd0a9f.jpeg","pioneer-woman-agatha-tea-kettle-343e31.webp"],
  ["https://i5.walmartimages.com/seo/The-Pioneer-Woman-12-Piece-Classic-Aluminum-Cookware-Set-Ceramic-Nonstick-Pots-and-Pans-Set-with-Decal-Pattern-Agatha-Blue_1ee63a5d-4fa5-4891-bd3e-671f1b539481.bbf14086b10836e93fe277fd051cc047.jpeg","pioneer-woman-blue-agatha-cookware-11ac39.webp"],
  ["https://i5.walmartimages.com/seo/Better-Homes-Gardens-Countertop-Paper-Towel-Holder-Wood-Marble_4752c860-d430-4e1c-a9a9-9f93d6c143a1.b44486d26f9cae608ee7c120df6a66f6.jpeg","bhg-wood-marble-paper-towel-holder-1d1825.webp"],
  ["https://i5.walmartimages.com/seo/Marvel-Spider-Man-Plastic-Indoor-Outdoor-Playhouse-with-Easy-Assembly-by-Delta-Children-Blue-Red_3653e596-6a76-423a-954c-f83bc4bead56.5d34141de67f13ec0af1ba688d3a9034.jpeg","delta-spider-man-playhouse-0576bf.webp"],
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/CThEQGkzRX6kMttAU-PieEPx0_7c08fc80-0e1f-4686-b73a-8434b4de75b3.jpg", "ooly-hair-doodlers-hair-crayons-f570a3.webp"],
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/sdKQAgU9XS8pVG8iU6Kx22JCM.jpg", "floss-rock-construction-memory-match-29acea.webp"],
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/Zu6ntd--O4jMfhwuJN6eJDzdw.jpg", "tender-leaf-safari-binoculars-b6e1f3.webp"],
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/2G8yemdd5Rlijzpq1apzVaMhg.jpg", "sweet-wink-pink-confetti-cape-09e68a.webp"],
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/0seL9w_79n2bkf7Ko6DqIpgO0_1b6ddf56-898a-433e-a488-98025927d544.jpg", "brainstorm-shark-torch-projector-dfd233.webp"],
  ["https://cdn.shopify.com/s/files/1/0893/7439/2690/files/LY33506-nostalgic-christmas-organic-cotton-two-piece-pajamas-front.jpg", "burts-bees-baby-nostalgic-christmas-pajamas-5ad7e3.webp"],
];

/** For Kids (owner 11-23 keeps, Amazon). */
export const KIDS_KEEPS_1123_ROWS = [
  ["B0DSCL9N58", 5.99, "71obU9HhHSL", "Ms. Rachel Talk With Me Phone", "Ms. Rachel", "pretend-play", 3, "A pretend phone that says Ms. Rachel phrases."],
  ["B083XNCRS3", 9.56, "91tKWhd87gL", "Bluey Family Figure 4-Pack", "Bluey", "figures", 3, "Bluey, Bingo, Bandit and Chilli figures."],
  ["B0CBT2N7N1", 10.49, "812kGA-waGL", "UNO Show 'em No Mercy Card Game in Tin", "Mattel Games", "game", 3, "The tougher UNO, in a tin."],
  ["B083QZLSXS", 10.88, "81ikyJypjOL", "NERF Elite 2.0 Commander RD-6 Blaster", "Nerf", "blaster", 3, "A 6-dart blaster with 12 darts."],
  ["B078WM314M", 11.97, "71mW+l88i6L", "Spike the Fine Motor Hedgehog", "Learning Resources", "learning", 3, "A hedgehog toddlers fill with colorful quills."],
  ["B0831R88S6", 12.0, "41dn58Mb-7L", "Crocs Jibbitz Rainbow 5-Pack Shoe Charms", "Crocs", "shoe-charms", 4, "Five rainbow charms for their Crocs."],
  ["B0HHL1768V", 14.99, "91cFkY8R89L", "Crazy Aaron's Thinking Putty, Glam Jam", "Crazy Aaron's", "putty", 3, "A 4-inch tin of color-shifting putty."],
  ["B0CSYGLWN5", 14.99, "61tnRc8GrcL", "Rubik's Cube 3x3 Magnetic Speed Cube", "Rubik's", "puzzle", 3, "A smooth magnetic cube for speed solving."],
  ["B0G441FJ3G", 15.11, "81vCfy7vRrL", "Polly Pocket Dream Treat Unicorn Compact", "Polly Pocket", "playset", 3, "A pocket-size playset with a micro doll and unicorn."],
  ["B0B4YWYGXG", 16.89, "91UM01ezWUL", "Kinetic Sand Squish N' Create Set", "Kinetic Sand", "sensory-sand", 3, "Three colors of moldable sand with tools."],
  ["B082PZND3V", 16.99, "61cDukVva-L", "Boon Pipes Bath Toy Set", "Boon", "bath-toy", 3, "Suction pipes toddlers build on the tub wall."],
  ["B07ZYCKR15", 17.99, "81WAG75PXaL", "Play-Doh Kitchen Creations Noodle Party", "Play-Doh", "toy", 3, "A noodle-making playset with 5 colors."],
  ["B001Q3KU9Q", 17.99, "812M67CRroL", "Green Toys Dump Truck, Yellow and Red", "Green Toys", "vehicle-toy", 3, "A sturdy recycled-plastic dump truck."],
  ["B0BRTCTT6X", 19.94, "615lD7nKQtL", "Shakespeare Spider-Man Kids Fishing Kit", "Shakespeare", "fishing", 3, "A kid-size rod and reel combo with Spider-Man."],
  ["B0CRC73JTS", 20.0, "61v2Gh-QzrL", "Owala FreeSip Kids Water Bottle, 16 oz", "Owala", "water-bottle", 4.5, "A leakproof kids' FreeSip bottle, Celestial Sphere."],
  ["B0CSP7M219", 21.78, "812p4BFpjmL", "Hatchimals Alive Rainbow Hatchery", "Hatchimals", "hatching-toy", 3, "Six surprise eggs that hatch in water."],
];
