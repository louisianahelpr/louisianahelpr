/**
 * OWNER ADDS 11-22 (launch day): picks the owner sent as her own ShopMy links, added to For Her / For Kids / For Him on
 * top of her 11-21 saves. Each pin was read from her ShopMy dashboard (shopmy.us/links; the go.shopmy.us short link is
 * never opened, it would count a click) and priced on the store's own product page 2026-11-22. Desktop note:
 * "Gift guides and affiliate/Owner-adds-1122.md". They are her picks, so the brand and type caps do not apply.
 *
 * Owner answers via the lead, 11-22:
 * - Camp Snap: she pinned the CS-Pro (Her) and two Camp Snap 2 colors (Kids) at The Swank Company (15%, full price
 *   $99 / $69.99). She chose Camp Snap direct instead (campsnapphoto.com's Black Friday prices $79 / $59.99, 10%) with her
 *   code LEXILOMBAS7 shown, so those rows use her existing Camp Snap pins: CS-Pro p-107929179, Camp Snap 2 p-107929152
 *   and p-104219842 (the Camp Snap 2 page, where the shopper picks the color).
 * - Sleep Crown Classic: sold out in every color until the next drop (Tue Dec 1, 9 AM Central, no pre-sale or
 *   waitlist). She said add it now at $289 with a short "Back Dec 1" note (`backOn`; the chip hides on that day).
 * - Kate McLeod Daily Stone (p-109144875, The Sleep Code): sold out there, and katemcleod.com pays nothing in her data,
 *   so it waits for The Sleep Code to restock.
 * Guard: src/test/giftGuideOwnerAdds1122.test.ts.
 */
const shopmy = (pin) => `https://go.shopmy.us/${pin}`;
const amz = (asin) => `https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20`;
/** Amazon's own photo, never edited (Associates rules); the page shows it as is. */
const amzImg = (id) => `https://m.media-amazon.com/images/I/${id}._SL500_.jpg`;

/** The day these prices were checked (Louisiana day). */
export const ADDS_PRICE_AT = "2026-11-22";

/** Stores these picks go to that the store list may not hold yet (key -> shown name). */
export const ADDS_STORES_1122 = {
  "store-sleep-crown": "Sleep Crown", "store-crown-affair": "Crown Affair", "store-eadem": "EADEM", "store-aera": "Aera",
  "store-lemme": "Lemme", "store-stil": "STIL", "store-eleven-eleven": "Eleven Eleven", "store-calvin-klein": "Calvin Klein", "store-foton": "Foton", "store-sleepy-tie": "Sleepy Tie",
};

/** Each row carries the day its price was checked (the page's "Prices as of" note reads the oldest). */
const dated = (r) => ({ ...r, priceAt: ADDS_PRICE_AT });

/** Her code at campsnapphoto.com (ShopMy Discount Codes: 7% off, no end date). */
const CAMP_SNAP_CODE = "LEXILOMBAS7";

