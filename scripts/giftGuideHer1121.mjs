/**
 * FOR HER = THE OWNER'S SAVES (owner 2026-11-21 ~1:10 AM: "i saved alot of things for women in my amazon and in shop
 * my"; ~2:15 AM: "we can have more than 25 items its fine"). For Her holds EXACTLY these 46 picks and nothing else: 27
 * on Amazon (from her Amazon shopping list and cart) and 19 on ShopMy links (Desktop notes Her-saved-amazon-1121.md,
 * Her-saved-amazon-cart-1121.md and Her-saved-shopmy-1121.md). She picked every one herself, so none is added, dropped
 * or swapped by any rule. Owner 2026-11-22 ("remove this"): the Personalized Floral Mama Quarter Zip (Amazon B0HJVYHH35)
 * is off.
 *
 * scripts/gift-guide-picks.mjs runs applyHer1121 LAST, after the final sweep, so no earlier pass (blocklist, price cap,
 * brand cap, type cap, beauty cap, sponsor rule, men's style, standard plan) can drop or reorder these. That is the
 * owner-kept allowance, and it is narrow on purpose: it touches only the "her" page and only these rows. She kept,
 * by name (11-21): all 9 items over $100, all three face tools (ZDEER gua sha, Shark Depuffi, CurrentBody mask) and the
 * Stanley cooler (Cream at Stanley direct since 11-21). The HEYDUDE Austin Lift is banned from men's guides only.
 *
 * Page rules (owner): ONE flat list, cheapest first (no sections, no relationship chips, no codes or deals box; see
 * OWNER_LIST_GUIDES in src/content/giftGuidePeople.mjs). An Amazon pick shows the price she saw on her own saved list
 * (`sortPrice`, captured 11-21; owner 11-21 ~12:05 PM chose "Show Amazon prices anyway" after the Associates warning),
 * and its photo is Amazon's own, never edited. A ShopMy pick shows its price checked 11-21 (the page rounds it, "~$30") and its photo as a
 * transparent cutout (scripts/giftGuideCutouts1120.mjs). Each pick keeps its relationship tags (`rels`), so /mom,
 * /wife ... still build from this list.
 * Guard: src/test/giftGuideHer1121.test.ts.
 */
import { PEOPLE_GUIDES } from "../src/content/giftGuidePeople.mjs";
import { relsOf } from "./giftGuidePeople1120.mjs";
import { cutoutPhoto } from "./giftGuideCutouts1120.mjs";
import { rankByPrice } from "./giftGuidePriceRank1121.mjs";
import { ADDS_STORES_1122, HER_ADDS_1122 } from "./giftGuideOwnerAdds1122.mjs";

export const HER_GUIDE = "her";
/** The day the ShopMy prices were checked (Louisiana day). */
export const HER_PRICE_AT = "2026-11-21";
const amz = (asin) => `https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20`;
const amzImg = (id) => `https://m.media-amazon.com/images/I/${id}._SL500_.jpg`;
const shopmy = (pin) => `https://go.shopmy.us/${pin}`;

/** Stores a ShopMy pin goes to that the store list may not hold yet (key -> shown name). */
export const HER_STORES = {
  "store-jd-sports": "JD Sports", "store-sephora": "Sephora", "store-hatch": "Hatch", "store-macys": "Macy's",
  "store-haven-well-within": "Haven Well Within", "store-camp-snap": "Camp Snap", "store-rei": "REI",
  "store-the-swank-company": "The Swank Company", "store-baublebar": "BaubleBar", "store-currentbody": "CurrentBody",
  "store-anthropologie": "Anthropologie", "store-tatcha": "Tatcha", "store-iherb": "iHerb", "store-stanley": "Stanley", "store-cos-bar": "Cos Bar", "store-ulta-beauty": "Ulta Beauty",
  // owner 11-22 screenshot list (builder-guide-adds-2): her LUSH pin.
  "store-lush": "LUSH",
};

/**
 * Her saves, cheapest first (sortPrice). One row per pick, so a link swap is a one-line change. `price` on a ShopMy pick;
 * an Amazon pick shows its captured `sortPrice` (owner 11-21: "each item also needs a price").
 */
