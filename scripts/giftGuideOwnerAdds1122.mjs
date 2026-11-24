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
 * - Camp Snap "Choose one of these camp snap cameras" (owner 11-22 PM, builder-guide-emibauble): Her keeps only the Camp
 *   Snap 2 in Chestnut; the CS-Pro (p-107929179, $79), the CS-8 camcorder (p-109141448, $159) and the CS-8 Micro keychain
 *   (scripts/giftGuideHer1121.mjs) are off Her.
 * Guard: src/test/giftGuideOwnerAdds1122.test.ts.
 */
import { rateSwitch1124 } from "./giftGuideOwner1124.mjs";

const shopmy = (pin) => `https://go.shopmy.us/${pin}`;
const amz = (asin) => `https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20`;
/** Amazon's own photo, never edited (Associates rules); the page shows it as is. */
const amzImg = (id) => `https://m.media-amazon.com/images/I/${id}._SL500_.jpg`;
/** xtratuf.com through CJ (15%), the same deep-link form as the Her and Him XTRATUF rows. */
const xtratufCj = (style) => `https://www.anrdoezrs.net/click-101930553-15735628?url=${encodeURIComponent(`https://xtratuf.com/products/${style}`)}`;

/** The day these prices were checked (Louisiana day). */
export const ADDS_PRICE_AT = "2026-11-22";

/** Stores these picks go to that the store list may not hold yet (key -> shown name). */
export const ADDS_STORES_1122 = {
  "store-sleep-crown": "Sleep Crown", "store-crown-affair": "Crown Affair", "store-eadem": "EADEM", "store-aera": "Aera",
  "store-lemme": "Lemme", "store-stil": "STIL", "store-eleven-eleven": "Eleven Eleven", "store-calvin-klein": "Calvin Klein", "store-foton": "Foton", "store-sleepy-tie": "Sleepy Tie", "store-esker-beauty": "Esker",
  "store-the-warming-store": "The Warming Store", "store-cavenders": "Cavender's", "store-marley-lilly": "Marley Lilly", "store-st-bernard": "St. Bernard",
  "store-pottery-barn-kids": "Pottery Barn Kids",
};

/** Each row carries the day its price was checked (the page's "Prices as of" note reads the oldest). */
const dated = (r) => ({ ...r, priceAt: ADDS_PRICE_AT });

/** Her code at campsnapphoto.com (ShopMy Discount Codes: 7% off, no end date). */
const CAMP_SNAP_CODE = "LEXILOMBAS7";