/** For Her (owner via the lead, 11-22: "all ... go on the HER guide"). */
export const HER_ADDS_1122 = [
  { name: "Camp Snap 2 Screen-Free Camera, Chestnut", brand: "Camp Snap", line: "A screen-free digital camera that shoots like film.", href: shopmy("p-109140863"), image: "https://static.shopmy.us/pins/zoom-109140863-1795365634530-CS2Chestnut.jpg", store: "store-camp-snap", sortPrice: 59.99, price: 59.99, commission: 10, type: "camera", code: CAMP_SNAP_CODE },
  { name: "Camp Snap CS-Pro Digital Camera", brand: "Camp Snap", line: "A retro-look digital camera with a built-in flash.", href: shopmy("p-107929179"), image: "https://static.shopmy.us/uploads/pretty-prod-1794572274203", store: "store-camp-snap", sortPrice: 79, price: 79, commission: 10, type: "camera", code: CAMP_SNAP_CODE },
  { name: "Camp Snap CS-8 Digital Video Camcorder, Classic", brand: "Camp Snap", line: "A Super 8-style camcorder for vintage-look home movies.", href: shopmy("p-109141448"), image: "https://static.shopmy.us/pins/zoom-109141448-1795365699492-CS2Black_cs.jpg", store: "store-camp-snap", sortPrice: 159, price: 159, commission: 10, type: "camcorder", code: CAMP_SNAP_CODE },
  { name: "Sleep Crown Classic Pillow, White Silk and Bamboo", brand: "Sleep Crown", line: "An over-the-head pillow that blocks out light and sound.", href: shopmy("p-109143437"), image: "https://static.shopmy.us/pins/zoom-109143437-1795365959725-sophiaduet_classic.jpg", store: "store-sleep-crown", sortPrice: 289, price: 289, commission: 10, type: "pillow", backOn: "2026-12-01" },
  { name: "Crown Affair The Towel, White", brand: "Crown Affair", line: "A soft waffle hair towel that dries hair gently.", href: shopmy("p-109143698"), image: "https://static.shopmy.us/pins/zoom-109143698-1795365996438-TheTowelWhite-Grey01_ALLURE_1.png", store: "store-crown-affair", sortPrice: 59, price: 59, commission: 15, type: "hair-towel" },
  // Macy's lists it by size (Black Friday 11-22: Twin $84.79 up to Cal King $142.39; Queen $116.89), so it shows "from".
  // Photo: Macy's packaged shot of the same pad (its main photo is a whole bedroom).
  { name: "Serta Plush Heated Mattress Pad", brand: "Serta", line: "A plush heated mattress pad for warm winter nights.", href: shopmy("p-109144140"), image: "https://slimages.macysassets.com/is/image/MCY/products/6/optimized/25517456_fpx.tif?wid=1000&fmt=jpeg", store: "store-macys", sortPrice: 84.79, price: 84.79, priceFrom: true, commission: 16, type: "heated-bedding" },
  // Photo: eadem.co's own transparent tube (the shade's hero photo carries an award badge on a lip-color swirl).
  { name: "EADEM Le Chouchou Lip Balm, Boba Bounce", brand: "EADEM", line: "A softening lip balm with a sheer wash of color.", href: shopmy("p-109144450"), image: "https://cdn.shopify.com/s/files/1/0512/1661/3529/files/LCC_TUBE_TRANSARENT.png", store: "store-eadem", sortPrice: 24, price: 24, commission: 20, type: "lip-balm" },
  // Photo: aeraforhome.com's folded shot of the same robe (the pin's photo is a model in a room).
  { name: "Aera Organic Waffle Robe, Alpine White", brand: "Aera", line: "An organic cotton waffle robe for slow mornings.", href: shopmy("p-109145379"), image: "https://cdn.shopify.com/s/files/1/1064/2306/files/APP-Rob_UnisexOrganicWaffle_Robe_AlpineWhite_D_FA23_17564.jpg", store: "store-aera", sortPrice: 98, price: 98, commission: 30, type: "robe" },
  { name: "Coravin Pivot+ Wine Preservation System", brand: "Coravin", line: "Pours a glass and keeps the rest of the bottle fresh.", href: shopmy("p-109145823"), image: "https://static.shopmy.us/pins/zoom-109145823-1795366241092-19414141_fpx.tif", store: "store-macys", sortPrice: 199, price: 199, commission: 16, type: "wine-tool" },
  // Batch 2 (11-22): more of her launch-day pins, priced on each brand's own site 11-22.
  { name: "Lemme Sleep Gummies", brand: "Lemme", line: "Melatonin gummies for winding down at night.", href: shopmy("p-109147879"), image: "https://static.shopmy.us/pins/zoom-109147879-1795366520727-Open-bottle-sleep_1.png", store: "store-lemme", sortPrice: 30, price: 30, commission: 20, type: "sleep-supplement" },
  { name: "Nest Grapefruit Wall Diffuser Set", brand: "Nest", line: "A plug-in diffuser that keeps a room smelling fresh.", href: shopmy("p-109152557"), image: "https://static.shopmy.us/pins/zoom-109152557-1795367135090-NESTNY_TECH_DIF_WALL_SET-1_1536x_jpg.webp", store: "store-huntandbloom", sortPrice: 42, price: 42, commission: 15, type: "home-fragrance" },
  { name: "STIL Monogram Keychain, Plum", brand: "STIL", line: "A leather keychain she can have monogrammed.", href: shopmy("p-109153848"), image: "https://static.shopmy.us/pins/zoom-109153848-1795367301127-Plum_Keychain-01.png", store: "store-stil", sortPrice: 18, price: 18, commission: 15, type: "accessory" },
  { name: "STIL Lined Journal, Dark Chocolate Croc", brand: "STIL", line: "A croc-embossed journal for lists and notes.", href: shopmy("p-109153960"), image: "https://static.shopmy.us/uploads/pretty-prod-1787648338732", store: "store-stil", sortPrice: 18, price: 18, commission: 15, type: "journal" },
  { name: "STIL Travel Case, Beige Croc", brand: "STIL", line: "A croc-embossed zip case for makeup or chargers.", href: shopmy("p-109153910"), image: "https://static.shopmy.us/uploads/pretty-prod-1782963039303", store: "store-stil", sortPrice: 24, price: 24, commission: 15, type: "bag" },
  // Her pin's photo is a phone case (owner 11-22: "find the binder's real product photo"): stilclassics.com's own Onyx Croc binder.
  { name: "STIL A5 Binder, Onyx Croc", brand: "STIL", line: "A six-ring planner binder in croc-embossed black.", href: shopmy("p-109153811"), image: "https://cdn.shopify.com/s/files/1/0571/9701/files/2024-A5-Binder-BlackCroc_db6c6de1-87c0-49e9-8808-c58a61dc3b6f.jpg", store: "store-stil", sortPrice: 44, price: 44, commission: 15, type: "planner" },
  { name: "Emi Jay Big Effing Clip, Doe", brand: "Emi Jay", line: "The oversized claw clip that holds thick hair.", href: shopmy("p-109151082"), image: "https://static.shopmy.us/pins/zoom-109151082-1795366946126-bigeffingclipindoe.jpg", store: "store-emi-jay", sortPrice: 36, price: 36, commission: 15, type: "hair" },
  // Photo: eleveneleven.com's flat shot of the same pullover (the pin's photo is a model outdoors).
  { name: "Eleven Eleven Plaid Fleece Pullover", brand: "Eleven Eleven", line: "An oversized plaid fleece with a snap collar.", href: shopmy("p-109154746"), image: "https://cdn.shopify.com/s/files/1/0603/2474/1362/files/plaidsnapnewflat.webp", store: "store-eleven-eleven", sortPrice: 158, price: 158, commission: 5, type: "pullover" },
  // Batch 2b (11-22). Owner via lead: "add The Sleepy Tie heatless curler ($29.99) as her pin shows" (the pin is named
  // "Double Satin Scrunchie", but its photo is The Sleepy Tie, which comes with a satin scrunchie).
  { name: "The Sleepy Tie Heatless Curler", brand: "Sleepy Tie", line: "Satin heatless curls overnight, scrunchie included.", href: shopmy("p-109150422"), image: "https://static.shopmy.us/pins/zoom-109150422-1795366856711-1.untitled-105-Edit.jpg", store: "store-sleepy-tie", sortPrice: 29.99, price: 29.99, commission: 12, type: "hair" },
  { name: "Foton Breezy Blanket Candle", brand: "Foton", line: "A line-dried laundry scent in pearled candle wax.", href: shopmy("p-109158379"), image: "https://cdn.shopify.com/s/files/1/0568/9776/5573/files/Breezy_Blanket_18oz.png", store: "store-foton", sortPrice: 36.99, price: 36.99, commission: 12, type: "candle" },
  // Owner via lead: her Lake pin p-103884402 (Gelato Inverse Anchor Stripe bundle) is gone from lakepajamas.com, so her
  // other Lake women's pin, the Pima Short-Long Set in Hydrangea (p-103889077, 12%), takes its place.
  { name: "Lake Pima Short-Long Set, Hydrangea", brand: "Lake", line: "A soft pima tee and pants set in light blue.", href: shopmy("p-103889077"), image: "https://cdn.shopify.com/s/files/1/0505/6125/files/hydrangea_SL_0125.jpg", store: "store-lake-pajamas", sortPrice: 124, price: 124, commission: 12, type: "pajamas" },
  // From her screenshots (owner via lead): no ShopMy pin for these, so Amazon with her tag, Amazon's photo and price 11-22.
  { name: "CFUNIQ Personalized Hanging Toiletry Bag", brand: "CFUNIQ", line: "A striped hanging toiletry bag with her name on it.", href: amz("B0HKS18NW2"), image: amzImg("71BLiEpXmoL"), store: "store-amazon", sortPrice: 14.98, commission: 3, type: "bag" },
  { name: "Astercook 15-Piece Knife Set with Block", brand: "Astercook", line: "Sharp kitchen knives in a block with a sharpener.", href: amz("B0C1YBPJ43"), image: amzImg("61TheuxRpFL"), store: "store-amazon", sortPrice: 35.98, commission: 3, type: "kitchen-knives" },
  { name: "Astercook 21-Piece Pots and Pans Set", brand: "Astercook", line: "Nonstick pots and pans with handles that come off.", href: amz("B0F2937DQQ"), image: amzImg("71QGP9TL77L"), store: "store-amazon", sortPrice: 56.98, commission: 3, type: "cookware" },
  { name: "CASABREWS CM5418 Espresso Machine", brand: "CASABREWS", line: "A compact espresso maker with a milk frothing wand.", href: amz("B09X3WGJ3R"), image: amzImg("617U+hSCJEL"), store: "store-amazon", sortPrice: 111.99, commission: 3, type: "coffee-maker" },
  { name: "BISSELL PowerClean FurGuard Cordless Stick Vacuum", brand: "BISSELL", line: "A light cordless vacuum made for pet hair.", href: amz("B0DQLLPYGM"), image: amzImg("71H9oJb3pyL"), store: "store-amazon", sortPrice: 184.89, commission: 3, type: "vacuum" },
  { name: "eto Wine Decanter and Preserver, Stainless", brand: "eto", line: "A decanter that keeps an open bottle fresh for days.", href: amz("B0GP2R8TBS"), image: amzImg("41YNmeHEpGL"), store: "store-amazon", sortPrice: 199, commission: 3, type: "wine-tool" },
  // Owner's screenshot: a round dark case with white tips, which is the Sleepbuds 2 (the first Sleepbuds is B0DJB1ZL8V).
  { name: "Ozlo Sleepbuds 2", brand: "Ozlo", line: "Comfy sleep earbuds that mask snoring and noise.", href: amz("B0GZSMBDYZ"), image: amzImg("61yf9iq55IL"), store: "store-amazon", sortPrice: 237, commission: 3, type: "sleep-earbuds" },
].map(dated);