export const HER_1121 = [
  { name: "YUDSUD High Waisted Leggings", brand: "YUDSUD", line: "Soft high-waisted leggings she will live in all winter.", href: amz("B0D3L9BYFZ"), image: amzImg("31wNp8LsF5L"), store: "store-amazon", sortPrice: 6.64, commission: 4, type: "pants" },
  { name: "Yoosteel Birthstone Bracelet", brand: "Yoosteel", line: "A dainty gold-plated bracelet with her birthstone.", href: amz("B0FDKC619F"), image: amzImg("51PDHgtzHAL"), store: "store-amazon", sortPrice: 7.99, commission: 4, type: "jewelry" },
  { name: "eos Vanilla Cashmere Holiday Gift Set", brand: "eos", line: "A vanilla cashmere lotion and lip balm set, ready to gift.", href: amz("B0CWRFQCWF"), image: amzImg("71XNXXEbQEL"), store: "store-amazon", sortPrice: 10, commission: 3, type: "gift-set" },
  { name: "Personalized Embroidered Canvas Tote Bag", brand: "", line: "A canvas tote embroidered just for her.", href: amz("B0FKN7FGPY"), image: amzImg("41-9rV6lp9L"), store: "store-amazon", sortPrice: 11.99, commission: 4, type: "bag" },
  { name: "Loritta Long Plaid Winter Scarf", brand: "Loritta", line: "A long plaid scarf that doubles as a cozy wrap.", href: amz("B0C246HFWN"), image: amzImg("51J4ztPBNYL"), store: "store-amazon", sortPrice: 13.99, commission: 4, type: "scarf" },
  { name: "Kitsch Satin Pillowcase With Zipper", brand: "Kitsch", line: "A satin pillowcase that is kind to hair and skin.", href: amz("B0CCWSGSCT"), image: amzImg("81zPpWuuXHL"), store: "store-amazon", sortPrice: 15.19, commission: 3, type: "bedding" },
  // Switched 11-21 from her Sephora UK pin p-108613754 (US shoppers cannot buy there) to the same 4-sheet set at iHerb,
  // same $19, 15% (Desktop note Commission-switches-1121.md); photo is iHerb's own.
  { name: "BIODANCE Hydro Cera-Nol Real Deep Mask, 4 Pack", brand: "BIODANCE", line: "Overnight hydrogel masks she peels off to glowy skin.", href: shopmy("p-108755104"), image: "https://www.sephora.com/productimages/sku/s2865152-main-zoom.jpg", store: "store-iherb", sortPrice: 19, price: 19, commission: 15, type: "skincare" },
  { name: "Summer Fridays Tinted Lip Butter Balm", brand: "Summer Fridays", line: "The tinted lip balm everyone keeps in their bag.", href: amz("B0D82LVR3N"), image: amzImg("51s-g+euH5L"), store: "store-amazon", sortPrice: 19.2, commission: 10, type: "lip" },
  { name: "Kitsch XL Microfiber Hair Towel Wrap", brand: "Kitsch", line: "A quick-dry hair towel wrap for after the shower.", href: amz("B0CDF7GJ4Y"), image: amzImg("81h7Kvf9ttL"), store: "store-amazon", sortPrice: 19.24, commission: 3, type: "hair" },
  { name: "Amazon Essentials Women's Flannel Pajamas", brand: "Amazon Essentials", line: "Soft flannel pajamas for cold mornings.", href: amz("B08X8P91FX"), image: amzImg("71vZPpqtf5L"), store: "store-amazon", sortPrice: 20.69, commission: 4, type: "pajamas" },
  { name: "TULA Spresso Energizing Eye Balm", brand: "TULA", line: "A cooling eye balm that wakes up tired eyes.", href: amz("B0C7LTPXBV"), image: amzImg("71N7JF4XK1L"), store: "store-amazon", sortPrice: 22.8, commission: 10, type: "skincare" },
  { name: "nodpod Weighted Sleep Mask", brand: "nodpod", line: "A gently weighted eye mask that helps her drift off.", href: amz("B0B1RWJ4QJ"), image: amzImg("31+H+LGa0OL"), store: "store-amazon", sortPrice: 28.5, commission: null, type: "sleep-mask" },
  { name: "Tyler Candle Company Diva Glamorous Gift Suite", brand: "Tyler Candle Company", line: "The Diva scent in a candle gift set.", href: amz("B0D7TR9PBZ"), image: amzImg("718bvTOBovL"), store: "store-amazon", sortPrice: 28.68, commission: 3, type: "candle" },
  // COMMISSION SWITCH 11-21 (owner: "if the items on the guides can we fund at another place for higher commison just
  // change the link"): was Amazon B08D3FXF64 at 10%; same jar, same $29 at Tatcha (direct) at 20%.
  { name: "TATCHA Kissu Lip Mask", brand: "TATCHA", line: "An overnight lip mask for soft lips.", href: shopmy("p-108732256"), image: "https://cdn.shopify.com/s/files/1/0949/3328/7221/files/TheKissuLipMask-pdp-Aug26-Omi-FullSize-MainImage-1200x1200.jpg", store: "store-tatcha", sortPrice: 29, price: 29, commission: 20, type: "lip" },
  { name: "Owala FreeSip 24 oz Bottle, Open Air", brand: "Owala", line: "The leak-proof bottle she can sip or swig from.", href: shopmy("p-108613192"), image: "https://static.shopmy.us/pins/zoom-108613192-1795240422444-C07940_450", store: "store-jd-sports", sortPrice: 29.99, price: 29.99, commission: 15, type: "drinkware" },
  { name: "Bedsure Bubble Faux Fur Christmas Throw Blanket", brand: "Bedsure", line: "A fluffy faux fur throw for the couch.", href: amz("B0F5N7S36V"), image: amzImg("91HJeXmiufL"), store: "store-amazon", sortPrice: 32.48, commission: 3, type: "throw-blanket" },
  { name: "JEIBKOUY Oversized Camo Hoodie, Maple Leaf", brand: "JEIBKOUY", line: "An oversized camo hoodie with a maple leaf print.", href: amz("B0FFMJMB6K"), image: amzImg("41tsU8jZI3L"), store: "store-amazon", sortPrice: 32.99, commission: 4, type: "sweatshirt" },
  { name: "Anoumcy Leopard Barrel Joggers", brand: "Anoumcy", line: "Leopard barrel-leg joggers that feel like sweats.", href: amz("B0FVFV7V1R"), image: amzImg("814X2uIfEUL"), store: "store-amazon", sortPrice: 33.14, commission: 4, type: "pants" },
  { name: "Sol de Janeiro Cheirosa Sol & Go Mini Perfume Mist", brand: "Sol de Janeiro", line: "A mini perfume mist in a best-loved scent.", href: amz("B0H42QZ8BW"), image: amzImg("71uJ6m6sS1L"), store: "store-amazon", sortPrice: 36, commission: 10, type: "fragrance" },
  { name: "ZDEER GS5 Heated Gua Sha Tool", brand: "ZDEER", line: "A heated gua sha with red light for a spa night in.", href: amz("B0FPCH9S11"), image: amzImg("31iCM-w+Z6L"), store: "store-amazon", sortPrice: 39.99, commission: 3, type: "beauty-device" },
  // CODE WITH THE ITEM (owner 2026-11-21 9:58 PM: "you can put the code with the item but no we dont need a long list of
  // codes on each guide only if we have a code should you put it with the items"): her Camp Snap code LEXILOMBAS7, 7% off
  // campsnapphoto.com, where this link goes; active with no end date in her ShopMy Discount Codes (ShopMy-codes-1121-night.md).
  { name: "Camp Snap CS-8 Micro Video Camera Keychain, Blind Box", brand: "Camp Snap", line: "A tiny video camera on a keychain, color a surprise.", href: shopmy("p-108611500"), image: "https://cdn.shopify.com/s/files/1/0744/7383/2752/files/header_d29d6334-ecd6-41de-ad9f-68ae82d94846.png", store: "store-camp-snap", sortPrice: 39.99, price: 39.99, commission: 10, type: "accessory", code: "LEXILOMBAS7" },
  // COMMISSION SWITCH 11-21: was Amazon B0HFYLTJR7 at 10%; same boxed set, same $40 at Anthropologie at 15%.
  { name: "L'OCCITANE Shea Butter Classics Gift Set", brand: "L'OCCITANE", line: "Shea butter hand and body care, ready to give.", href: shopmy("p-108732809"), image: "https://images.urbndata.com/is/image/Anthropologie/114587041_030_b2", store: "store-anthropologie", sortPrice: 40, price: 40, commission: 15, type: "gift-set" },
  { name: "HEYDUDE Austin Lift Platform Mule", brand: "HEYDUDE", line: "Easy slip-on platform mules for everyday errands.", href: amz("B0CPB1MWMP"), image: amzImg("315u2EGcJpL"), store: "store-amazon", sortPrice: 44.99, commission: null, type: "shoes" },
  { name: "Trendy Queen Mock Neck 2 Piece Sweat Set", brand: "Trendy Queen", line: "A matching mock neck sweat set for travel days.", href: amz("B0H2D9Q7CV"), image: amzImg("61-DZ19Gx3L"), store: "store-amazon", sortPrice: 48.99, commission: 4, type: "matching-set" },
  { name: "BaubleBar Fallon 14K Gold Bezel Earrings", brand: "BaubleBar", line: "Gold bezel drop earrings that go with everything.", href: shopmy("p-108607824"), image: "https://static.shopmy.us/uploads/adc16a77-2764-49c6-8995-55c0e42754c9_s-blob-v1-IMAGE-DBeu-uRDNQQ.png", store: "store-baublebar", sortPrice: 64, price: 64, commission: 20, type: "jewelry" },
  { name: "Ember Mug 2, Brown", brand: "Ember", line: "A heated mug that keeps her coffee hot to the last sip.", href: shopmy("p-108613356"), image: "https://static.shopmy.us/pins/zoom-108613356-1795240468332-17103719_fpx.tif", store: "store-macys", sortPrice: 89.99, price: 89.99, commission: 16, type: "mug" },
  { name: "Lola Blankets Original Throw Blanket", brand: "Lola Blankets", line: "The famously soft Lola throw for couch nights.", href: shopmy("p-108604054"), image: "https://static.shopmy.us/uploads/346f926f-f41b-444e-b686-921455d30264_74A53B12-D898-44DD-8ADB-BBB0CD895907.jpg", store: "store-anthropologie", sortPrice: 135, price: 135, commission: 15, type: "throw-blanket" },
  // Owner 11-21 (pop-up): switched from the purple one at REI (p-108610992, $140, 8%) to Cream at Stanley direct, on sale
  // $105 through Nov 30, 18% (her new ShopMy link p-108831058; her older Stanley pin p-107863923 goes to a sold-out listing).
  { name: "Stanley All Day Julienne Midi Cooler, Cream", brand: "Stanley", line: "A soft cooler bag for tailgates and beach days.", href: shopmy("p-108831058"), image: "https://cdn.shopify.com/s/files/1/0375/3269/6635/files/Web_PNG_Square-The_All-Day_Julienne_Midi_Cooler_12QT_-_Cream_-_Front.png", store: "store-stanley", sortPrice: 105, price: 105, commission: 18, type: "cooler" },
  // Switched 11-21 from her Sephora UK pin (US shoppers cannot use it) to her existing SharkNinja US pin. Her Ulta pin (13%) would pay more.
  { name: "Shark Depuffi Hot & Cold Face Sculpting Tool", brand: "Shark", line: "A hot and cold face tool that depuffs in minutes.", href: shopmy("p-107555566"), image: "https://asset.sephora.co.uk/img/prod/pid/P1000211062/114692_media_principal_extendedaten_gb_0_extended_06-05-26-09-52-04.jpg", store: "store-sharkninja", sortPrice: 149.99, price: 149.99, commission: 8, type: "beauty-device" },
  { name: "On Cloud 6 Sneakers, Glacier/White", brand: "On", line: "Light, cushioned sneakers for walks and long days.", href: shopmy("p-108613972"), image: "https://static.shopmy.us/pins/zoom-108613972-1795240704146-3MF10070_050", store: "store-jd-sports", sortPrice: 160, price: 160, commission: 15, type: "shoes" },
  // OWNER SWAP PENDING (11-21): The Swank Company is out of Cape Taupe; replace the href with her YETI pin (and the store with store-yeti).
  // NIGHT LINK 11-21 (Commission-links-1121-night.md): Swank (15%) is out of Cape Taupe, so it paid $0 for the pictured color;
  // REI has Cape Taupe at $160, 8% (p-109006074). Same photo.
  { name: "YETI Camino 35 Carryall Tote, Cape Taupe", brand: "YETI", line: "A tough carryall tote for the beach, boat or groceries.", href: shopmy("p-109006074"), image: "https://static.shopmy.us/uploads/pretty-prod-1787425474692", store: "store-rei", sortPrice: 160, price: 160, commission: 8, type: "bag" },
  { name: "Hatch Restore 3, Putty", brand: "Hatch", line: "A sunrise alarm and sound machine for calmer mornings.", href: shopmy("p-108613500"), image: "https://static.shopmy.us/pins/zoom-108613500-1795240519319-R3_Putty.jpg", store: "store-hatch", sortPrice: 169.99, price: 169.99, commission: 15, type: "clock" },
  { name: "UGG Goldenstar Evelina Clog, Beige", brand: "UGG", line: "Fuzzy-lined UGG clogs she can slip on and go.", href: shopmy("p-108604684"), image: "https://static.shopmy.us/pins/zoom-108604684-1795237968140-108971391_025_b", store: "store-anthropologie", sortPrice: 175, price: 175, commission: 15, type: "shoes" },
  // SWITCHED 11-21 night (Commission-audit-1121-night.md, via lead): her pin p-108612982 went to Haven Well Within, which
  // has no Theragun ("Page Not Found", so $0); her existing Ulta link p-107903671 (13%, $154.99 on 11-21) is the same
  // Theragun Mini, and Ulta lists the Desert Rose shown here, so the photo and the Her cover stay.
  { name: "Therabody Theragun Mini", brand: "Therabody", line: "A pocket massage gun for sore shoulders and legs.", href: shopmy("p-107903671"), image: "https://static.shopmy.us/pins/zoom-108612982-1795240352615-253765107_0435.jpg", store: "store-ulta-beauty", sortPrice: 154.99, price: 154.99, commission: 13, type: "massager" },
  { name: "CurrentBody LED Red Light Therapy Face Mask", brand: "CurrentBody", line: "An LED red light mask for skin care at home.", href: shopmy("p-108605514"), image: "https://static.shopmy.us/uploads/pretty-prod-1789545457784", store: "store-currentbody", sortPrice: 469.99, price: 469.99, commission: 10, type: "beauty-device" },
  // Owner 11-21 ("same, kids should be all of my saves. women too. they all need to have prices"): the rest of her Amazon
  // cart and saved-for-later (Her-saved-amazon-cart-1121.md), at her capture's price; the Marshall speaker and Sampeel
  // set had no photo in the capture and were read on Amazon 2026-11-21. Left out: the second ZDEER GS5 listing
  // (B0FX7WH9DJ, the same gua sha as above) and Hero Mighty Patch (B074PVTPBW: pimple patches are on the not-a-gift list,
  // scripts/giftGuideRules.mjs NOT_A_GIFT_ITEM; the owner can say to add it).
  { name: "Maybelline Mascara Holiday Gift Set", brand: "Maybelline", line: "A best-selling mascara in a holiday gift set.", href: amz("B0HJ9ZJ8KM"), image: amzImg("81jCLp4vnML"), store: "store-amazon", sortPrice: 6.99, commission: 3, type: "makeup" },
  { name: "Good Molecules Yerba Mate Wake Up Eye Gel", brand: "Good Molecules", line: "A cooling eye gel for tired mornings.", href: amz("B091NJQ29P"), image: amzImg("71QsFtfDUCL"), store: "store-amazon", sortPrice: 4.77, commission: 3, type: "skincare" },
  { name: "e.l.f. Glow Reviver Lip Oil", brand: "e.l.f.", line: "A glossy tinted lip oil she will keep in every bag.", href: amz("B0CMJZVT5P"), image: amzImg("610BzlDTpDL"), store: "store-amazon", sortPrice: 9, commission: 3, type: "lip" },
  { name: "Hobo Bag, Small Everyday Purse", brand: "", line: "A slouchy everyday shoulder bag.", href: amz("B0G6CR9TGW"), image: amzImg("71BdMf6S+zL"), store: "store-amazon", sortPrice: 18.56, commission: 4, type: "bag" },
  { name: "Anua Salmon DNA PDRN Glow Essential Starter Kit", brand: "Anua", line: "A Korean skincare starter kit for glowy skin.", href: amz("B0FSJQ3KJT"), image: amzImg("71YVdkGE+YL"), store: "store-amazon", sortPrice: 20, commission: 3, type: "skincare" },
  { name: "Summer Fridays Jet Lag Hydrating Eye Patches", brand: "Summer Fridays", line: "Hydrating eye patches for a quick refresh.", href: amz("B0F19YY96Z"), image: amzImg("61zGRUYBPzL"), store: "store-amazon", sortPrice: 24, commission: 10, type: "skincare" },
  { name: "Sampeel Two Piece Lounge Set, Brown Stripe", brand: "Sampeel", line: "A matching mock neck lounge set for travel days.", href: amz("B0GT3W5DQL"), image: amzImg("71KJvzDkkzL"), store: "store-amazon", sortPrice: 27.99, commission: 4, type: "matching-set" },
  // RATE SWITCH 11-21 night (Commission-rates-search-1121-night.md): was Amazon B0H2G28G12 at 10% ($45); the same Saffron &
  // Cedar 100 ml mist at Cos Bar at 20% (p-109002459), $45, in stock. Photo: cosbar.com's own bottle shot.
  { name: "Salt & Stone Hair & Body Spray", brand: "Salt & Stone", line: "A clean hair and body fragrance mist.", href: shopmy("p-109002459"), image: "https://cdn.shopify.com/s/files/1/0618/7116/1562/files/850073050828_1.png", store: "store-cos-bar", sortPrice: 45, price: 45, commission: 20, type: "fragrance" },
  // RATE SWITCH 11-21 night (Commission-rates-search-1121-night.md): was Amazon B0HFXZ9F46 at 10% ($59); the same 2026
  // green-box trio at Ulta at 13% (p-109002206), $59. Photo: Ulta's own transparent photo (alpha kept, no Vision pass).
  { name: "L'OCCITANE Softening Almond Trio", brand: "L'OCCITANE", line: "Almond shower oil and body care, ready to give.", href: shopmy("p-109002206"), image: "https://media.ulta.com/i/ulta/2661577?w=1000&fmt=png", store: "store-ulta-beauty", sortPrice: 59, price: 59, commission: 13, type: "gift-set" },
  // NIGHT LINK 11-21 (Commission-links-1121-night.md): was Amazon B0CVLJ85KP at 4% ($99); the same Sepia Dylan at crocs.com,
  // 10% (p-108985937), $35.00 Doorbuster on 11-21 (was $64.99). Photo: crocs.com's own transparent Sepia shot.
  { name: "Crocs Dylan Platform Clog", brand: "Crocs", line: "Comfy platform clogs for everyday errands.", href: shopmy("p-108985937"), image: "https://media.crocs.com/images/t_standard/products/209869_2EY_ALT140-Transparent/crocs", store: "store-crocs", sortPrice: 35, price: 35, commission: 10, type: "shoes" },
  { name: "Marshall Emberton III Bluetooth Speaker, Cream", brand: "Marshall", line: "A rugged, waterproof speaker with big sound.", href: amz("B0DT1CZ58V"), image: amzImg("81gRxBMDtdL"), store: "store-amazon", sortPrice: 119.99, commission: 3, type: "speaker" },
  // owner 11-22 screenshot list (builder-guide-adds-2)
  // Owner 2026-11-22, sending creators' gift lists as screenshots (~/.lh-shots/owner-screens-1122/): "Add these for her if
  // we don't have them yet." The same product only (model and color matched to the picture); a near-duplicate of a pick
  // already here is listed for her in the Desktop note Owner-adds-1122-screens.md, not added. Her ShopMy link first, else
  // Amazon (its own photo); every price read on the store's own page 2026-11-22 (priceAt), each non-Amazon photo a cutout.
  { name: "Pilot G2 Gel Pens, Black, 4 Pack", brand: "Pilot", line: "Smooth gel pens for charting, since hers always walk off.", href: amz("B0030F32L6"), image: amzImg("61evtVtnVTS"), store: "store-amazon", sortPrice: 7.99, commission: 4.5, type: "stationery", priceAt: "2026-11-22" },
  { name: "L'Oréal Paris EverPure Glossing Lamination Hair Mask", brand: "L'Oréal Paris", line: "A five-minute mask for glossy, smooth hair.", href: amz("B0DKG9CMH8"), image: amzImg("61hStalP0LL"), store: "store-amazon", sortPrice: 9.97, commission: 3, type: "hair", priceAt: "2026-11-22" },
  { name: "Just a Few Things I Love About You, Mom", brand: "", line: "A fill-in book of all the reasons you love her.", href: amz("B0GSMJTZJJ"), image: amzImg("61yk6HHLMJL"), store: "store-amazon", sortPrice: 17.99, commission: 4.5, type: "book", priceAt: "2026-11-22" },
  { name: "Loop Quiet 2 Ear Plugs, Black", brand: "Loop", line: "Soft, reusable earplugs for sleeping after a night shift.", href: amz("B0D3V61JC8"), image: amzImg("51vun8qtNlL"), store: "store-amazon", sortPrice: 19.95, commission: 3, type: "earplugs", priceAt: "2026-11-22" },
  // Her Comrad pin (15%); the picture's sock brand cannot be read, so her nurse-favorite pair.
  { name: "Comrad Knee-High Compression Socks, Black", brand: "Comrad", line: "Comfy compression socks for 12-hour shifts on her feet.", href: shopmy("p-103899561"), image: "https://cdn.shopify.com/s/files/1/0748/9440/9945/files/KHC-SL001-Solid-Nylon_black_flat-lil_9d810510-219a-4814-b64d-88c4c206413e.jpg", store: "store-comrad-socks", sortPrice: 34, price: 34, commission: 15, type: "socks", priceAt: "2026-11-22" },
  { name: "Pura 4 Smart Fragrance Diffuser Starter Set", brand: "Pura", line: "A smart plug-in diffuser that keeps home smelling fresh.", href: amz("B0CSV71DJV"), image: amzImg("61q2udtvkQL"), store: "store-amazon", sortPrice: 54.58, commission: 3, type: "diffuser", priceAt: "2026-11-22" },
  // Amazon Luxury Beauty (sold by Kérastase): 10%.
  { name: "Kérastase Elixir Ultime L'Huile Originale Hair Oil", brand: "Kérastase", line: "A few drops leave hair shiny and soft.", href: amz("B0D2LV7DHF"), image: amzImg("611pNf2nqML"), store: "store-amazon", sortPrice: 64, commission: 10, type: "hair", priceAt: "2026-11-22" },
  // Amazon has the chocolate tube with the copper chestpiece in the picture; her Uniform Advantage pins (10%) do not.
  { name: "Littmann Classic III Stethoscope, Chocolate and Copper", brand: "Littmann", line: "The classic nurse stethoscope in chocolate and copper.", href: amz("B00PCQW4P6"), image: amzImg("61wfZ+EP1HL"), store: "store-amazon", sortPrice: 91.82, commission: 4, type: "stethoscope", priceAt: "2026-11-22" },
  // Her Zappos pin (12%) at the same $99.95 Amazon asks (4%).
  { name: "UGG Scuffette II Slipper, Chestnut", brand: "UGG", line: "Cozy UGG slippers to kick on after a long shift.", href: shopmy("p-104053242"), image: "https://static.shopmy.us/pins/zoom-104053242-1794418576037-71G1Ib2Cp8L._SR960%252C720_.jpg", store: "store-zappos", sortPrice: 99.95, price: 99.95, commission: 12, type: "shoes", priceAt: "2026-11-22" },
  { name: "Kindle Paperwhite 16GB, Black", brand: "Amazon", line: "A glare-free e-reader for books on every break.", href: amz("B0CFPJYX7P"), image: amzImg("61KMlIaN9pL"), store: "store-amazon", sortPrice: 129.99, commission: 4, type: "e-reader", priceAt: "2026-11-22" },
  // Owner 2026-11-22 ("Keep only Oura"): the Ultrahuman Ring PRO (B0H1N3TWP1, $379) is off; the Oura Ring 5 is on Her instead.
  { name: "Mrs. Meyer's Clean Day Multi-Surface Cleaner, Lemon Verbena", brand: "Mrs. Meyer's", line: "The lemon verbena counter spray that smells so good.", href: amz("B000S5VEA2"), image: amzImg("61JZw9Z1htL"), store: "store-amazon", sortPrice: 4.33, commission: 3, type: "cleaning", priceAt: "2026-11-22" },
  { name: "Downy Unstopables Scent Beads, No. 26", brand: "Downy", line: "Scent beads that keep laundry smelling fresh.", href: amz("B0FGDQ5BT9"), image: amzImg("71BGHg5CjYL"), store: "store-amazon", sortPrice: 9.97, commission: 3, type: "cleaning", priceAt: "2026-11-22" },
  // Amazon sells 3, 5, 7 and 9 counts (the picture is a store 4-pack); the 5 count.
  { name: "Scrub Mommy Dual-Sided Sponges, 5 Count", brand: "Scrub Daddy", line: "Smiley scrub sponges that make dishes go faster.", href: amz("B0DN245D58"), image: amzImg("71cWmgZ-09L"), store: "store-amazon", sortPrice: 15.19, commission: 3, type: "cleaning", priceAt: "2026-11-22" },
  // The seller in the video is not named: the closest match by eye (burgundy croc, gold script name, gold zipper).
  { name: "Personalized Croc Makeup Bag, Burgundy", brand: "", line: "A croc-embossed makeup bag with her name stitched on.", href: amz("B0HN76TWQ2"), image: amzImg("81Htl6CNznL"), store: "store-amazon", sortPrice: 15.99, commission: 4, type: "bag", priceAt: "2026-11-22" },
  // The 5K Nano with the fold-out USB-C plug, as pictured (black; the blue listing could not be read today).
  { name: "Anker Nano Power Bank, 5,000mAh, 22.5W", brand: "Anker", line: "A tiny power bank that plugs right into her phone.", href: amz("B0C6XK77HJ"), image: amzImg("61G6PTRL9PL"), store: "store-amazon", sortPrice: 21.99, commission: 4, type: "tech-accessory", priceAt: "2026-11-22" },
  { name: "Stanley Adventure To-Go Food Jar, 18 oz, Frost", brand: "Stanley", line: "An insulated jar that keeps lunch hot all shift.", href: amz("B0D858S2H5"), image: amzImg("51gRES7A7RL"), store: "store-amazon", sortPrice: 22.5, commission: 4.5, type: "food-jar", priceAt: "2026-11-22" },
  // Her Sephora pin (12%) is about $30, $6 more than Amazon's $24.
  { name: "Dae Cactus Fruit 3-in-1 Styling Cream", brand: "Dae", line: "A styling cream that smooths frizz and adds shine.", href: amz("B0BLWTQ7JC"), image: amzImg("51M3SIxVmbL"), store: "store-amazon", sortPrice: 24, commission: 3, type: "hair", priceAt: "2026-11-22" },
  { name: "JAANUU Regen Cotton Underscrub, Midnight Navy", brand: "JAANUU", line: "A soft organic cotton layer to wear under scrubs.", href: amz("B0F831FK2R"), image: amzImg("81+A+w04Q2L"), store: "store-amazon", sortPrice: 34, commission: 4, type: "scrubs", priceAt: "2026-11-22" },
  { name: "Stoggles Rectangle Safety Glasses, Denim", brand: "Stoggles", line: "Anti-fog safety glasses that actually look cute.", href: amz("B0B22SZ3W8"), image: amzImg("51nDh3GXHsL"), store: "store-amazon", sortPrice: 42, commission: 4, type: "eyewear", priceAt: "2026-11-22" },
  { name: "Downoop Hot Towel Dispenser Warmer, White", brand: "Downoop", line: "A hot face towel in seconds, right on the nightstand.", href: amz("B0H69TGK2F"), image: amzImg("61Fxl0VD48L"), store: "store-amazon", sortPrice: 73.94, commission: 3, type: "beauty-device", priceAt: "2026-11-22" },
  { name: "Marc Jacobs Daisy Love Eau de Toilette, 1.7 oz", brand: "Marc Jacobs", line: "A sweet, soft floral perfume in the daisy-cap bottle.", href: amz("B07CDF1RVV"), image: amzImg("51U10-bOlWL"), store: "store-amazon", sortPrice: 112, commission: 3, type: "fragrance", priceAt: "2026-11-22" },
  // Her Best Buy pin (8%) looked $30+ dearer today.
  { name: "Skylight Calendar 2, 15 in., White", brand: "Skylight", line: "A touchscreen family calendar everyone can see.", href: amz("B0G618GK4S"), image: amzImg("7102yMFM5oL"), store: "store-amazon", sortPrice: 269.99, commission: 3, type: "calendar", priceAt: "2026-11-22" },
  // IPL5157 as pictured (two heads, pouch, Venus razor); the same device without the razor (IPL5137) is $279.99.
  { name: "Braun Silk-expert Pro 5 IPL with Pouch and Venus Razor", brand: "Braun", line: "At-home IPL hair removal, with a pouch and a razor.", href: amz("B09WG9R7MY"), image: amzImg("81gm9rlIOzL"), store: "store-amazon", sortPrice: 419.99, commission: 3, type: "beauty-device", priceAt: "2026-11-22" },
  // Her ShopMy pins (11-19 links), each a cutout of the store's or brand's own photo.
  { name: "Touchland Power Mist Hand Sanitizer, Vanilla Blossom", brand: "Touchland", line: "A hydrating hand sanitizer mist with a soft vanilla scent.", href: shopmy("p-103903056"), image: "https://cdn.shopify.com/s/files/1/0027/5395/3862/files/Desktop_VanillaBlossom_ProductCard.jpg", store: "store-ulta-beauty", sortPrice: 10, price: 10, commission: 13, type: "hand-care", priceAt: "2026-11-22" },
  { name: "LUSH Turmeric Latte Massage Bar", brand: "LUSH", line: "A solid massage bar that melts into warm, soft skin.", href: shopmy("p-103891549"), image: "https://cdn.shopify.com/s/files/1/0751/1575/7852/files/turmeric_latte_massage.jpg", store: "store-lush", sortPrice: 16, price: 16, commission: 6, type: "lotion", priceAt: "2026-11-22" },
  // The Medium (her pin); Zappos's Black Friday price, $39.95 regular.
  { name: "L.L.Bean Boat and Tote, Medium, Regatta Blue", brand: "L.L.Bean", line: "The classic canvas tote that carries everything.", href: shopmy("p-107936463"), image: "https://cdni.llbean.net/is/image/wim/112636_30509_41", store: "store-zappos", sortPrice: 32.95, price: 32.95, commission: 12, type: "bag", priceAt: "2026-11-22" },
  { name: "lululemon Everywhere Belt Bag 1L, Black", brand: "lululemon", line: "The hands-free belt bag for keys, phone and badge.", href: shopmy("p-103882819"), image: "https://static.shopmy.us/uploads/pretty-prod-1764601745022", store: "store-lululemon", sortPrice: 38, price: 38, commission: 12, type: "bag", priceAt: "2026-11-22" },
  // xtratuf.com through her CJ link (15%, as on Him); XTRATUF's own sitewide code XT25 takes it to $97.50 through Nov 29.
  { name: "XTRATUF Women's Camp Fleece Lined Ankle Deck Boot, Bone White/Dark Olive", brand: "XTRATUF", line: "A fleece-lined deck boot for cold, muddy mornings.", href: "https://www.anrdoezrs.net/click-101930553-15735628?url=https%3A%2F%2Fxtratuf.com%2Fproducts%2Fxwadbc10", image: "https://cdn.shopify.com/s/files/1/0676/1385/1803/files/XWADBC10.jpg", store: "store-xtratuf", sortPrice: 130, price: 130, commission: 15, type: "boots", code: "XT25", codeEnds: "2026-11-29", priceAt: "2026-11-22" },
  { name: "L.L.Bean Signature Original Cotton Rollneck Sweater, Cream Dog", brand: "L.L.Bean", line: "A soft cotton rollneck with a sweet bird-dog design.", href: shopmy("p-107936513"), image: "https://cdni.llbean.net/is/image/wim/520696_48183_41", store: "store-zappos", sortPrice: 130, price: 130, commission: 12, type: "pullover", priceAt: "2026-11-22" },
  { name: "L.L.Bean Adirondack Barn Coat, Flannel-Lined, Dark Khaki", brand: "L.L.Bean", line: "A classic flannel-lined barn coat with a cord collar.", href: shopmy("p-107936484"), image: "https://cdni.llbean.net/is/image/wim/267093_129_41", store: "store-zappos", sortPrice: 150, price: 150, commission: 12, type: "jacket", priceAt: "2026-11-22" },
  // Anthropologie sells only the women's Bondi 9 (HOKA's own white pair photo).
  { name: "HOKA Bondi 9 Women's Sneakers, White", brand: "HOKA", line: "Cloud-soft sneakers for long days on her feet.", href: shopmy("p-107887741"), image: "https://dms.deckers.com/hoka/image/upload/t_product-xlarge-wp/v1/1162012-WWH_1.png", store: "store-anthropologie", sortPrice: 175, price: 175, commission: 15, type: "shoes", priceAt: "2026-11-22" },
];