/** For Her (owner via the lead, 11-22: "all ... go on the HER guide"). */
export const HER_ADDS_1122 = [
  { name: "Camp Snap 2 Screen-Free Camera, Chestnut", brand: "Camp Snap", line: "A screen-free digital camera that shoots like film.", href: shopmy("p-109140863"), image: "https://static.shopmy.us/pins/zoom-109140863-1795365634530-CS2Chestnut.jpg", store: "store-camp-snap", sortPrice: 59.99, price: 59.99, commission: 10, type: "camera", code: CAMP_SNAP_CODE },
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
  // Batch 2c (11-22): her pins at department stores and beauty shops, priced on each store's page 11-22.
  { name: "Good Molecules Caffeine Energizing Hydrogel Eye Patches", brand: "Good Molecules", line: "Cooling caffeine eye patches for puffy mornings.", href: shopmy("p-109147619"), image: "https://static.shopmy.us/uploads/pretty-prod-1786107449401", store: "store-ulta-beauty", sortPrice: 18, price: 18, commission: 13, type: "skincare" },
  { name: "BISSELL Little Green Mini Carpet Cleaner", brand: "BISSELL", line: "A small spot cleaner for rugs, couches and car seats.", href: shopmy("p-109151385"), image: "https://static.shopmy.us/pins/zoom-109151385-1795366985590-GUEST_a0e171ac-5761-42c7-83ca-b6b75eced062", store: "store-target", sortPrice: 79.99, price: 79.99, commission: 4, type: "vacuum" },
  // Anthropologie lists it at $89 (30% off in cart on 11-22).
  { name: "Drowsy Sleep in the City Silk Sleep Mask", brand: "Drowsy", line: "A padded silk sleep mask with ruffled edges.", href: shopmy("p-109149968"), image: "https://static.shopmy.us/pins/zoom-109149968-1795366797104-102988060_639_b", store: "store-anthropologie", sortPrice: 89, price: 89, commission: 15, type: "sleep-mask" },
  { name: "Diptyque Baies Candle", brand: "Diptyque", line: "The classic blackcurrant and rose candle, 190 g.", href: shopmy("p-109152299"), image: "https://cdn.shopify.com/s/files/1/0618/7116/1562/files/3701699309746_9835a6a3-0819-43b7-b79b-b30648cbe0e0.jpg", store: "store-cos-bar", sortPrice: 90, price: 90, commission: 20, type: "candle" },
  { name: "Madewell x The Six Bells Nightgown", brand: "Madewell", line: "A soft white nightgown from the holiday collab.", href: shopmy("p-109155568"), image: "https://static.shopmy.us/pins/zoom-109155568-1795367501473-OC137_WT0012_m", store: "store-madewell", sortPrice: 158, price: 158, commission: 12, type: "nightgown" },
  // Her pin's photo is the rose-gold ring, Ulta's Deep Rose ($399 Black Friday, was $499).
  { name: "Oura Ring 5, Deep Rose", brand: "Oura", line: "A smart ring that tracks sleep, steps and recovery.", href: shopmy("p-109155784"), image: "https://static.shopmy.us/pins/zoom-109155784-1795367529760-2664695", store: "store-ulta-beauty", sortPrice: 399, price: 399, commission: 13, type: "smart-ring" },
// owner 11-22 popular via new ShopMy links (builder-guide-links)
  { name: "Esker The Bubble Soak", brand: "Esker", line: "A mineral bubble bath that comes in a pretty ceramic jar.", href: shopmy("p-109207730"), image: "https://static.shopmy.us/uploads/pretty-prod-1765010272351", store: "store-esker-beauty", sortPrice: 75, price: 75, commission: 22, type: "skincare" },
  // owner 11-22 her picks block 2 (builder-guide-her4)
  // From her screenshots (owner via lead): Amazon, brand-sold where it is, her tag, Amazon's photo and price 11-22.
  { name: "HydroJug Traveler 32 oz Water Bottle, French Vanilla", brand: "HydroJug", line: "An insulated bottle with a handle and a flip straw lid.", href: amz("B0H2FQ5FV1"), image: amzImg("619aFkeAamL"), store: "store-amazon", sortPrice: 39.99, commission: 3, type: "water-bottle" },
  { name: "HydroJug Everyday Tumbler 14 oz, Brown Leopard", brand: "HydroJug", line: "A small straw cup in leopard that fits the cup holder.", href: amz("B0FXYGCYK6"), image: amzImg("51GMAyANcAL"), store: "store-amazon", sortPrice: 24.99, commission: 3, type: "tumbler" },
  { name: "She's Birdie Personal Safety Alarm", brand: "She's Birdie", line: "A loud keychain alarm with a flashlight, made by women.", href: amz("B0F5K3B4Q7"), image: amzImg("61k3K4tU1ML"), store: "store-amazon", sortPrice: 29.94, commission: 3, type: "safety-alarm" },
  { name: "CRZ YOGA Butterluxe Wide Leg Pants with Pockets", brand: "CRZ YOGA", line: "Buttery soft wide-leg pants for lounging or the gym.", href: amz("B0CHMS3PVZ"), image: amzImg("61Az5NMvxyL"), store: "store-amazon", sortPrice: 27.99, commission: 3, type: "pants" },
  { name: "CRZ YOGA Butterluxe Y Back Sports Bra", brand: "CRZ YOGA", line: "A soft sports bra with removable pads, made to match the pants.", href: amz("B0D7GQVNNN"), image: amzImg("816PhjD216L"), store: "store-amazon", sortPrice: 23.8, commission: 3, type: "sports-bra" },
  { name: "Lemon Grace Personalized Note Cards", brand: "Lemon Grace", line: "Floral note cards printed with her name.", href: amz("B0D1X4PNFD"), image: amzImg("616z8ijssZL"), store: "store-amazon", sortPrice: 29.95, commission: 3, type: "stationery" },
  { name: "Bose QuietComfort Ultra Earbuds, 2nd Gen", brand: "Bose", line: "Noise-cancelling earbuds with immersive sound.", href: amz("B0F7M3HPBD"), image: amzImg("513LCPDEWKL"), store: "store-amazon", sortPrice: 229, commission: 3, type: "earbuds" },
  { name: "Striped PVC Personalized Makeup Bag", brand: "MoonDreamGifts", line: "A roomy waterproof makeup bag with her name stitched on.", href: amz("B0H3YXW87L"), image: amzImg("71Fja9sEBML"), store: "store-amazon", sortPrice: 42.99, commission: 3, type: "bag" },
  { name: "Personalized Embroidered Toiletry Bag, Green and Pink", brand: "HOFUN JETRON", line: "A waterproof toiletry bag with her monogram.", href: amz("B0H9L8Z1DY"), image: amzImg("81Z3eTeJc1L"), store: "store-amazon", sortPrice: 21.99, commission: 3, type: "bag" },
  { name: "YETI Daytrip Lunch Bag, Olive", brand: "YETI", line: "A leakproof insulated lunch bag with a magnetic close.", href: amz("B0F79VTVFQ"), image: amzImg("51WrN1VDO9L"), store: "store-amazon", sortPrice: 85, commission: 3, type: "lunch-bag" },
  { name: "Puffer Vest for Women, Gray", brand: "Amazon Fashion", line: "A cropped puffy vest with a stand collar and pockets.", href: amz("B0D92375JB"), image: amzImg("71jbS6obwRL"), store: "store-amazon", sortPrice: 26.99, commission: 3, type: "vest" },
  { name: "Oversized Mockneck Striped Sweatshirt, Pink", brand: "Amazon Fashion", line: "A slouchy pink-and-white striped sweatshirt, an Amazon best seller.", href: amz("B0G4M22BQL"), image: amzImg("81TNb+2Rg5L"), store: "store-amazon", sortPrice: 32.99, commission: 3, type: "sweatshirt" },
  { name: "ReachMe Womens Sherpa Zip Up Hoodie Jacket, Lavender", brand: "ReachMe", line: "A fuzzy zip-up sherpa jacket with a hood and pockets.", href: amz("B0BGS3L9XS"), image: amzImg("71lp6kmTWUL"), store: "store-amazon", sortPrice: 27.99, commission: 3, type: "jacket" },
  { name: "Kitsch Hair Perfume, Warm Sugar", brand: "Kitsch", line: "A hair and body mist that smells like warm vanilla sugar.", href: amz("B0DXWP12C8"), image: amzImg("714UhZVsYBL"), store: "store-amazon", sortPrice: 13.99, commission: 3, type: "hair-perfume" },
  { name: "HydroJug Sport 32 oz Water Bottle, Mocha Tortoise", brand: "HydroJug", line: "An insulated stainless bottle in a tortoise print.", href: amz("B0HKYH5TF2"), image: amzImg("61ERJWo3RBL"), store: "store-amazon", sortPrice: 39.99, commission: 3, type: "water-bottle" },
  { name: "Striped Paper Gift Bags with Ribbon Handles", brand: "Vitalizart", line: "A pack of striped gift bags with ribbon handles.", href: amz("B0H2CSG4SZ"), image: amzImg("710qNLB11HL"), store: "store-amazon", sortPrice: 15.99, commission: 3, type: "gift-wrap" },
  { name: "Personalized Monogram Scallop Gift Tags", brand: "Amazon", line: "Scalloped gift tags printed with her name or monogram.", href: amz("B0FXBBD5GS"), image: amzImg("71CBVdlD2ML"), store: "store-amazon", sortPrice: 17.5, commission: 3, type: "gift-wrap" },
  { name: "Personalized Lizard Leather Initial Card Holder", brand: "Personalisa", line: "A slim lizard-print card holder with her initials in gold.", href: amz("B0G3948RG8"), image: amzImg("81mw1dd1e2L"), store: "store-amazon", sortPrice: 14.8, commission: 3, type: "wallet" },
  { name: "Personalized Striped Monogram Makeup Pouch", brand: "Amazon", line: "A waterproof striped pouch with her monogram stitched on.", href: amz("B0HKQYLRBB"), image: amzImg("71iBkWfRwfL"), store: "store-amazon", sortPrice: 22.99, commission: 3, type: "bag" },
  // builder-guide-emibauble (owner 11-22 PM). From her screenshots: "Add both" for the Emi Jay clip and the BaubleBar
  // brush; the link made in her shopmy.us/links ("You can create the links"), priced on baublebar.com 11-22.
  // - Emi Jay: skipped, her Doe clip is already on Her and she wants no duplicate (the red Cherry Kiss pin p-109290718 is
  //   unused; the Cozy Cloud Gingham Big Effing Clip is sold out on emijay.com).
  // - BaubleBar Mini Fine Line Custom Hair Brush, Magenta/Light Pink ($48, 20%): her name goes on the back.
  { name: "BaubleBar Mini Fine Line Custom Hair Brush, Magenta", brand: "BaubleBar", line: "A hot pink hair brush with her name on the back.", href: shopmy("p-109289957"), image: "https://cdn.shopify.com/s/files/1/0267/5746/4148/files/110416_G_01_RS_SQ_2026_80d4c91e-c2d8-4a9a-a92e-491e1abec4ac.jpg", store: "store-baublebar", sortPrice: 48, price: 48, commission: 20, type: "hair" },
  // Owner 11-22 PM: the Stoggles safety glasses are off; "cute tortoise blue light glasses" instead. Gaoye's round frame in
  // Tea Leopard (tortoise), 4.4 stars from 11,300+ ratings; Amazon with her tag, Amazon's photo and price 11-22.
  { name: "Gaoye Round Blue Light Glasses, Tea Leopard", brand: "Gaoye", line: "Tortoise blue light glasses for long days at a screen.", href: amz("B07XL9MFZQ"), image: amzImg("61qZCp6L-rL"), store: "store-amazon", sortPrice: 12.74, commission: 4, type: "eyewear" },
  // Owner 11-22 PM: the EADEM New Classics Set moves from Kids to Her (photo: the four products from eadem.co's set photo).
  { name: "EADEM New Classics Set", brand: "EADEM", line: "Four skin and lip favorites in one starter set.", href: shopmy("p-109155269"), image: "https://cdn.shopify.com/s/files/1/0512/1661/3529/files/PDP-CLEARSPACE_WIDER-FRAME_2750x3413-1.jpg", store: "store-eadem", sortPrice: 58, price: 58, commission: 20, type: "skincare-set" },
  // LOUISIANA_ADDS_1122 (builder-guide-louisiana, owner 11-22 PM: "add all items" from the Desktop note
  // "Gift guides and affiliate/Louisiana-popular-candidates-1122.md", her picks, so the type and brand caps do not apply).
  // ShopMy links made in her shopmy.us/links that evening (ShopMy-links-created-1122.md); Amazon rows use her tag and
  // Amazon's own photo; prices read on each store's own page 11-22. Mignon Faget lists each piece by metal, so it shows
  // the page's own "from" price; Katie Kime lists the tray by size. Owner 11-22 PM ("Drop both"): the Desden LSU coin
  // pouch and the Southern Marsh youth chino are off, since ShopMy shows no rate for either (0% items stay off).
  { name: "Mignon Faget Heirloom Fleur de Lis Pendant", brand: "Mignon Faget", line: "A fleur de lis pendant from a New Orleans jeweler.", href: shopmy("p-109341967"), image: "https://www.mignonfaget.com/mm5/graphics/00000001/9/7661S.png", store: "store-mignon-faget", sortPrice: 75, price: 75, priceFrom: true, commission: 9, type: "jewelry" },
  { name: "Stoney Clover Lane x '47 Saints Clean Up Hat", brand: "Stoney Clover Lane", line: "A cream Saints cap in cursive script with a suede brim.", href: shopmy("p-109342469"), image: "https://cdn.shopify.com/s/files/1/0096/2392/files/FCO-SCLCC116WIS-SS-HR-F.jpg", store: "store-stoney-clover-lane", sortPrice: 55, price: 55, commission: 15, type: "hat" },
  { name: "Mignon Faget Oyster Large Earrings", brand: "Mignon Faget", line: "Oyster shell earrings from a New Orleans jeweler.", href: shopmy("p-109342173"), image: "https://www.mignonfaget.com/mm5/graphics/00000001/1795B.png", store: "store-mignon-faget", sortPrice: 120, price: 120, priceFrom: true, commission: 9, type: "jewelry" },
  // Ready row from the hidden Louisiana Celebrations guide (same pin and photo).
  { name: "Katie Kime New Orleans Toile Lucite Tray, Green", brand: "Katie Kime", line: "A lucite tray in green New Orleans toile for the bar cart.", href: shopmy("p-108006579"), image: "https://static.shopmy.us/uploads/img-product-1765082316407", store: "store-katie-kime", sortPrice: 58, price: 58, priceFrom: true, commission: 15, type: "tray" },
  { name: "Talk About Good! Cookbook", brand: "Junior League of Lafayette", line: "The Junior League of Lafayette's classic Cajun cookbook.", href: amz("0935032029"), image: amzImg("81O33zX7ijL"), store: "store-amazon", sortPrice: 24.95, commission: 4.5, type: "cookbook" },
  { name: "Totally Bamboo Louisiana Map Cutting Board", brand: "Totally Bamboo", line: "A bamboo cutting board engraved with a map of Louisiana.", href: amz("B07QDPPH7Z"), image: amzImg("81v7lFj17KL"), store: "store-amazon", sortPrice: 15.99, commission: 4.5, type: "cutting-board" },
  // Ready row from the hidden guide; price read on goldbelly.com/haydels-bakery 11-22 (shipping included).
  { name: "Haydel's Bakery Christmas King Cake", brand: "Haydel's Bakery", line: "A Christmas king cake shipped from a New Orleans bakery.", href: shopmy("p-108155517"), image: "https://goldbelly.imgix.net/uploads/showcase_media_asset/image/259423/ChristmasKringle.jpg", store: "store-goldbelly", sortPrice: 69.95, price: 69.95, commission: 12, type: "food-gift" },
  { name: "Toups and Co Travel Tallow Set", brand: "Toups and Co", line: "Mini tallow balms made in Walker, Louisiana.", href: shopmy("p-108155377"), image: "https://cdn.shopify.com/s/files/1/2365/4175/files/MINI_BALM__0238_b3164e36-a61f-4912-8990-2a891331066f.jpg", store: "store-toups-and-co", sortPrice: 45, price: 45, commission: 10, type: "skincare" },
  // Ready row from the hidden Shop Small Louisiana guide (same pin and photo).
  { name: "Match South x Café Du Monde Warm Beignets Candle", brand: "Match South", line: "A candle that smells like warm beignets at Café Du Monde.", href: shopmy("p-107207657"), image: "https://static.shopmy.us/uploads/pretty-prod-1758994986674", store: "store-match-south", sortPrice: 49, price: 49, commission: 12, type: "candle" },
  { name: "KREWE Olivier Sunglasses, Reed", brand: "KREWE", line: "Handmade sunglasses from a New Orleans eyewear brand.", href: shopmy("p-109340844"), image: "https://cdn.shopify.com/s/files/1/2422/6603/files/Olivier-Reed-Front-Web.jpg", store: "store-krewe", sortPrice: 255, price: 255, commission: 16, type: "sunglasses" },
  // Her Macy's pin (p-108153702, 72 count) now opens a Macy's "page not found" (11-22), so the 24-count box sold by
  // Amazon.com takes its place (grocery, 1%).
  { name: "Community Coffee Southern Pecan Praline K-Cup Pods, 24 Count", brand: "Community Coffee", line: "Baton Rouge's own coffee in a pecan praline flavor.", href: amz("B0886YWV65"), image: amzImg("81QxXKzsG6L"), store: "store-amazon", sortPrice: 14.69, commission: 1, type: "coffee" },
  { name: "Café Du Monde Beignet and Coffee Gift Box", brand: "Café Du Monde", line: "Beignet mix and the orange can of coffee and chicory.", href: amz("B0915PDW38"), image: amzImg("71eU3lXhlzL"), store: "store-amazon", sortPrice: 54.99, commission: 1, type: "food-gift" },
  { name: "Old World Christmas Pelican Glass Ornament", brand: "Old World Christmas", line: "A blown-glass pelican, the Louisiana state bird.", href: amz("B002CMXGRI"), image: amzImg("71hYKki6wcL"), store: "store-amazon", sortPrice: 20.99, commission: 3, type: "ornament" },
  // end LOUISIANA_ADDS_1122
].map(dated);