/** For Kids (owner via the lead, 11-22): the two Camp Snap 2 colors, at Camp Snap direct (see the header). */
export const KIDS_ADDS_1122 = [
  { name: "Camp Snap 2 Screen-Free Camera, Blue Rush", brand: "Camp Snap", line: "A screen-free kids' camera in see-through blue.", href: shopmy("p-107929152"), image: "https://static.shopmy.us/pins/zoom-109142125-1795365781660-Yellow_Front_9ea4e828-8752-4bcd-bf01-b49ef26f4be5.webp", store: "store-camp-snap", sortPrice: 59.99, price: 59.99, commission: 10, type: "camera", code: CAMP_SNAP_CODE },
  { name: "Camp Snap 2 Screen-Free Camera, Strawberry Splash", brand: "Camp Snap", line: "A screen-free kids' camera in see-through pink.", href: shopmy("p-104219842"), image: "https://static.shopmy.us/pins/zoom-109142226-1795365794451-Yellow_Front-3.webp", store: "store-camp-snap", sortPrice: 59.99, price: 59.99, commission: 10, type: "camera", code: CAMP_SNAP_CODE },
  // Owner via the lead, 11-22: "p-109155269 goes on KIDS". Photo: the four products from eadem.co's own set photo (its
  // main photo stacks them on books).
  { name: "EADEM New Classics Set", brand: "EADEM", line: "Four skin and lip favorites in one starter set.", href: shopmy("p-109155269"), image: "https://cdn.shopify.com/s/files/1/0512/1661/3529/files/PDP-CLEARSPACE_WIDER-FRAME_2750x3413-1.jpg", store: "store-eadem", sortPrice: 58, price: 58, commission: 20, type: "skincare-set" },
  // Owner via lead, 11-22: "add BOTH bundles (Ms. Rachel + Bluey), side by side". Photos: her pins' tiles with the panel taken off.
  { name: "Yoto Player 4th Gen + Ms. Rachel Adventure Bundle", brand: "Yoto", line: "A screen-free audio player with a Ms. Rachel card.", href: shopmy("p-109156467"), image: "https://static.shopmy.us/uploads/img-product-1794924419956", store: "store-yoto", sortPrice: 165.72, price: 165.72, commission: 20, type: "audio" },
  { name: "Yoto Player 4th Gen + Bluey Adventure Bundle", brand: "Yoto", line: "A screen-free audio player with a Bluey story card.", href: shopmy("p-109156399"), image: "https://static.shopmy.us/uploads/img-product-1793495319475", store: "store-yoto", sortPrice: 164.02, price: 164.02, commission: 20, type: "audio" },
].map(dated);