// owner 11-22 popular approved (builder-guide-popular): Amazon listings sold by Amazon.com or the brand, prices read 11-22.
const popular = (asin, sortPrice, img, name, brand, type, commission, line) =>
  ({ name, brand, line, href: amz(asin), image: amzImg(img), store: "store-amazon", sortPrice, commission, type });
export const HER_POPULAR_1122 = [
  popular("B0GGTPW6Q9", 119.99, "61gxq-CHHrL", "Shark ChillPill 3-in-1 Personal Cooling Fan", "Shark", "personal-fan", 3, "A pocket cooling fan for hot flashes and hot days."),
  popular("B0HJ9ZXCSD", 329, "61YX4bH7zaL", "Apple Watch Series 12, GPS 42mm", "Apple", "smartwatch", 1, "The newest Apple Watch for workouts and texts."),
  popular("B0DWHDM15Q", 69, "81AV7BtkRvL", "The Ridge 20W Magnetic Power Bank", "The Ridge", "power-bank", 4, "A slim magnetic charger that snaps onto her phone."),
  popular("B0F41DGFXT", 42.49, "61+YocOS65L", "Matador Global Travel Adapter", "Matador", "travel-adapter", 4, "One adapter for plugs in every country."),
  popular("B0BGQT41ZZ", 42.49, "419M2kqpsCL", "TRUFF Chef Starter Kit, Set of 3", "TRUFF", "gift-set", 4, "Three truffle hot sauces in one set."),
];