/** For Kids (owner via the lead, 11-22): the two Camp Snap 2 colors, at Camp Snap direct (see the header). */
export const KIDS_ADDS_1122 = [
  { name: "Camp Snap 2 Screen-Free Camera, Blue Rush", brand: "Camp Snap", line: "A screen-free kids' camera in see-through blue.", href: shopmy("p-107929152"), image: "https://static.shopmy.us/pins/zoom-109142125-1795365781660-Yellow_Front_9ea4e828-8752-4bcd-bf01-b49ef26f4be5.webp", store: "store-camp-snap", sortPrice: 59.99, price: 59.99, commission: 10, type: "camera", code: CAMP_SNAP_CODE },
  { name: "Camp Snap 2 Screen-Free Camera, Strawberry Splash", brand: "Camp Snap", line: "A screen-free kids' camera in see-through pink.", href: shopmy("p-104219842"), image: "https://static.shopmy.us/pins/zoom-109142226-1795365794451-Yellow_Front-3.webp", store: "store-camp-snap", sortPrice: 59.99, price: 59.99, commission: 10, type: "camera", code: CAMP_SNAP_CODE },
  // Owner via lead, 11-22: "add BOTH bundles (Ms. Rachel + Bluey), side by side". Photos: her pins' tiles with the panel taken off.
  { name: "Yoto Player 4th Gen + Ms. Rachel Adventure Bundle", brand: "Yoto", line: "A screen-free audio player with a Ms. Rachel card.", href: shopmy("p-109156467"), image: "https://static.shopmy.us/uploads/img-product-1794924419956", store: "store-yoto", sortPrice: 165.72, price: 165.72, commission: 20, type: "audio" },
  { name: "Yoto Player 4th Gen + Bluey Adventure Bundle", brand: "Yoto", line: "A screen-free audio player with a Bluey story card.", href: shopmy("p-109156399"), image: "https://static.shopmy.us/uploads/img-product-1793495319475", store: "store-yoto", sortPrice: 164.02, price: 164.02, commission: 20, type: "audio" },
// owner 11-22 popular via new ShopMy links (builder-guide-links)
  { name: "CrunchLabs The Crunchinator", brand: "CrunchLabs", line: "A build-it-yourself machine that crushes and launches.", href: shopmy("p-109208209"), image: "https://static.shopmy.us/pins/zoom-109208209-1795374027354-Add_a_heading_4_450x450.png", store: "store-crunchlabs", sortPrice: 34.99, price: 34.99, commission: 16, type: "science" },
  { name: "Stickerbox Sticker Printer", brand: "Stickerbox", line: "A kid-safe printer that turns their ideas into stickers.", href: shopmy("p-103757260"), image: "https://cdn.shopify.com/s/files/1/0683/1053/2275/files/Stickerbox_Image_3.png", store: "store-maisonette", sortPrice: 129.99, price: 129.99, commission: 16, type: "craft" },
  { name: "Tamagotchi Paradise, Jade Forest", brand: "Tamagotchi", line: "The new virtual pet with a shell that opens and a world to explore.", href: shopmy("p-109208104"), image: "https://target.scene7.com/is/image/Target/GUEST_95cd91a5-37fa-4bcd-bd20-17f394906a81", store: "store-target", sortPrice: 44.99, price: 44.99, commission: 4, type: "digital-pet" },
  // builder-guide-emibauble (owner 11-22 PM): the Melissa & Doug Kids Club Chair is off; the Pottery Barn Kids Anywhere
  // Chair with a name on it instead ("You will need to create a link": her shopmy.us/links, Pottery Barn Kids 6%). Twill,
  // from $119 on sale ($119 to $189 by size, was from $129), personalization $17 more; photo: PBK's own monogrammed
  // maroon chair.
  { name: "Pottery Barn Kids Anywhere Chair, Personalized", brand: "Pottery Barn Kids", line: "The classic kids' armchair; adding a name costs a little more.", href: shopmy("p-109292071"), image: "https://assets.pkimgs.com/pkimgs/rk/images/dp/wcm/202631/0188/anywhere-chair-maroon-twill-1-l.jpg", store: "store-pottery-barn-kids", sortPrice: 119, price: 119, priceFrom: true, commission: 6, type: "chair" },
  // LOUISIANA_ADDS_1122 (builder-guide-louisiana, owner 11-22 PM "add all items"; see the For Her block).
  { name: "The Cajun Night Before Christmas, 50th Anniversary Edition", brand: "Pelican Publishing", line: "The Cajun Christmas classic, with gators pulling the sleigh.", href: amz("1455627143"), image: amzImg("91OenSgnSoL"), store: "store-amazon", sortPrice: 19.8, commission: 4.5, type: "book" },
  // xtratuf.com through CJ at 15% (offer accepted 11-18), like the Her and Him XTRATUF rows; White Multi Blue, 11-22.
  // Its store code rides with it like every XTRATUF row (src/test/giftGuideCodesWithItem1122.test.ts).
  { name: "XTRATUF Big Kids Ankle Deck Boot, White and Blue", brand: "XTRATUF", line: "Kid-size shrimp boots for the dock, the boat and the yard.", href: xtratufCj("xkab100y"), image: "https://cdn.shopify.com/s/files/1/0676/1385/1803/files/XKAB100Y_gray_main_1400x1400_5c89e1ff-aa62-4b7d-9923-2e7b09278383.jpg", store: "store-xtratuf", sortPrice: 44.99, price: 44.99, commission: 15, type: "boots", code: "XT25", codeEnds: "2026-11-29" },
  { name: "Bleacher Creatures LSU Mike the Tiger 10\" Plush", brand: "Bleacher Creatures", line: "A soft Mike the Tiger for the littlest LSU fan.", href: amz("B08GVN1J37"), image: amzImg("71ZyAlY6CLL"), store: "store-amazon", sortPrice: 24.99, commission: 3, type: "plush" },
  { name: "Little King LSU Tigers 2-Piece Cheer Dress", brand: "Little King", line: "A purple and gold LSU cheer outfit for game day.", href: amz("B074YZWKMB"), image: amzImg("71zwV98xbtL"), store: "store-amazon", sortPrice: 48.99, commission: 4, type: "dress" },
  { name: "Wild Republic Cuddlekins Brown Pelican, 12\"", brand: "Wild Republic", line: "A cuddly brown pelican, the Louisiana state bird.", href: amz("B0792C316R"), image: amzImg("61LgH-SH+kL"), store: "store-amazon", sortPrice: 19.99, commission: 3, type: "plush" },
  { name: "Outerstuff New Orleans Saints Youth Game Day Jersey", brand: "Outerstuff", line: "A black Saints game day jersey in kids' sizes.", href: amz("B0CCBMLJM5"), image: amzImg("71R1plQu5CL"), store: "store-amazon", sortPrice: 37.99, commission: 4, type: "jersey" },
  { name: "Clovis Crawfish and His Friends, 60th Anniversary Edition", brand: "Pelican Publishing", line: "The bayou picture book classic from a Lafayette author.", href: amz("1455625639"), image: amzImg("91FSm-EacSL"), store: "store-amazon", sortPrice: 19.95, commission: 4.5, type: "book" },
  // duckcommander.com has only photos of kids wearing it; the cutout is the boy in the cream tee.
  { name: "Duck Commander Youth Happy Tee, Cream", brand: "Duck Commander", line: "A Happy Happy Happy tee from the West Monroe duck call family.", href: shopmy("p-109341055"), image: "https://cdn.shopify.com/s/files/1/0642/6565/0397/files/happy_youth_3_copy.png", store: "store-duck-commander", sortPrice: 19.99, price: 19.99, commission: 16, type: "tee" },
  { name: "Toups and Co Baby Essentials Set", brand: "Toups and Co", line: "A gentle baby wash and balm made in Walker, Louisiana.", href: shopmy("p-109341153"), image: "https://cdn.shopify.com/s/files/1/2365/4175/files/babyset_05606b9f-26df-4014-9391-07883f074367.jpg", store: "store-toups-and-co", sortPrice: 43, price: 43, commission: 10, type: "baby-care" },
  { name: "Petite Rouge: A Cajun Red Riding Hood", brand: "Mike Artell", line: "Little Red Riding Hood retold on the bayou, with a gator.", href: amz("0142500704"), image: amzImg("81V2O7O-GfL"), store: "store-amazon", sortPrice: 8.38, commission: 4.5, type: "book" },
  // end LOUISIANA_ADDS_1122
].map(dated);