/** For Him (owner via the lead, 11-22). */
export const HIM_ADDS_1122 = [
  // Her older Lake Pajamas pins (Nov 11), sent for Him on 11-22; priced on lakepajamas.com 11-22.
  { name: "Lake Men's Pima Sleep Shorts Set, True Navy", brand: "Lake", line: "A soft pima tee and shorts set for lounging.", href: shopmy("p-103892269"), image: "https://cdn.shopify.com/s/files/1/0505/6125/files/LAKE_Webcrop_Winter2025_Mens_SS_TrueNavy.jpg", store: "store-lake-pajamas", sortPrice: 138, price: 138, commission: 12, type: "pajamas" },
  // Owner via lead, 11-22: "the Battery Daddy" for Him (no ShopMy pin; Amazon with her tag, the red case with a tester).
  { name: "Ontel Battery Daddy Organizer with Tester", brand: "Ontel", line: "A clear case that holds 180 batteries and tests them.", href: amz("B089F9YDFC"), image: amzImg("91uDndg0w6L"), store: "store-amazon", sortPrice: 19.99, commission: 3, type: "organizer" },
  { name: "Lake Men's Flannel Pajama Pants, Dark Sea Windowpane", brand: "Lake", line: "Cozy flannel pajama pants in a green windowpane.", href: shopmy("p-104054474"), image: "https://static.shopmy.us/pins/zoom-104054474-1794418722190-LAKE_Webcrop_Holiday1_2026_MensFlannelPants_DarkSeaCozyWindowpane_1200x1800_bec943d7-09d7-441c-9496-61e98eb5e1bc.jpg", store: "store-lake-pajamas", sortPrice: 108, price: 108, commission: 12, type: "pajamas" },
].map(dated);