const isAmazon = (p) => p.store === "store-amazon" || /^https:\/\/(www\.)?amazon\.com\//.test(p.href);

/** Her 11-21 saves plus the picks she sent on launch day (scripts/giftGuideOwnerAdds1122.mjs). */
export const HER_ROWS = [...HER_1121, ...HER_ADDS_1122, ...HER_POPULAR_1122];

/** The page rows: cheapest first, every pick priced (Amazon too, owner 11-21), cutout photos, relationship tags, no section. */
export function her1121Picks(rows = HER_ROWS) {
  const g = PEOPLE_GUIDES.find((x) => x.slug === HER_GUIDE);
  return rankByPrice(rows).map(({ row: r, priceRank }) => {
    const { sortPrice: _sp, price, ...rest } = r;
    const p = { ...rest, image: isAmazon(r) ? r.image : cutoutPhoto(r.image), ownerPick: true, from: HER_GUIDE, priceRank };
    // AMAZON PRICES ON (owner 2026-11-21 ~12:05 PM: "each item also needs a price"; warned in a pop-up that Amazon only
    // allows prices from its PA-API feed and that showing them risks the Associates account, she chose "Show Amazon
    // prices anyway"). An Amazon pick shows the price captured from her own saved list that morning (sortPrice, the
    // Desktop notes); a ShopMy pick its checked price. A row with no captured price shows none.
    const shown = isAmazon(r) ? r.sortPrice : price;
    if (typeof shown === "number" && shown > 0) Object.assign(p, { price: shown, priceAt: r.priceAt ?? HER_PRICE_AT });
    return { ...p, rels: relsOf(g, p) };
  });
}

/** Replaces the For Her page with the owner's saves (and names any store the list lacks). Returns what it did. */
export function applyHer1121(pageList, storeList) {
  const had = new Set((pageList[HER_GUIDE] ?? []).map((p) => p.href));
  const before = had.size;
  pageList[HER_GUIDE] = her1121Picks();
  // On the second call (after the final sweep), any of hers a later pass took off, put back here.
  const putBack = pageList[HER_GUIDE].filter((p) => !had.has(p.href)).map((p) => p.name);
  const addedStores = [];
  for (const p of pageList[HER_GUIDE]) {
    if (p.store === "store-amazon" || storeList[p.store]) continue;
    storeList[p.store] = { name: HER_STORES[p.store] ?? ADDS_STORES_1122[p.store] ?? p.store, hosts: [new URL(p.href).hostname] };
    addedStores.push(p.store);
  }
  for (const p of pageList[HER_GUIDE]) {
    const s = storeList[p.store];
    const host = new URL(p.href).hostname;
    if (s && p.store !== "store-amazon" && !s.hosts.includes(host)) s.hosts = [...s.hosts, host].sort();
  }
  return { before, after: pageList[HER_GUIDE].length, addedStores, putBack };
}