/** For Him (owner via the lead, 11-22). */
export const HIM_ADDS_1122 = [
  // Batch 2 for Him (11-22): two new ShopMy links the lead had made, plus brand-sold Amazon items captured 11-22.
  { name: "Smathers & Branson Monogrammed Wallet, Hunter Green", brand: "Smathers & Branson", line: "A needlepoint wallet with his monogram stitched in.", href: shopmy("p-109208695"), image: "https://smathersandbranson.com/cdn/shop/files/Wallet_Diamond42_HunterDarkKhaki_LowRes_922ccae9-f925-49c9-a358-e627f6defab2.jpg?v=1698289893", store: "store-smathers-and-branson", sortPrice: 195, price: 195, commission: 15, type: "wallet", priceAt: "2026-11-22" },
  { name: "Marley Lilly Personalized Waxed Canvas Small Cooler", brand: "Marley Lilly", line: "A waxed canvas soft cooler with his monogram on it.", href: shopmy("p-109208941"), image: "https://marleylilly.com/cdn/shop/files/r9F-personalized-waxed-canvas-small-cooler.jpg?v=1773258733", store: "store-marley-lilly", sortPrice: 34.99, price: 34.99, commission: 8, type: "cooler", priceAt: "2026-11-22" },
  { name: "GE Profile Opal Mini Nugget Ice Maker", brand: "GE Profile", line: "Chewable pebble ice at home, ready in about 5 minutes.", href: amz("B0H51ZX6SB"), image: amzImg("712XuKiN5zL"), store: "store-amazon", sortPrice: 299, commission: 3, type: "ice-maker", priceAt: "2026-11-22" },
  // The method Men's Sea + Surf body wash (B0BT1WN3ZD) stays out: Him already has it ("Method Men Body Wash, Sea + Surf").
  // Her Nov 19 pins, batch 1 for Him (11-22). Prices are the ones on the stores' pages when her pins were checked 11-20.
  { name: "Solo Stove Bonfire Fire Pit with Stand", brand: "Solo Stove", line: "A smokeless fire pit with a stand for the backyard or camp.", href: shopmy("p-107850277"), image: "https://static.shopmy.us/uploads/pretty-prod-1781800303701", store: "store-l-l-bean", sortPrice: 299.99, price: 299.99, commission: 12, type: "fire-pit", priceAt: "2026-11-20" },
  { name: "YETI Roadie 8 Hard Cooler", brand: "YETI", line: "A compact hard cooler that fits behind the truck seat.", href: shopmy("p-107837448"), image: "https://static.shopmy.us/uploads/pretty-prod-1787796593407", store: "store-l-l-bean", sortPrice: 165, price: 165, commission: 12, type: "cooler", priceAt: "2026-11-20" },
  { name: "Muck Arctic Pro Boot", brand: "Muck Boot", line: "Warm, waterproof camo boots for cold blinds.", href: shopmy("p-107881822"), image: "https://static.shopmy.us/uploads/9f946e05-b054-4bf8-90cc-75e7b8864ba8imageye___-_imgi_54_EhmuM54AtE0slIiHX1qGxEeUxC1ppS0L-14.jpg", store: "store-the-warming-store", sortPrice: 195, price: 195, commission: 8, type: "boots", priceAt: "2026-11-20" },
  { name: "Carhartt Duck Insulated Active Jacket", brand: "Carhartt", line: "A tough, quilt-lined duck jacket that works as hard as he does.", href: shopmy("p-107847793"), image: "https://static.shopmy.us/uploads/pretty-prod-1792843758637", store: "store-cavenders", sortPrice: 129.99, price: 129.99, commission: 16, type: "jacket", priceAt: "2026-11-20" },
  { name: "Duck Commander Phil Robertson Pro Series Duck Call", brand: "Duck Commander", line: "The pro-series duck call from the Robertson family.", href: shopmy("p-107895312"), image: "https://static.shopmy.us/pins/zoom-107895312-1795118452958-2522562", store: "store-tractor-supply", sortPrice: 64.99, price: 64.99, commission: 8, type: "duck-call", priceAt: "2026-11-20" },
  { name: "Duck Commander Camo Max Mallard Hen Duck Call", brand: "Duck Commander", line: "An easy-to-blow mallard hen call in camo.", href: shopmy("p-107895486"), image: "https://static.shopmy.us/pins/zoom-107895486-1795118471935-1443301", store: "store-tractor-supply", sortPrice: 44.99, price: 44.99, commission: 8, type: "duck-call", priceAt: "2026-11-20" },
  // Her older Lake Pajamas pins (Nov 11), sent for Him on 11-22; priced on lakepajamas.com 11-22.
  { name: "Lake Men's Pima Sleep Shorts Set, True Navy", brand: "Lake", line: "A soft pima tee and shorts set for lounging.", href: shopmy("p-103892269"), image: "https://cdn.shopify.com/s/files/1/0505/6125/files/LAKE_Webcrop_Winter2025_Mens_SS_TrueNavy.jpg", store: "store-lake-pajamas", sortPrice: 138, price: 138, commission: 12, type: "pajamas" },
  // Owner via lead, 11-22: "the Battery Daddy" for Him (no ShopMy pin; Amazon with her tag, the red case with a tester).
  { name: "Ontel Battery Daddy Organizer with Tester", brand: "Ontel", line: "A clear case that holds 180 batteries and tests them.", href: amz("B089F9YDFC"), image: amzImg("91uDndg0w6L"), store: "store-amazon", sortPrice: 19.99, commission: 3, type: "organizer" },
  { name: "Lake Men's Flannel Pajama Pants, Dark Sea Windowpane", brand: "Lake", line: "Cozy flannel pajama pants in a green windowpane.", href: shopmy("p-104054474"), image: "https://static.shopmy.us/pins/zoom-104054474-1794418722190-LAKE_Webcrop_Holiday1_2026_MensFlannelPants_DarkSeaCozyWindowpane_1200x1800_bec943d7-09d7-441c-9496-61e98eb5e1bc.jpg", store: "store-lake-pajamas", sortPrice: 108, price: 108, commission: 12, type: "pajamas" },
// owner 11-22 popular via new ShopMy links (builder-guide-links)
  { name: "Le Labo Santal 33 Body Care Set", brand: "Le Labo", line: "Santal 33 shower gel and body lotion, his signature scent.", href: shopmy("p-109199365"), image: "https://static.shopmy.us/uploads/pretty-prod-1764081973367", store: "store-saks-fifth-avenue", sortPrice: 154, price: 154, commission: 12, type: "gift-set" },
  { name: "Patagonia Black Hole Duffel 40L", brand: "Patagonia", line: "The tough 40-liter duffel for trips and tailgates.", href: shopmy("p-109203985"), image: "https://static.shopmy.us/uploads/pretty-prod-1765371321083", store: "store-st-bernard", sortPrice: 159, price: 159, commission: 10, type: "luggage" },
  // The Steve Madden Natan Penny Loafer (DSW, p-109204287, $139.99) was here until the owner took it off, 11-23 ~1:01 PM.
  // Batch 3 for Him (11-22): her Nov 19 pins, photos from her pins (cutouts), prices as captured on her pins 11-19/20.
  // L.L.Bean's page could not be read headless; the sweater shows $130, the price on her pin data (lead 11-22).
  { name: "Costa Sullivan Polarized Glass Sunglasses", brand: "Costa", line: "Polarized glass lenses in a classic tortoise frame.", href: shopmy("p-108089555"), image: "https://static.shopmy.us/pins/zoom-108089555-1795142703033-wdsjzfbgxclrclcqtut4.jpg", store: "store-jomashop", sortPrice: 262, price: 262, commission: 8, type: "sunglasses", priceAt: "2026-11-19" },
  // The Duck Head 5-Panel Rope Hat (p-108090009) stays off: the 11-20 section audit took it off as sold out.
  // The Duck Camp Mallard Hat (p-108089972) waits: its photo is the Outdoors & Travel cover's, so its cutout needs its own
  // source photo (the pin's zoom image) before it can go on Him.
  { name: "L.L.Bean Men's Waterfowl Sweater", brand: "L.L.Bean", line: "A warm wool-blend quarter-zip made for cold mornings.", href: shopmy("p-108094779"), image: "https://static.shopmy.us/pins/zoom-108094779-1795143426618-237814_1225_41", store: "store-l-l-bean", sortPrice: 130, price: 130, commission: 12, type: "sweater", priceAt: "2026-11-22" },
  // LOUISIANA_ADDS_1122 (builder-guide-louisiana, owner 11-22 PM "add all items"; see the For Her block). The KREWE
  // Olivier sunglasses were here too until the owner, 11-23 ~1:00 PM: "there shouldn't be krewe sunglasses on him" (they
  // stay on For Her).
  { name: "Bayou Classic 7419 3-Gallon Cast Iron Jambalaya Pot", brand: "Bayou Classic", line: "A cast iron jambalaya pot with a lid for cook-offs.", href: amz("B0000BXHL5"), image: amzImg("71AU2JshjLL"), store: "store-amazon", sortPrice: 115.08, commission: 4.5, type: "cookware" },
  { name: "Bayou Classic 42-Inch Stainless Stir Paddle", brand: "Bayou Classic", line: "The long stainless paddle for stirring a crawfish boil.", href: amz("B000FTUTL6"), image: amzImg("51qwgICSbVL"), store: "store-amazon", sortPrice: 39.2, commission: 3, type: "boil-paddle" },
  { name: "Betts Old Salt Premium Cast Net, 4 ft", brand: "Betts", line: "A cast net for catching bait and shrimp off the dock.", href: amz("B00144CM2U"), image: amzImg("51VNqRC4hQL"), store: "store-amazon", sortPrice: 69.44, commission: 3, type: "fishing" },
  { name: "Lodge 6 Quart Essential Enamel Dutch Oven", brand: "Lodge", line: "An enameled cast iron pot made for gumbo night.", href: shopmy("p-109340963"), image: "https://cdn.shopify.com/s/files/1/0889/2707/6724/files/EC6D503G.jpg", store: "store-lodge", sortPrice: 89.9, price: 89.9, commission: 12, type: "cookware" },
  { name: "'47 New Orleans Saints Clean Up Hat", brand: "'47", line: "The classic black Saints cap with the gold fleur de lis.", href: amz("B0HG3RLK77"), image: amzImg("615-RgW5dOL"), store: "store-amazon", sortPrice: 37.99, commission: 4, type: "hat" },
  { name: "Toups and Co Men's Grooming Set", brand: "Toups and Co", line: "A shave and beard set made in Walker, Louisiana.", href: shopmy("p-108155418"), image: "https://cdn.shopify.com/s/files/1/2365/4175/files/Toupspdp1-104.jpg", store: "store-toups-and-co", sortPrice: 80, price: 80, commission: 10, type: "grooming" },
  { name: "Talk About Good II: A Toast to Cajun Food", brand: "Junior League of Lafayette", line: "More Cajun recipes from the Junior League of Lafayette.", href: amz("0935032509"), image: amzImg("71rMR09plHL"), store: "store-amazon", sortPrice: 19.95, commission: 4.5, type: "cookbook" },
  { name: "Tony Chachere's Seasoning Blends Variety, 6 Count", brand: "Tony Chachere's", line: "Six Tony's blends from Opelousas for his spice cabinet.", href: amz("B09GCYJ8RM"), image: amzImg("710W4jdiMkL"), store: "store-amazon", sortPrice: 30.79, commission: 1, type: "seasoning" },
  { name: "Zatarain's Crawfish, Shrimp & Crab Boil, 4.5 lb", brand: "Zatarain's", line: "The big bag of New Orleans boil seasoning for a crawfish boil.", href: amz("B07GG7K5SD"), image: amzImg("91RN0dk8mZL"), store: "store-amazon", sortPrice: 6.68, commission: 1, type: "seasoning" },
  { name: "Mignon Faget Fleur de Lis Cufflinks", brand: "Mignon Faget", line: "Fleur de lis cufflinks from a New Orleans jeweler.", href: shopmy("p-109342284"), image: "https://www.mignonfaget.com/mm5/graphics/00000001/0824S.png", store: "store-mignon-faget", sortPrice: 184, price: 184, priceFrom: true, commission: 9, type: "cufflinks" },
  // end LOUISIANA_ADDS_1122
].map(dated).map(rateSwitch1124); // Muck Arctic Pro: higher-commission switch 11-24 (scripts/giftGuideOwner1124.mjs)