/** Transparent cutouts for these photos (Apple Vision, scripts/gift-guide-cutout.swift; each checked by eye, 400 px). */
export const ADDS_CUTOUTS_1122 = [
  ["https://static.shopmy.us/pins/zoom-109140863-1795365634530-CS2Chestnut.jpg", "camp-snap-2-chestnut-75ff92.webp"],
  ["https://static.shopmy.us/uploads/pretty-prod-1794572274203", "camp-snap-cs-pro-886860.webp"],
  ["https://static.shopmy.us/pins/zoom-109141448-1795365699492-CS2Black_cs.jpg", "camp-snap-cs-8-camcorder-classic-8e9844.webp"],
  ["https://static.shopmy.us/pins/zoom-109142125-1795365781660-Yellow_Front_9ea4e828-8752-4bcd-bf01-b49ef26f4be5.webp", "camp-snap-2-blue-rush-ea2f89.webp"],
  ["https://static.shopmy.us/pins/zoom-109142226-1795365794451-Yellow_Front-3.webp", "camp-snap-2-strawberry-splash-953011.webp"],
  // The zoom-in circle of the fabric was taken off.
  ["https://static.shopmy.us/pins/zoom-109143437-1795365959725-sophiaduet_classic.jpg", "sleep-crown-classic-sophia-duet-cbc24f.webp"],
  // The corner award badge was taken off.
  ["https://static.shopmy.us/pins/zoom-109143698-1795365996438-TheTowelWhite-Grey01_ALLURE_1.png", "crown-affair-the-towel-white-a7570c.webp"],
  ["https://slimages.macysassets.com/is/image/MCY/products/6/optimized/25517456_fpx.tif", "serta-plush-heated-mattress-pad-331ea9.webp"],
  ["https://cdn.shopify.com/s/files/1/0512/1661/3529/files/LCC_TUBE_TRANSARENT.png", "eadem-le-chouchou-lip-balm-29fc6e.webp"],
  ["https://cdn.shopify.com/s/files/1/1064/2306/files/APP-Rob_UnisexOrganicWaffle_Robe_AlpineWhite_D_FA23_17564.jpg", "aera-organic-waffle-robe-alpine-white-263d17.webp"],
  ["https://static.shopmy.us/pins/zoom-109145823-1795366241092-19414141_fpx.tif", "coravin-pivot-plus-979321.webp"],
  // Batch 2.
  ["https://static.shopmy.us/pins/zoom-109147879-1795366520727-Open-bottle-sleep_1.png", "lemme-sleep-gummies-29d891.webp"],
  ["https://static.shopmy.us/pins/zoom-109152557-1795367135090-NESTNY_TECH_DIF_WALL_SET-1_1536x_jpg.webp", "nest-grapefruit-wall-diffuser-set-9ef8be.webp"],
  [
    "https://static.shopmy.us/pins/zoom-109153848-1795367301127-Plum_Keychain-01.png",
    "stil-monogram-fob-plum-6fd648.webp",
  ],
  ["https://static.shopmy.us/uploads/pretty-prod-1787648338732", "stil-lined-journal-dark-chocolate-croc-c85fb1.webp"],
  ["https://static.shopmy.us/uploads/pretty-prod-1782963039303", "stil-travel-case-beige-croc-bedfe6.webp"],
  ["https://cdn.shopify.com/s/files/1/0571/9701/files/2024-A5-Binder-BlackCroc_db6c6de1-87c0-49e9-8808-c58a61dc3b6f.jpg", "stil-a5-binder-onyx-croc-1e5dfe.webp"],
  ["https://static.shopmy.us/pins/zoom-109151082-1795366946126-bigeffingclipindoe.jpg", "emi-jay-big-effing-clip-doe-c1887c.webp"],
  ["https://cdn.shopify.com/s/files/1/0603/2474/1362/files/plaidsnapnewflat.webp", "eleven-eleven-plaid-fleece-pullover-a031d1.webp"],
  ["https://cdn.shopify.com/s/files/1/0505/6125/files/LAKE_Webcrop_Winter2025_Mens_SS_TrueNavy.jpg", "lake-mens-pima-sleep-shorts-set-true-navy-5a7df2.webp"],
  ["https://static.shopmy.us/pins/zoom-104054474-1794418722190-LAKE_Webcrop_Holiday1_2026_MensFlannelPants_DarkSeaCozyWindowpane_1200x1800_bec943d7-09d7-441c-9496-61e98eb5e1bc.jpg", "lake-mens-flannel-pajama-pants-dark-sea-0a8374.webp"],
  // Batch 2b.
  ["https://static.shopmy.us/pins/zoom-109150422-1795366856711-1.untitled-105-Edit.jpg", "sleepy-tie-heatless-curler-f98ad4.webp"],
  ["https://cdn.shopify.com/s/files/1/0568/9776/5573/files/Breezy_Blanket_18oz.png", "foton-breezy-blanket-candle-6e1776.webp"],
  ["https://cdn.shopify.com/s/files/1/0505/6125/files/hydrangea_SL_0125.jpg", "lake-pima-short-long-set-hydrangea-6a7e77.webp"],
  ["https://static.shopmy.us/uploads/img-product-1794924419956", "yoto-player-ms-rachel-bundle-045251.webp"],
  ["https://static.shopmy.us/uploads/img-product-1793495319475", "yoto-player-bluey-bundle-8ea1dd.webp"],
  // The set's four products, cropped from its labelled photo (no labels kept).
  ["https://cdn.shopify.com/s/files/1/0512/1661/3529/files/PDP-CLEARSPACE_WIDER-FRAME_2750x3413-1.jpg", "eadem-new-classics-set-ae7614.webp"],
];