/** Transparent cutouts for these photos (Apple Vision, scripts/gift-guide-cutout.swift; each checked by eye, 400 px). */
export const ADDS_CUTOUTS_1122 = [
  ["https://smathersandbranson.com/cdn/shop/files/Wallet_Diamond42_HunterDarkKhaki_LowRes_922ccae9-f925-49c9-a358-e627f6defab2.jpg", "sb-monogrammed-wallet-8f5ea4.webp"],
  ["https://marleylilly.com/cdn/shop/files/r9F-personalized-waxed-canvas-small-cooler.jpg", "marley-lilly-small-cooler-28604e.webp"],
  ["https://static.shopmy.us/uploads/pretty-prod-1781800303701", "solo-stove-bonfire-stand-58adad.webp"],
  ["https://static.shopmy.us/uploads/pretty-prod-1787796593407", "yeti-roadie-8-5cbb52.webp"],
  ["https://static.shopmy.us/uploads/9f946e05-b054-4bf8-90cc-75e7b8864ba8imageye___-_imgi_54_EhmuM54AtE0slIiHX1qGxEeUxC1ppS0L-14.jpg", "muck-arctic-pro-12511e.webp"],
  ["https://static.shopmy.us/uploads/pretty-prod-1792843758637", "carhartt-duck-active-jac-86b274.webp"],
  ["https://static.shopmy.us/pins/zoom-107895312-1795118452958-2522562", "duck-commander-phil-robertson-1c3c15.webp"],
  ["https://static.shopmy.us/pins/zoom-107895486-1795118471935-1443301", "duck-commander-camo-max-mallard-ce83be.webp"],
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
  // Batch 2c.
  ["https://cdn.shopify.com/s/files/1/0618/7116/1562/files/3701699309746_9835a6a3-0819-43b7-b79b-b30648cbe0e0.jpg", "diptyque-baies-candle-190g-90586c.webp"],
  ["https://static.shopmy.us/uploads/pretty-prod-1786107449401", "good-molecules-caffeine-eye-patches-b6d844.webp"],
  ["https://static.shopmy.us/pins/zoom-109155784-1795367529760-2664695", "oura-ring-5-deep-rose-5e2bdc.webp"],
  ["https://static.shopmy.us/pins/zoom-109149968-1795366797104-102988060_639_b", "drowsy-sleep-in-the-city-mask-a581ee.webp"],
  ["https://static.shopmy.us/pins/zoom-109155568-1795367501473-OC137_WT0012_m", "madewell-six-bells-nightgown-e56429.webp"],
  ["https://static.shopmy.us/pins/zoom-109151385-1795366985590-GUEST_a0e171ac-5761-42c7-83ca-b6b75eced062", "bissell-little-green-mini-4064t-956230.webp"],
  // The set's four products, cropped from its labelled photo (no labels kept).
  ["https://cdn.shopify.com/s/files/1/0512/1661/3529/files/PDP-CLEARSPACE_WIDER-FRAME_2750x3413-1.jpg", "eadem-new-classics-set-ae7614.webp"],
// owner 11-22 popular via new ShopMy links (builder-guide-links)
  ["https://static.shopmy.us/uploads/pretty-prod-1764081973367", "le-labo-santal-33-body-care-set-a1c701.webp"],
  ["https://static.shopmy.us/uploads/pretty-prod-1765371321083", "patagonia-black-hole-duffel-40l-a1c703.webp"],
  ["https://static.shopmy.us/uploads/pretty-prod-1764650851691", "steve-madden-natan-penny-loafer-a1c704.webp"],
  ["https://static.shopmy.us/uploads/pretty-prod-1765010272351", "esker-bubble-soak-a1c706.webp"],
  ["https://static.shopmy.us/pins/zoom-109208209-1795374027354-Add_a_heading_4_450x450.png", "crunchlabs-crunchinator-a1c709.webp"],
  ["https://cdn.shopify.com/s/files/1/0683/1053/2275/files/Stickerbox_Image_3.png", "stickerbox-printer-a1c70a.webp"],
  // Batch 3.
  ["https://static.shopmy.us/pins/zoom-108089555-1795142703033-wdsjzfbgxclrclcqtut4.jpg", "costa-sullivan-polarized-sunglasses-b3a1.webp"],
  ["https://static.shopmy.us/pins/zoom-108094779-1795143426618-237814_1225_41", "llbean-mens-waterfowl-sweater-b3a4.webp"],
  ["https://target.scene7.com/is/image/Target/GUEST_95cd91a5-37fa-4bcd-bd20-17f394906a81", "tamagotchi-paradise-jade-forest-a1c708.webp"],
  // builder-guide-emibauble (owner 11-22 PM).
  ["https://cdn.shopify.com/s/files/1/0267/5746/4148/files/110416_G_01_RS_SQ_2026_80d4c91e-c2d8-4a9a-a92e-491e1abec4ac.jpg", "baublebar-mini-fine-line-brush-magenta-3f1a2c.webp"],
  ["https://assets.pkimgs.com/pkimgs/rk/images/dp/wcm/202631/0188/anywhere-chair-maroon-twill-1-l.jpg", "pbk-anywhere-chair-twill-maroon-monogram-b81d5e.webp"],
  // LOUISIANA_ADDS_1122 (builder-guide-louisiana). The three Mignon Faget photos are the brand's own transparent PNGs
  // (faint reflection dropped, cropped); the rest are Apple Vision cutouts, each checked by eye.
  ["https://www.mignonfaget.com/mm5/graphics/00000001/9/7661S.png", "mignon-faget-heirloom-fleur-de-lis-pendant-la1122.webp"],
  ["https://cdn.shopify.com/s/files/1/0096/2392/files/FCO-SCLCC116WIS-SS-HR-F.jpg", "scl-47-saints-cross-cursive-clean-up-la1122.webp"],
  ["https://www.mignonfaget.com/mm5/graphics/00000001/1795B.png", "mignon-faget-oyster-large-earrings-la1122.webp"],
  ["https://static.shopmy.us/uploads/img-product-1765082316407", "katie-kime-nola-toile-lucite-tray-la1122.webp"],
  ["https://goldbelly.imgix.net/uploads/showcase_media_asset/image/259423/ChristmasKringle.jpg", "haydels-christmas-king-cake-la1122.webp"],
  ["https://cdn.shopify.com/s/files/1/2365/4175/files/MINI_BALM__0238_b3164e36-a61f-4912-8990-2a891331066f.jpg", "toups-travel-tallow-set-la1122.webp"],
  ["https://static.shopmy.us/uploads/pretty-prod-1758994986674", "match-south-warm-beignets-candle-la1122.webp"],
  ["https://cdn.shopify.com/s/files/1/2422/6603/files/Olivier-Reed-Front-Web.jpg", "krewe-olivier-reed-la1122.webp"],
  // The "New item" badge in the corner was left out by the cutout.
  ["https://cdn.shopify.com/s/files/1/0889/2707/6724/files/EC6D503G.jpg", "lodge-6qt-essential-enamel-dutch-oven-la1122.webp"],
  ["https://cdn.shopify.com/s/files/1/2365/4175/files/Toupspdp1-104.jpg", "toups-mens-grooming-set-la1122.webp"],
  ["https://www.mignonfaget.com/mm5/graphics/00000001/0824S.png", "mignon-faget-fleur-de-lis-cufflinks-la1122.webp"],
  ["https://cdn.shopify.com/s/files/1/0676/1385/1803/files/XKAB100Y_gray_main_1400x1400_5c89e1ff-aa62-4b7d-9923-2e7b09278383.jpg", "xtratuf-big-kids-ankle-deck-white-blue-la1122.webp"],
  ["https://cdn.shopify.com/s/files/1/0642/6565/0397/files/happy_youth_3_copy.png", "duck-commander-youth-happy-tee-cream-la1122.webp"],
  ["https://cdn.shopify.com/s/files/1/2365/4175/files/babyset_05606b9f-26df-4014-9391-07883f074367.jpg", "toups-baby-essentials-set-la1122.webp"],
  // end LOUISIANA_ADDS_1122
];
