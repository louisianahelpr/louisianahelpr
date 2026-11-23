/**
 * FOR HIM and FOR KIDS = THE OWNER'S SAVES (owner 2026-11-21 ~2:15 AM: "i also added the mens stuff to the amazon men
 * list"; ~2:45 AM: "i did kids too in amazon list"; ~2:47 AM: "add all oft he things to the guides. fix them how you
 * see fit. launch the 3 guides"). Both pages hold ONLY picks she saved herself, from her Amazon lists (Desktop notes
 * Him-saved-amazon-1121.md and Kids-saved-amazon-1121.md) and her ShopMy links (below), tidied by her standing rules: at
 * most 2 of one brand and 2 of one item type per page, men in classic colors, no Louisiana brands, cheaper first.
 *
 * HER SHOPMY SAVES 11-21 (owner ~2:45 AM: "i also added some man and kids stuff in shop my"; later: "the him and kids
 * need gifts on their covers"): HIM_SHOPMY_1121 and KIDS_SHOPMY_1121 add the ones her rules keep (Desktop notes
 * Him-saved-shopmy-1121.md and Kids-saved-shopmy-1121.md; nothing out of stock; LSU allowed since the owner's 11-21 PM "You can list LSU stuff"). Their non-Amazon photos are
 * what the Him and Kids covers draw.
 *
 * scripts/gift-guide-picks.mjs runs applyHimKids1121 LAST, next to applyHer1121, so no earlier pass can drop or reorder
 * these. Page rules are the same as For Her (scripts/giftGuideHer1121.mjs): ONE flat list, cheapest first, no sections,
 * no relationship chips, no codes or deals box (OWNER_LIST_GUIDES in src/content/giftGuidePeople.mjs). An Amazon pick
 * shows the price she saw on her saved list (`sortPrice`, captured 11-21; owner 11-21 ~12:05 PM chose "Show Amazon prices
 * anyway") and keeps Amazon's own photo, never edited. COMMISSION SWITCHES 11-21 (owner: "if the items on the guides can we fund at another place
 * for higher commison just change the link"; same item, same price, better-paying store): those few picks are ShopMy
 * links instead, and like For Her's ShopMy picks they show their price checked 11-21 and a transparent cutout of the
 * new store's own photo (scripts/giftGuideCutouts1120.mjs), never Amazon's. Him picks keep their relationship tags
 * (`rels`), so /dad, /husband ... still build from this list.
 * Guard: src/test/giftGuideHimKids1121.test.ts.
 */
import { PEOPLE_GUIDES } from "../src/content/giftGuidePeople.mjs";
import { relsOf } from "./giftGuidePeople1120.mjs";
import { AMAZON_BRAND_PHOTOS_1122, cutoutPhoto } from "./giftGuideCutouts1120.mjs";
import { rankByPrice } from "./giftGuidePriceRank1121.mjs";
import { ADDS_STORES_1122, HIM_ADDS_1122, KIDS_ADDS_1122 } from "./giftGuideOwnerAdds1122.mjs";
import { recheckedPriceAt } from "./giftGuidePriceRecheck.mjs";
import { HIM_KEEPS_1123_ROWS, HIM_LINKS_1123_ROWS, HIM_WALMART_1123_ROWS, KEEPS_PRICE_AT, KIDS_KEEPS_1123_ROWS, KIDS_LINKS_1123_ROWS, KIDS_WALMART_1123_ROWS } from "./giftGuideOwnerKeeps1123.mjs";

export const HIM_GUIDE = "him";
export const KIDS_GUIDE = "kids";
const amz = (asin) => `https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20`;
const amzImg = (id) => `https://m.media-amazon.com/images/I/${id}._SL500_.jpg`;
const shopmy = (pin) => `https://go.shopmy.us/${pin}`;
/** The day the switched picks' ShopMy prices were checked (Louisiana day). */
export const HIM_KIDS_PRICE_AT = "2026-11-21";
/** Stores a switched pick goes to that the store list may not hold yet (key -> shown name). */
export const HIM_KIDS_STORES = {
  "store-dillards": "Dillard's", "store-l-l-bean": "L.L.Bean", "store-exclusive-beauty-club": "Exclusive Beauty Club",
  // The owner's ShopMy saves for Him and Kids (11-21).
  "store-smathers-and-branson": "Smathers & Branson", "store-duck-head": "Duck Head", "store-grove": "Grove",
  "store-clinique": "Clinique", "store-maisonette": "Maisonette", "store-wayfair": "Wayfair", "store-macys": "Macy's",
  "store-yeti": "YETI", "store-xtratuf": "XTRATUF", "store-jd-sports": "JD Sports", "store-burlebo": "Burlebo",
  "store-tractor-supply": "Tractor Supply", "store-onward-reserve": "Onward Reserve", "store-target": "Target", "store-burts-bees-baby": "Burt's Bees Baby",
};
/** One row per pick: [ASIN, price she saw, Amazon image id, name, brand, type, commission %, line]. */
const row = ([asin, sortPrice, img, name, brand, type, commission, line]) => ({ name, brand, line, href: amz(asin), image: amzImg(img), store: "store-amazon", sortPrice, commission, type });
/** One of her ShopMy saves: [pin, price on the store's own page 11-21, store photo, name, brand, store, type, commission %, line]. */
const shop = ([pin, price, image, name, brand, store, type, commission, line]) => ({ name, brand, line, href: shopmy(`p-${pin}`), image, store, sortPrice: price, price, commission, type });

/**
 * Her men's ShopMy saves (Desktop note Him-saved-shopmy-1121.md, 43 pins), 7 of the first 8 kept by her rules (the owner
 * took the Fresh Falls soap off on 2026-11-22): at most 2 of a brand
 * (Smathers & Branson made ~30 of them; the camo belt she saved at Duck Head is theirs too), 2 of an item type, no LSU (until the owner's 11-21 PM "You can list LSU stuff", below),
 * nothing out of stock. Counts and prices measured 2026-11-21 on each store's own page (Grove, Clinique, S&B, Duck Head).
 */
export const HIM_SHOPMY_1121 = [
  ["108628349", 35, "https://static.shopmy.us/pins/zoom-108628349-1795247477620-DuckDecoys_AntiqueBlue__KeyFob_Primary_LowRes_c251e80f-b48c-4193-88c2-0b366856e967.jpg", "Smathers & Branson Duck Decoys Needlepoint Key Fob", "Smathers & Branson", "store-smathers-and-branson", "accessory", 15, "A hand-stitched needlepoint key fob with a wood duck."],
  ["108628518", 195, "https://static.shopmy.us/uploads/img-product-1792092560933", "Smathers & Branson Camo Needlepoint Belt", "Smathers & Branson", "store-duck-head", "belt", 16, "A hand-stitched needlepoint belt in classic camo."],
  ["108626053", 15.99, "https://static.shopmy.us/pins/zoom-108626053-1795245908121-FaceBeardSerum.jpg", "Phil's Face + Beard Serum", "Phil's", "store-grove", "skincare", 25, "A light serum for his face and beard."],
  // Owner 2026-11-22 ("remove"): the Dr. Squatch Fresh Falls Bar Soap (Grove pin 108626008, $7.49) is off For Him.
  ["108626036", 18, "https://static.shopmy.us/pins/zoom-108626036-1795245900235-scay0j7x7kubjvla5qrv.jpg", "Dr. Squatch Hand and Body Lotion, Wood Barrel Bourbon", "Dr. Squatch", "store-grove", "lotion", 25, "A rich lotion in the Wood Barrel Bourbon scent."],
  ["108625988", 8.49, "https://static.shopmy.us/pins/zoom-108625988-1795245880004-qtvoydnznvaowxmbx9or.jpg", "Method Men Body Wash, Sea + Surf", "Method", "store-grove", "body-wash", 15, "A fresh sea and surf body wash for his shower."],
  ["108625882", 29.4, "https://www.clinique.com/cdn/shop/files/cl_sku_V2Y701_3000x3000_0.png", "Clinique For Men Oil-Free Moisturizer", "Clinique", "store-clinique", "skincare", 21, "A light gel moisturizer that never feels greasy."],
  ["108625877", 23.1, "https://www.clinique.com/cdn/shop/files/cl_sku_651705_3000x3000_0.png", "Clinique For Men Post-Shave Soother", "Clinique", "store-clinique", "shave", 21, "An aloe lotion that calms skin after a shave."],
  // Owner 11-21 ("Him = ALL of her men's saves", caps off): every other in-stock, non-LSU Smathers & Branson save, and two
  // more Dr. Squatch, priced on smathersandbranson.com and grove.co 2026-11-21. Left out: LSU items (her rule then; added
  // below since "You can list LSU stuff"), the
  // Upland Shoot luggage tag, Duck Decoys strap and coasters, Wood Duck tumbler, World's Best Dad can cooler and Onward
  // Reserve key fob (sold out), the Wood Duck tumbler set (not listed), and both Kiehl's bundles (not on kiehls.com).
  ["108628554", 49.5, "https://static.shopmy.us/pins/zoom-108628554-1795247624550-RainbowTrout_ClassicNavy__TumblerwithLid_LowRes.jpg", "Smathers & Branson Rainbow Trout Tervis Tumbler", "Smathers & Branson", "store-smathers-and-branson", "drinkware", 15, "A needlepoint trout on a Tervis tumbler."],
  ["108628535", 35, "https://static.shopmy.us/pins/zoom-108628535-1795247604494-Redfish_Dark_Navy__Bottle_Opener_Low_Res.jpg", "Smathers & Branson Redfish Bottle Opener", "Smathers & Branson", "store-smathers-and-branson", "bottle-opener", 15, "A needlepoint redfish bottle opener."],
  ["108628533", 35, "https://static.shopmy.us/pins/zoom-108628533-1795247603379-Redfish_Dark_Navy__Key_Fob_Primary_Low_Res.jpg", "Smathers & Branson Redfish Key Fob", "Smathers & Branson", "store-smathers-and-branson", "accessory", 15, "A needlepoint redfish key fob."],
  ["108628457", 158, "https://static.shopmy.us/pins/zoom-108628457-1795247557821-Fishing_Fly_Black__Coaster_Primary_Low_Res.jpg", "Smathers & Branson Fishing Flies Coasters", "Smathers & Branson", "store-smathers-and-branson", "coasters", 15, "Four needlepoint fly-fishing coasters."],
  ["108628432", 49.5, "https://static.shopmy.us/pins/zoom-108628432-1795247539414-UplandShoot_Multi__TumblerwithLid_LowRes.jpg", "Smathers & Branson Upland Shoot Tervis Tumbler", "Smathers & Branson", "store-smathers-and-branson", "drinkware", 15, "An upland hunt scene on a Tervis tumbler."],
  ["108628429", 35, "https://static.shopmy.us/pins/zoom-108628429-1795247534926-Upland_Shoot_Multi__Key_Fob_Primary_Low_Res.jpg", "Smathers & Branson Upland Shoot Key Fob", "Smathers & Branson", "store-smathers-and-branson", "accessory", 15, "A needlepoint upland hunt key fob."],
  ["108628421", 65, "https://static.shopmy.us/pins/zoom-108628421-1795247530982-Upland_Shoot_CCW_Low_Res.jpg", "Smathers & Branson Upland Shoot Card Wallet", "Smathers & Branson", "store-smathers-and-branson", "wallet", 15, "A needlepoint card wallet with an upland hunt."],
  ["108628411", 35, "https://static.shopmy.us/pins/zoom-108628411-1795247528384-Upland_Shoot_Multi__Can_Cooler_Primary_Low_Res.jpg", "Smathers & Branson Upland Shoot Can Cooler", "Smathers & Branson", "store-smathers-and-branson", "can-cooler", 15, "A leather and needlepoint can cooler."],
  ["108628379", 79.5, "https://static.shopmy.us/pins/zoom-108628379-1795247500915-Upland_Shoot_Multi__Sunglass_Straps_Primary_Low_Res.jpg", "Smathers & Branson Upland Shoot Sunglass Strap", "Smathers & Branson", "store-smathers-and-branson", "sunglass-strap", 15, "A needlepoint strap for his sunglasses."],
  ["108628348", 35, "https://static.shopmy.us/pins/zoom-108628348-1795247475480-WoodDuckDecoy_AntiqueBlue__BottleOpener_LowRes_f009c4b4-eb66-4d44-b476-0fec3a2f3d84.jpg", "Smathers & Branson Wood Duck Decoy Bottle Opener", "Smathers & Branson", "store-smathers-and-branson", "bottle-opener", 15, "A needlepoint wood duck bottle opener."],
  ["108628058", 115, "https://static.shopmy.us/pins/zoom-108628058-1795247283281-ValetTray_ChestnutWood__FramedEdenMonogram_LowRes.jpg", "Smathers & Branson Monogrammed Valet Tray", "Smathers & Branson", "store-smathers-and-branson", "valet-tray", 15, "A wood valet tray with his needlepoint monogram."],
  ["108628052", 183, "https://static.shopmy.us/pins/zoom-108628052-1795247281134-CoasterSet_CircleSans48_MonogramBlueberryMelon_LowRes_df4b15df-1cf6-4073-b69b-5a3ad20aa27d.jpg", "Smathers & Branson Monogrammed Coasters", "Smathers & Branson", "store-smathers-and-branson", "coasters", 15, "Four needlepoint coasters with his monogram."],
  ["108628047", 50, "https://static.shopmy.us/pins/zoom-108628047-1795247277928-KeyFob_Block10_MonogramBlueberrywhite_LowRes_22103605-b81e-4f6b-b8a6-31809f82245c.jpg", "Smathers & Branson Monogrammed Key Fob", "Smathers & Branson", "store-smathers-and-branson", "accessory", 15, "A needlepoint key fob with his initials."],
  ["108626037", 16, "https://static.shopmy.us/pins/zoom-108626037-1795245901003-s9tzcdtbcihhguemerog.jpg", "Dr. Squatch Cool Fresh Aloe Face Wash", "Dr. Squatch", "store-grove", "skincare", 25, "A cooling aloe face wash from Dr. Squatch."],
  ["108625979", 6.99, "https://static.shopmy.us/pins/zoom-108625979-1795245875843-Unscented_Shea_Butter_3.png", "Dr. Squatch Total Moisture Bar Soap", "Dr. Squatch", "store-grove", "soap", 25, "A shea butter bar soap for dry skin."],
  // Owner 2026-11-21 PM ("You can list LSU stuff"): her LSU saves, priced on smathersandbranson.com 2026-11-21 (each
  // product's .js). Left out: the LSU sunglass strap and luggage tag (sold out there). The toiletry bag and wallet were
  // saved as monogrammed; the price is the item's own (the monogram fee shows only once one is chosen). The flask is a
  // final-sale markdown ($125 to $75).
  ["108628318", 65, "https://static.shopmy.us/pins/zoom-108628318-1795247451663-LSU_CCW_Primary_LowRes.jpg", "Smathers & Branson LSU Card Wallet", "Smathers & Branson", "store-smathers-and-branson", "wallet", 15, "A purple and gold needlepoint card wallet for game day."],
  ["108628311", 35, "https://static.shopmy.us/pins/zoom-108628311-1795247447134-LSU_Fairisle_Ornament_Purple_White_Cord__Low_Res.jpg", "Smathers & Branson LSU Fairisle Ornament", "Smathers & Branson", "store-smathers-and-branson", "ornament", 15, "A hand-stitched purple and gold ornament for the tree."],
  ["108628309", 35, "https://static.shopmy.us/pins/zoom-108628309-1795247445313-LSU_BottleOpener_Primary_LowRes.jpg", "Smathers & Branson LSU Bottle Opener", "Smathers & Branson", "store-smathers-and-branson", "bottle-opener", 15, "A purple and gold needlepoint bottle opener for game day."],
  ["108628296", 75, "https://static.shopmy.us/pins/zoom-108628296-1795247441296-LSU_Cufflinks_Primary_Low_Res.jpg", "Smathers & Branson LSU Cufflinks", "Smathers & Branson", "store-smathers-and-branson", "cufflinks", 15, "Purple and gold needlepoint cufflinks for a game-day suit."],
  ["108628280", 155, "https://static.shopmy.us/pins/zoom-108628280-1795247430486-LSU_Toiletry_Bag_Low_Res_695e403b-4296-4008-acf2-a08453c932ec.jpg", "Smathers & Branson LSU Toiletry Bag", "Smathers & Branson", "store-smathers-and-branson", "bag", 15, "A purple and gold needlepoint toiletry bag, monogram optional."],
  ["108628276", 170, "https://static.shopmy.us/pins/zoom-108628276-1795247429638-LSU_Wallet_Primary_LowRes_2fc565e0-ca2b-4bf3-9ab3-ea6e42f35e3d.jpg", "Smathers & Branson LSU Bi-Fold Wallet", "Smathers & Branson", "store-smathers-and-branson", "wallet", 15, "A purple and gold needlepoint bi-fold wallet, monogram optional."],
  ["108628274", 110, "https://static.shopmy.us/pins/zoom-108628274-1795247427405-LSUDHTLowResPrimary.jpg", "Smathers & Branson LSU Driver Headcover", "Smathers & Branson", "store-smathers-and-branson", "golf", 15, "A white leather driver cover stitched in purple and gold."],
  ["108628018", 75, "https://static.shopmy.us/pins/zoom-108628018-1795247257926-LSU_Flask_Primary_LowRes.jpg", "Smathers & Branson LSU Flask", "Smathers & Branson", "store-smathers-and-branson", "flask", 15, "A purple and gold needlepoint flask for the tailgate."],
  // Owner 2026-11-21 PM ("Find a replacement for the yeti backpack one with a price"): her Amazon save (B09ZYT939N, YETI
  // Crossroads Backpack, Alpine Brown) had no Amazon price, so this is the same backpack and color on her existing YETI
  // pin, $160 on yeti.com 2026-11-21 (20% off $200; Alpine Brown in stock).
  ["107838580", 160, "https://static.shopmy.us/uploads/pretty-prod-1758467247287", "YETI Crossroads 22L Backpack, Alpine Brown", "YETI", "store-yeti", "backpack", 8, "A tough everyday backpack with a padded laptop sleeve."],
  // owner 11-22 him picks (builder-guide-him): Smathers & Branson, same product in different designs side by side.
  ["108101578", 54, "https://cdn.shopify.com/s/files/1/0767/9233/2592/files/Mallard_ClassicNavy__TumblerwithLid_LowRes.jpg", "Smathers & Branson Mallard Tervis Tumbler", "Smathers & Branson", "store-smathers-and-branson", "drinkware", 15, "A classic mallard on a Tervis tumbler with a lid."],
  ["108104267", 54, "https://cdn.shopify.com/s/files/1/0767/9233/2592/files/World_sBestDad_Royal__TumblerwithLid_LowRes.jpg", "Smathers & Branson World's Best Dad Tervis Tumbler", "Smathers & Branson", "store-smathers-and-branson", "drinkware", 15, "A World's Best Dad Tervis tumbler for the dad who has everything."],
  ["108108365", 35, "https://static.shopmy.us/pins/zoom-108108365-1795145239744-Mallard_Classic_Navy__Can_Cooler_Primary_Low_Res.jpg", "Smathers & Branson Mallard Can Cooler", "Smathers & Branson", "store-smathers-and-branson", "drinkware", 15, "A mallard can cooler to keep a cold one cold."],
  ["108101625", 65, "https://cdn.shopify.com/s/files/1/0767/9233/2592/files/World_sBestDad_Royal__CCW_LowRes.jpg", "Smathers & Branson World's Best Dad Needlepoint Card Wallet", "Smathers & Branson", "store-smathers-and-branson", "wallet", 15, "A slim needlepoint card wallet for Dad."],
  ["108108555", 155, "https://cdn.shopify.com/s/files/1/0767/9233/2592/files/Fish_and_Tackle_Dark_Navy__Toiletry_Bag_Low_Res.jpg", "Smathers & Branson Fish and Tackle Toiletry Bag", "Smathers & Branson", "store-smathers-and-branson", "bag", 15, "A needlepoint fish and tackle toiletry bag for the trip."],
].map(shop);

/**
 * The rest of her Amazon "men" list (owner 11-21: "there is also a lot of stuff missing from the mens guide"; then "Him =
 * ALL of her men's saves", brand and type caps off for her own picks). Every row of Him-saved-amazon-1121.md not already
 * above, except four duplicates (the second LaCrosse Grange, braided line and Colster listings; the Theragun Prime and
 * LaCrosse Grange already link to their better-paying stores above) and the YETI Crossroads Backpack (Amazon showed no
 * price, 2026-11-21; it is in HIM_SHOPMY_1121 on her YETI pin). Prices are her list's capture; the three YETI Crossroads prices were read on Amazon 2026-11-21.
 */
export const HIM_AMAZON_MORE_1121 = [
  // NIGHT LINK 11-21 (owner: "switch all 3 to the higher commission"; Commission-links-1121-night.md): was Amazon B0DVM24NF8 at
  // 3% ($250); same item and color, King Crab Orange, yeti.com: 8%, $250.
  { name: "YETI LoadOut GoBox 30 Gear Case", brand: "YETI", line: "A smaller GoBox for tackle, tools or shells.", href: shopmy("p-109003412"), image: "https://yeti-webmedia.imgix.net/asset/97d8ceab-2ea8-4e68-ab47-72162d713c1b/W/220027_site_studio_Loadout_GoBox_30_King_Crab_Front_Closed_1202_Primary_B_2400x2400.png", store: "store-yeti", sortPrice: 250, price: 250, commission: 8, type: "gear-case" },
  // NIGHT LINK 11-21 (owner: "switch all 3 to the higher commission"; Commission-links-1121-night.md): was Amazon B0D9QX9F67 at
  // 3% ($55); same item and color, Olive/Black, yeti.com: 8%, $55.
  { name: "YETI Sidekick Dry 3L Gear Case, Olive", brand: "YETI", line: "A waterproof pouch for keys, phone and wallet on the water.", href: shopmy("p-109004058"), image: "https://yeti-webmedia.imgix.net/asset/74b4454a-9c99-4b8b-9967-8eff2a9793a1/W/site_studio_Bags_Sidekick_Dry_3L_Olive_Front_3657_Primary_B_2400x2400.png", store: "store-yeti", sortPrice: 55, price: 55, commission: 8, type: "gear-case" },
  ["B0FL2Y8B9V", 148.49, "41m8A6L3T1L", "Condition 1 16 in. Pistol Case", "Condition 1", "gun-case", 3, "A heavy-duty, watertight hard case for a pistol."],
  ["B0CNKB7KGG", 69.98, "41mY52oBJrL", "ONNAIS Iron PRO Biometric Gun Safe", "ONNAIS", "gun-safe", 3, "A fingerprint gun safe for the nightstand or truck."],
  ["B08L12KVMB", 9.45, "41pribslttL", "Gun Cleaning Patches and Supplies", "", "hunting", 3, "Cleaning patches to keep his guns in shape."],
  ["B0DZD77G4Y", 161.49, "41ptsk1u+1L", "ORARAER Biometric Gun Safe", "ORARAER", "gun-safe", 3, "A quick-access biometric safe with three ways to open."],
  ["B0GZ4Y3GNX", 179.99, "21seEJ47Q+L", "Blink Frontier XR+ Camera", "Blink", "camera", 3, "A long-range outdoor camera for the camp or the barn."],
  ["B0CVNMW9MX", 34.99, "417i4FipHRL", "Rest EZ BBQ Meat Resting Blanket", "Rest EZ", "grilling", 3, "An insulated blanket that rests brisket and ribs right."],
  ["B0FKN7JH1D", 40.79, "51m5BLriPIL", "Wontolf Car Wash Kit with Foam Gun", "Wontolf", "car-care", 3, "A foam gun and wash kit for Saturday truck washes."],
  // Owner 2026-11-22 ("only keep the one with the higher commission"): of the two car wash kits, the Wontolf above
  // earns more per sale (3% x $40.79 = $1.22) than the Armor All Ultimate Car Cleaning Kit (B0732FCCL4, 3% x $38.91 = $1.17),
  // so the Armor All kit is off For Him.
  ["B0FP3KY1N1", 34.64, "41PD4obdH2L", "Rural Cloth We Hunt Mallards Cap", "Rural Cloth", "hat", 4, "A mallard cap for the duck hunter."],
  ["B0HCVK9JTC", 37.6, "31GcdYbSv4L", "HOOEY Outfitters Mallard Cap", "HOOEY", "hat", 4, "A five-panel mallard cap from HOOEY."],
  ["B0DC22HBR3", 21.99, "41zbxyDpM0L", "Wrangler Sherpa Throw Blanket", "Wrangler", "throw-blanket", 3, "A sherpa throw for the couch or the deer camp."],
  ["B0DC1W9XV4", 21, "41Zr0VAPP3L", "Eddie Bauer Soft Reversible Throw", "Eddie Bauer", "throw-blanket", 3, "A soft reversible throw in a classic plaid."],
  ["B0GFFLR222", 16.98, "41eed5RddkL", "DUDE Wipes MentHOLE XXtreme", "DUDE Wipes", "grooming", 1, "The flushable wipes guys actually ask for."],
  ["B09156YD8P", 28.46, "31nJNhI8+IL", "HOTO Pocket Laser Measuring Tool", "HOTO", "tool", 3, "A pocket laser measure for every project."],
  ["B0C2C28CVL", 21.42, "41M57lxk0wL", "Telescoping Magnetic Pickup Tool Set", "", "tool", 3, "Magnetic pickup tools for dropped bolts and screws."],
  ["B086KY66PH", 20.05, "31SyeQ6819L", "Hanes Men's Undershirt Pack", "Hanes", "shirt", 4, "A fresh pack of undershirts he always needs."],
  ["B0FPWMZZF5", 34.19, "41RWj8yScFL", "KOACKL Propane Torch Gun", "KOACKL", "tool", 3, "A propane torch for the fire pit, grill or shop."],
  ["B0D31TCLN2", 154.23, "310gPjubwZL", "On Men's Cloud 6 Sneakers", "On", "shoes", 4, "Light, cushioned sneakers for walks and long days."],
  ["B07MGSCM3M", 12.73, "515LwQQF0-L", "Reaction Tackle Braided Fishing Line", "Reaction Tackle", "fishing", 3, "Strong braided line to restock his reels."],
  ["B0G7XDFZK2", 111.99, "41zCPB49siL", "KastKing Royale Legend Patriot Fishing Rod", "KastKing", "fishing", 3, "A twin-tip rod in a patriotic finish."],
  ["B0CQ47S1S2", 59.99, "31pn67qSXqL", "XELFLY Waterproof Fishing Backpack", "XELFLY", "bag", 3, "A waterproof tackle backpack for the bank or the boat."],
  // Links audit 1122 night #4: her saved color (Bark, B08Z42695Q) had no Buy Box, so the link is the same hat in Oak,
  // sold and shipped by Amazon, $42.68 read on its page 2026-11-22.
  { ...row(["B0CSJ4TC52", 42.68, "81MKem3rMJL", "SITKA Mid Pro Trucker Hat", "SITKA", "hat", 4, "A SITKA trucker hat for the field."]), priceAt: "2026-11-22" },
  ["B002OSXDTG", 129.95, "31k8tX0z0KL", "LaCrosse Burly Air Grip 18 in. Boots", "LaCrosse", "boots", 4, "Tall rubber boots built for the marsh."],
  ["B00AQG9MGG", 88.92, "31ZTfBVeDRL", "MUCK Chore Cool Tall Boot", "MUCK", "boots", 4, "Tall, breathable work boots for the yard and barn."],
  // RATE SWITCH 11-21 night (Commission-rates-search-1121-night.md): was Amazon B0998FYXLS at 4% ($93.75); the same Mossy Oak Bottomland boot (xmabmob)
  // at xtratuf.com through CJ at 15%, $125 list, $93.75 with XT25 (through Nov 29), the Amazon price.
  { name: "XTRATUF Mossy Oak Bottomland Ankle Deck Boot", brand: "XTRATUF", line: "Deck boots in Mossy Oak Bottomland camo.", href: "https://www.anrdoezrs.net/click-101930553-15735628?url=https%3A%2F%2Fxtratuf.com%2Fproducts%2Fxmabmob", image: "https://cdn.shopify.com/s/files/1/0676/1385/1803/files/XMABMOB_gray_main_720x720_d16b4d27-7fc1-4833-a83f-06939c86fdb4.jpg", store: "store-xtratuf", sortPrice: 125, price: 125, commission: 15, type: "boots", code: "XT25", codeEnds: "2026-11-29" },
  ["B0FY9LPSCW", 30, "31i+57DEsXL", "Columbia Ratchet Strap Snapback Hat", "Columbia", "hat", 4, "An easy snapback for every day."],
  // RATE SWITCH 11-21 night (Commission-rates-search-1121-night.md): was Amazon B0DQF73JH4 at 4% ($30); the same TNF Black beanie (NF0A8CHE 001) at
  // JD Sports at 15% (p-109003932), $35. Photo: JD Sports' own product shot.
  { name: "The North Face Logo Box Cuffed Beanie", brand: "The North Face", line: "A warm cuffed beanie for cold mornings.", href: shopmy("p-109003932"), image: "https://media.jdsports.com/i/jdsports/NF0A8CHE_001_P3?w=1000", store: "store-jd-sports", sortPrice: 35, price: 35, commission: 15, type: "hat" },
  // NIGHT LINK 11-21 (owner: "switch all 3 to the higher commission"; Commission-links-1121-night.md): was Amazon B0FDYG11V3 at
  // 3% ($270); same item and color, Wetlands Camo, Tractor Supply 2580429 (yeti.com is out of it): 8%, $270.
  { name: "YETI Hopper Flip 12 Soft Cooler", brand: "YETI", line: "A soft cooler that keeps lunch cold all day.", href: shopmy("p-109004991"), image: "https://media.tractorsupply.com/is/image/TractorSupplyCompany/2580429", store: "store-tractor-supply", sortPrice: 270, price: 270, commission: 8, type: "cooler" },
  // NIGHT LINK 11-21 (owner: "switch all 3 to the higher commission"; Commission-links-1121-night.md): was Amazon B0D9QXT97F at
  // 3% ($280); same item and color, Olive 22in carry-on, yeti.com (20% off Crossroads; $350 when it ends): 8%, $280.
  { name: "YETI Crossroads Luggage", brand: "YETI", line: "Rugged rolling luggage for hunting trips and travel.", href: shopmy("p-109003793"), image: "https://yeti-webmedia.imgix.net/m/5334b4066c200f9/W-site_studio_Bags_22_Luggage_Olive_Front_00115_Primary_B_2400x2400.png", store: "store-yeti", sortPrice: 280, price: 280, commission: 8, type: "luggage" },
  // NIGHT LINK 11-21 (owner: "switch all 3 to the higher commission"; Commission-links-1121-night.md): was Amazon B0B64CJZQQ at
  // 3% ($400); same item and color, Tan 100L, yeti.com: 8%, $400.
  { name: "YETI Panga Waterproof Duffel", brand: "YETI", line: "A fully waterproof duffel for boat days.", href: shopmy("p-109003630"), image: "https://yeti-webmedia.imgix.net/asset/24be88ce-af77-44b9-adb1-37a72dd2c382/W/site_studio_Panga_100L_Duffel_Tan_Front_0227_Primary_B_2400x2400.png", store: "store-yeti", sortPrice: 400, price: 400, commission: 8, type: "bag" },
  // NIGHT LINK 11-21 (owner: "switch all 3 to the higher commission"; Commission-links-1121-night.md): was Amazon B0DHHK1YP7 at
  // 3% ($200); same item and color, Cape Dark Taupe, yeti.com (Crossroads sale; list $250): 8%, $200.
  { name: "YETI Crossroads Duffel Bag, 60L", brand: "YETI", line: "A roomy duffel for weekends away.", href: shopmy("p-109003951"), image: "https://yeti-webmedia.imgix.net/asset/9d27db5c-7b05-4219-83e0-e35ee2c57234/W/site_studio_soft_goods_Bags_60L_Duffel_Cape_Taupe_Front_00011_Primary_B_2400x2400.png", store: "store-yeti", sortPrice: 200, price: 200, commission: 8, type: "bag" },
  // NIGHT LINK 11-21 (owner: "switch all 3 to the higher commission"; Commission-links-1121-night.md): was Amazon B0H7CNPH2S at
  // 4.5% ($40); same item and color, Upland Bird Olive, yeti.com: 8%, $40.
  { name: "YETI Rambler 20 oz Tumbler, Upland", brand: "YETI", line: "A Rambler with upland birds for coffee on the drive.", href: shopmy("p-109004159"), image: "https://yeti-webmedia.imgix.net/asset/31f78bf9-5319-4ef1-9e33-be99bb82a8c6/W/Site_Studio_Drinkware_Rambler_Tumbler_20oz_Upland_Bird_Front_1256_B_2400x2400.png", store: "store-yeti", sortPrice: 40, price: 40, commission: 8, type: "drinkware" },
  // NIGHT LINK 11-21 (owner: "switch all 3 to the higher commission"; Commission-links-1121-night.md): was Amazon B0H7DRWL2T at
  // 4.5% ($25); same item and color, Olive/King Crab Orange, yeti.com: 8%, $25.
  { name: "YETI Rambler 12 oz Colster Can Insulator", brand: "YETI", line: "Keeps his can cold to the last sip.", href: shopmy("p-109004254"), image: "https://yeti-webmedia.imgix.net/asset/d8bd6d31-2b1e-42b9-b993-7604c58d92c1/W/Site_Studio_Drinkware_Rambler_Colster_2-0_12oz_2026_Hunt_Front_480_B_2400x2400.png", store: "store-yeti", sortPrice: 25, price: 25, commission: 8, type: "drinkware" },
  ["B0FJ77VP99", 7.63, "51pRiXCKpSL", "Microfiber Fishing Towels with Clip, 3 Pack", "Puomue", "fishing", 3, "Clip-on towels for the boat or the bank."],
  ["B0CNCYJHG5", 23.99, "41ttbLXHJsL", "KastKing SteelStream Fishing Tool Kit", "KastKing", "fishing", 3, "Pliers, gripper and tools for a day of fishing."],
  ["B074731V84", 49.29, "51YXUAY-bzL", "Rush Creek 12-Rod Rolling Rod Rack", "Rush Creek Creations", "fishing", 3, "A rolling rack that keeps his rods in one place."],
  ["B09P176CP2", 14.21, "51r-X2u930L", "PLUSINNO Wall Mount Rod Holder", "PLUSINNO", "fishing", 3, "A wall rack to hang his rods in the garage."],
  ["B08X6K53VX", 20.24, "41VyLDmOBuL", "KastKing Blowbak Fishing Sling Bag", "KastKing", "bag", 3, "A sling bag for tackle on the move."],
  ["B0BNHWJKTL", 17.59, "51tWSw3Pc5L", "KastKing Floating Landing Net", "KastKing", "fishing", 3, "A floating net to land the big one."],
  ["B0DFM99JMJ", 67.98, "41kwEwHHimL", "Underwater Fishing Light, 100W", "XXK", "fishing", 3, "A green dock light that pulls in fish at night."],
  ["B09ZK1VTWG", 55.97, "51SvVCt24zL", "Catch Co Mystery Tackle Box, Bass", "Catch Co", "fishing", 3, "A surprise box of bass lures."],
  ["B08HSH1ZCZ", 47.99, "41hGKBlB07L", "Catch Co Mystery Tackle Box, Catch All", "Catch Co", "fishing", 3, "A surprise box of lures for any fish."],
  // NIGHT LINK 11-21 (owner: "switch all 3 to the higher commission"; Commission-links-1121-night.md): was Amazon B0D1RJZCWZ at
  // 3% ($371.25); same item and color, Navy, llbean.com 5750519 (photo from yeti.com: L.L.Bean blocks reads): 12%, $375.
  { name: "YETI Roadie 32 Wheeled Cooler", brand: "YETI", line: "A wheeled hard cooler for tailgates and trips.", href: shopmy("p-109000336"), image: "https://yeti-webmedia.imgix.net/asset/79f95551-0ac4-4ec6-a3d9-fc879fd507ca/W/site_studio_hard_goods_Roadie_32_Navy_3QTER_Basket_4248_Primary_B_2400x2400.png", store: "store-l-l-bean", sortPrice: 375, price: 375, commission: 12, type: "cooler" },
  // NIGHT LINK 11-21 (owner: "switch all 3 to the higher commission"; Commission-links-1121-night.md): was Amazon B0H7CRMDKS at
  // 3% ($325); same item and color, Olive/King Crab Orange, yeti.com: 8%, $325.
  { name: "YETI Tundra 45 Hard Cooler", brand: "YETI", line: "The classic YETI ice chest for the boat or the camp.", href: shopmy("p-109001581"), image: "https://yeti-webmedia.imgix.net/asset/5a5ec195-f5d7-414f-b324-0e95c378c9a5/W/Site_Studio_Hard_Coolers_Tundra_45_2026_Hunt_Front_070_B_2400x2400.png", store: "store-yeti", sortPrice: 325, price: 325, commission: 8, type: "cooler" },
  ["B0BTNT4225", 7.62, "51soPzYygeL", "Damaged Screw Extractor Set", "", "tool", 3, "Pulls out stripped screws in seconds."],
  ["B0C1HKXK3D", 22.78, "51c0A-FH+XL", "UUP Heavy Duty Roll Up Tool Bag", "UUP", "tool", 3, "A roll-up bag that keeps his tools in order."],
  ["B081T7N948", 6.45, "51M3+vvvmQL", "PULIDIKI Car Cleaning Gel", "PULIDIKI", "car-care", 3, "A gel that pulls dust out of vents and cup holders."],
  ["B0CB6MR12S", 50.29, "41BKierNiIL", "Cutluxe Carving Knife Set", "Cutluxe", "knife", 3, "Brisket slicing and boning knives for the pitmaster."],
  ["B0CVSG8L9Q", 22.99, "41NOaQEC07L", "Carhartt Zippered Travel Kit", "Carhartt", "travel-kit", 3, "A tough toiletry bag for trips."],
  // Owner 2026-11-22 ("remove"): Men's Fuzzy Cloud Socks (B0CQ4QM7Q2, $11.75) are off For Him.
  ["B0C9LKH31T", 55.99, "41ZlVWglSbL", "MANSCAPED The Handyman Face Shaver", "MANSCAPED", "grooming", 1, "A compact face shaver for travel."],
  ["B09N1B6LL3", 8.48, "51l-VL5PZBL", "MINKINH Nail Clipper Set", "MINKINH", "grooming", 1, "A sharp nail clipper set in a case."],
  ["B0FN3P492D", 49.99, "31rN+NqCvaL", "HOTO EdgeFlow Electric Box Cutter", "HOTO", "tool", 3, "A rechargeable cutter that opens boxes fast."],
  ["B00FXPT15C", 69.99, "416bwTpRNHL", "Carhartt Paxton Quarter Zip Sweatshirt", "Carhartt", "pullover", 4, "A heavyweight Carhartt quarter zip."],
  ["B0FYR14JVY", 32.23, "41WBx16LZfL", "Carhartt Oil Tan Leather Passcase Wallet", "Carhartt", "wallet", 4, "A brown leather wallet that wears in well."],
  ["B0FWRPFVF6", 135.99, "4180sHSFv2L", "HOTO 25-Piece Tool Kit with Drill", "HOTO", "tool", 3, "A cordless drill and household tool kit in one case."],
  // NIGHT LINK 11-21 (owner: "switch all 3 to the higher commission"; Commission-links-1121-night.md): was Amazon B0F22HTHMJ at
  // 3% ($408.5); same item and color, Tan, onwardreserve.com/products/turtlebox-gen-3-speaker-tan: 15%, $430.
  { name: "Turtlebox Original Gen 3 Speaker", brand: "Turtlebox", line: "The loudest Turtlebox, built for the outdoors.", href: shopmy("p-108999848"), image: "https://cdn.shopify.com/s/files/1/2117/2759/files/tan_59e105ca-50c6-4429-9dcb-6465e0c50aea.jpg", store: "store-onward-reserve", sortPrice: 430, price: 430, commission: 15, type: "speaker" },
  ["B00IU19FRK", 11.97, "41iKqPmPrRL", "Wildlife Research Scent Killer Gold Spray", "Wildlife Research Center", "hunting", 3, "Scent control spray for the stand."],
  ["B073VBXY7L", 5.37, "41DXHXOJ+KL", "Scent Killer Gold Antiperspirant", "Wildlife Research Center", "hunting", 3, "Scent-free antiperspirant for hunting days."],
  ["B018NKHBZU", 16.14, "41M3Of1q5kL", "Mossy Oak Fixed Blade Hunting Knife Set", "Mossy Oak", "knife", 3, "A two-piece hunting knife set with sheaths."],
  ["B0FYVZYD6F", 56.99, "41ANX3EfIcL", "Hunting Range Finder, 1700 Yards", "", "hunting", 3, "A laser range finder for the stand or the course."],
  ["B01M0KEKYK", 7.59, "31okBfIiBwL", "Scent-A-Way MAX Body Wash", "Hunters Specialties", "hunting", 3, "Scent-free body wash before the hunt."],
  ["B099ZXRRF8", 85.49, "51O8mxkWCWL", "TIDEWE 270 See Through Ground Blind", "TIDEWE", "hunting", 3, "A pop-up ground blind with see-through walls."],
  ["B0CJJCZ7T9", 116.99, "41iOI85KyYL", "WOZEL Spotting Scope with Tripod", "WOZEL", "binoculars", 3, "A spotting scope to glass the field from far off."],
  // RATE SWITCH 11-21 night (Commission-rates-search-1121-night.md): was Amazon B0FT97QYYZ at 4% ($47.20); the same Classic Deer Camo hoodie at
  // burlebo.com at 12% (p-109005228), $47.20 (Burlebo's own 20% off $59). Photo: burlebo.com's flat lay.
  { name: "Burlebo Thermal Waffle Knit Hoodie", brand: "Burlebo", line: "A waffle knit hoodie from a Southern outdoor brand.", href: shopmy("p-109005228"), image: "https://cdn.shopify.com/s/files/1/0917/5998/files/TH-CDC_Flatlay.jpg", store: "store-burlebo", sortPrice: 47.2, price: 47.2, commission: 12, type: "sweatshirt" },
  ["B015541VKI", 34.01, "41dyQAkJV+L", "Legendary Whitetails Long Sleeve Henley", "Legendary Whitetails", "shirt", 4, "A soft henley for cool days."],
  ["B0DTDJH158", 18.99, "41rbkZT4EKL", "Sidomma Fishing Tool Set", "Sidomma", "fishing", 3, "Pliers and tools for the tackle box."],
  ["B0FHMYC386", 19.6, "41yqlHKjRBL", "HUK Short Sleeve Performance Fishing Tee", "HUK", "shirt", 4, "A light, quick-dry tee for the boat."],
  ["B0FR98X1DZ", 12.99, "41-9VVRQ5ML", "Lucky Fishing Socks, Size 7-13", "", "socks", 4, "Fun fishing socks for his stocking."],
  // Brand photo cutout (owner 11-22 "Brand photo cutout"; Amazon's photos are a grey square): AMAZON_BRAND_PHOTOS_1122.
  { ...row(["B0D9PX9RBD", 70, "81p65D0cdNL", "MVP PRO Houndstooth Cabretta Golf Gloves, Black (Men's 2-Pack)", "MVP", "accessory", 3, "A pair of leather golf gloves in a black houndstooth."]), image: cutoutPhoto(AMAZON_BRAND_PHOTOS_1122.B0D9PX9RBD) },
  ["B0G72KN8BL", 9.49, "41AjgHzg2iL", "COOFANDY Men's V-Neck Tee", "COOFANDY", "shirt", 4, "A soft everyday V-neck tee."],
  ["B08BG8RQHG", 44.99, "41wLs6bwGyL", "Carhartt K288 Logo Sweatshirt", "Carhartt", "sweatshirt", 4, "The classic Carhartt logo sweatshirt."],
  ["B0FZN2ZCFL", 27.2, "51TtsH9AWzL", "Burlebo Go To Performance Tee", "Burlebo", "shirt", 4, "A light performance tee from Burlebo."],
  // owner 11-22 him picks (builder-guide-adds hand-off, lead OK): prices read on each Amazon page 2026-11-22. The brown MVP
  // golf gloves listing was the Womens (M) one, so Him carries the men's black 2-pack instead (above, B0D9PX9RBD).
  ["B0D8ZXGJ3L", 43.99, "61kzOwV7c+L", "Banded Soft Shell Insulated Handwarmer, Realtree Legacy", "Banded", "hunting", 3, "A fleece-lined hand muff for cold mornings in the blind."],
  ["B0CHVWCSQ8", 39.99, "61tvo-s46ML", "Klola Large Magnetic Gun Cleaning Mat with Parts Tray", "Klola", "hunting", 3, "A magnetic cleaning mat that keeps every small part in place."],
].map((r) => (Array.isArray(r) ? row(r) : r));

export const HIM_1121 = [
  ["B087G6TGJL", 6.64, "51mBoAiS5XL", "Super Universal Socket Tool", "", "tool", 3, "One socket that grips almost any nut or bolt."],
  ["B0CBS4F96J", 12.33, "61VaMYHbcnL", "SIMIYA Merino Wool Socks, 5 Pairs", "SIMIYA", "socks", 4, "Warm merino socks for boots and cold mornings."],
  ["B00NA83RQI", 14.32, "41wWjWp0VAL", "Eddie Bauer Sherpa Throw", "Eddie Bauer", "throw-blanket", 3, "A plaid sherpa throw for his chair or the camp."],
  ["B091ZJP26G", 15.99, "414ssPJzIZL", "Mossy Oak CLP Gun Cleaning Oil", "Mossy Oak", "hunting", 3, "Cleans, lubes and protects before the next hunt."],
  ["B09F2KFVGC", 19.94, "412sy1KL8DL", "CEYOMUR Trail Camera", "CEYOMUR", "trail-camera", 3, "A trail camera to see what walks by the stand."],
  ["B01C3LW5JC", 19.99, "519TOrBLY6L", "Carhartt Knit Watch Cap Beanie", "Carhartt", "hat", 4, "The classic Carhartt beanie he will wear all winter."],
  ["B0DJ2MRZTT", 21.24, "41Nd53GxtxL", "Fishing Lures Gift Box", "", "fishing", 3, "A boxed set of lures, ready to wrap."],
  ["B01L0KQTIK", 22.18, "51HE+ATO3xL", "Wrangler Authentics Fleece Quarter Zip", "Wrangler", "pullover", 4, "A soft fleece quarter zip in a classic color."],
  ["B06VX42986", 23.47, "41RcqKj+mEL", "Palmetto Wood Shop Engraved Pocket Knife", "Palmetto Wood Shop", "knife", 3, "A pocket knife engraved with his name."],
  ["B09NVWQJTR", 23.99, "31QAHhLpOTL", "KastKing Polarized Sunglasses", "KastKing", "sunglasses", 4, "Polarized shades that cut the glare on the water."],
  ["B0CGX3ZGBK", 25.99, "51PJjbtCbVL", "Rolling Grill Basket Grilling Accessory", "", "grilling", 3, "A rolling basket for veggies and shrimp on the grill."],
  ["B09PNKKS78", 26.79, "51mlYRfzIRL", "Wood Phone Docking Station", "", "organizer", 3, "One spot for his phone, keys, wallet and watch."],
  ["B0BLMQ8BXB", 27.06, "41VUzkUr2KL", "HOTO Electric Screwdriver Kit", "HOTO", "tool", 3, "A sleek rechargeable screwdriver with every bit."],
  ["B0DLGSQJYN", 27.69, "41m++ercdvL", "FINICO Rechargeable LED Headlamp", "FINICO", "light", 3, "A bright hands-free light for the garage or camp."],
  ["B0FHW66Z48", 27.99, "41WCCORx6BL", "Duck Calls, 5 Pack", "", "hunting", 3, "Five duck calls on a lanyard for the blind."],
  // RATE SWITCH 11-21 night (Commission-rates-search-1121-night.md): was Amazon B08P2C446P at 4% ($28); the same cap (burlebo.com "Cap - BURLEBO
  // Outdoors - Putty") at burlebo.com at 12% (p-109005373), $28. Photo: the burlebo.com cutout the Him cover already draws.
  { name: "BURLEBO Cap", brand: "BURLEBO", line: "A broken-in cap from a Southern outdoor brand.", href: shopmy("p-109005373"), image: "https://www.louisianahelpr.com/gift-guides/cutouts/burlebo-outdoors-cap-putty-b33402.webp", store: "store-burlebo", sortPrice: 28, price: 28, commission: 12, type: "hat" },
  ["B01KTULYO6", 28.58, "41jWsAeRoHL", "Legendary Whitetails Buck Camp Flannel", "Legendary Whitetails", "shirt", 4, "A thick flannel shirt he will reach for all season."],
  // Owner 2026-11-22 ("remove" the Chemical Guys Car Cleaning Kit, B09R5TGLFR, $31.90; keep only the Wontolf kit) is off For Him.
  ["B0CKMF6GPZ", 32.99, "41uo6lSsK3L", "HOSHANHO Fillet Knife", "HOSHANHO", "knife", 3, "A sharp, flexible fillet knife for the catch."],
  ["B0076R6MN4", 34.5, "41gvAlcoEhL", "Columbia Steens Mountain Fleece Jacket", "Columbia", "jacket", 4, "The full-zip fleece that goes with everything."],
  // NIGHT LINK 11-21 (owner: "switch all 3 to the higher commission"; Commission-links-1121-night.md): was Amazon B0FDY7G84C at
  // 4.5% ($40); same item and color, Wetlands Camo, Tractor Supply 2581799 (yeti.com: Notify Me); the yeti.com camo cutout the Him cover drew: 8%, $40.
  { name: "YETI Rambler 20 oz Tumbler", brand: "YETI", line: "Keeps his coffee hot through the whole drive.", href: shopmy("p-109005400"), image: "https://www.louisianahelpr.com/gift-guides/cutouts/yeti-rambler-20-oz-tumbler-wetlands-camo-7f0109.webp", store: "store-tractor-supply", sortPrice: 40, price: 40, commission: 8, type: "drinkware" },
  ["B0CPHY1VZL", 41.94, "41VLSmU2SBL", "HUK Pursuit Fishing Shirt", "HUK", "shirt", 4, "A cool, quick-dry shirt for long days on the boat."],
  // 14%, not 4%: her Amazon Creator Connections deal on HEYDUDE runs to Dec 7 (Commission-audit-1121-night.md).
  ["B0F2K9B696", 44.99, "31V+5B67tTL", "HEYDUDE Wally", "HEYDUDE", "shoes", 14, "Light slip-ons he can wear anywhere."],
  ["B0F8VBPLN7", 47.49, "41mi1NbWyPL", "10x42 Binoculars", "", "binoculars", 3, "Clear binoculars for the stand, the boat or the game."],
  ["B0GXH48XN1", 54.99, "41xkakIyH6L", "Carhartt Marquette Quarter Zip", "Carhartt", "pullover", 4, "A heavyweight Carhartt quarter zip built to last."],
  ["B0D1DWQ54L", 54.99, "41a6Af+o1vL", "Plano Weekend Tackle Bag", "Plano", "fishing", 3, "A tackle bag with trays for a weekend on the water."],
  ["B0F53HMTX5", 59.99, "41msaC6evLL", "HOTO Car Vacuum", "HOTO", "car-care", 3, "A small cordless vacuum that lives in his truck."],
  ["B08GPQGY76", 62.99, "41T20Ay0scL", "Heated Vest with Battery Pack", "", "vest", 4, "A battery-heated vest for cold mornings outside."],
  ["B0GM83DQ33", 68.39, "419qPI5DLOL", "Backyard Golf Net, 10 x 7 ft", "", "golf", 3, "A practice net so he can hit balls at home."],
  ["B0CDNQ62ML", 76.99, "41Jwpjys8EL", "MANSCAPED The Lawn Mower 5.0", "MANSCAPED", "grooming", 1, "The trimmer he would never buy himself."],
  ["B0D1TMFTPN", 79.99, "419U-JEJQOL", "ThermoMaven Wireless Meat Thermometer", "ThermoMaven", "grilling", 3, "A wireless probe that tells him when the meat is done."],
  ["B07DXFFZPT", 84.15, "41wkF95hcGL", "RTIC Soft Cooler", "RTIC", "cooler", 3, "A soft cooler that keeps ice for days."],
  ["B0H6SC835C", 87.99, "314g+xOxGmL", "OLIGHT ArkPro Flashlight", "OLIGHT", "light", 3, "A slim, powerful flashlight for his pocket."],
  ["B0DGZ45WB2", 89.6, "71pSnCJKOrL", "Sperry Authentic Original Boat Shoe", "Sperry", "shoes", 4, "The classic leather boat shoe."],
  // SWITCHED 11-21 (owner, via lead: "xtratuf in the guide"; the Him guide and cover use XTRATUF from xtratuf.com, not
  // Amazon): was Amazon B08Q1RN656 at 4% ($93.75, Duck Camo). Owner ~10:15 PM: "do a different color for the boot because
  // the cup is the same print": the classic Chocolate/Tan Men's Ankle Deck Boot (style 22734) at xtratuf.com through CJ
  // at 15%, $115 on xtratuf.com 2026-11-21 (products/22734.json), with code XT25 (25% off, through Nov 29). The code
  // rides on this card only (owner: "you can put the code with the item"); the chip hides after codeEnds.
  { name: "XTRATUF Ankle Deck Boot", brand: "XTRATUF", line: "Waterproof deck boots for the boat and the yard.", href: "https://www.anrdoezrs.net/click-101930553-15735628?url=https%3A%2F%2Fxtratuf.com%2Fproducts%2F22734", image: "https://cdn.shopify.com/s/files/1/0676/1385/1803/files/22734_gray_main_720x720_4234e2d7-b576-4907-bb67-594af369ef72.jpg", store: "store-xtratuf", sortPrice: 115, price: 115, commission: 15, type: "boots", code: "XT25", codeEnds: "2026-11-29" },
  // COMMISSION SWITCH 11-21: was Amazon B001DPHF4U at 4%; the same OD green Grange 18", same $99.95, at Dillard's at 8%.
  { name: "LaCrosse Grange Rubber Boot", brand: "LaCrosse", line: "Tall rubber boots made for mud and marsh.", href: shopmy("p-108736038"), image: "https://dimg.dillards.com/is/image/DillardsZoom/zoom/lacrosse-mens-grange-18-tall-waterproof-rubber-hunting-work-boots/00000000_zi_ac01ed80-ad36-4d40-8cca-066a3f05fcbd.jpg", store: "store-dillards", sortPrice: 99.95, price: 99.95, commission: 8, type: "boots" },
  // COMMISSION SWITCH 11-21: was Amazon B0FKCJNHWB at 1%; the same Theragun Prime 6th Gen in black, same $189.99, at
  // Exclusive Beauty Club at 16% (Therabody.com lists only the 5th gen).
  { name: "Theragun Prime Massage Gun", brand: "Therabody", line: "A massage gun for sore backs and shoulders.", href: shopmy("p-108734364"), image: "https://cdn.shopify.com/s/files/1/2959/8080/files/therabody-theragun-prime-massage-gun-black.png", store: "store-exclusive-beauty-club", sortPrice: 189.99, price: 189.99, commission: 16, type: "massager" },
  // The YETI Roadie 15 (Tractor Supply p-109005541) is off Him (lead 11-22): the same cooler in two sizes counts as a
  // duplicate, and Him keeps the Roadie 8 she pinned (scripts/giftGuideOwnerAdds1122.mjs).
  // COMMISSION SWITCH 11-21 night (owner-approved, via lead): was Amazon B0F2JHSGCJ at 3% ($237.50); the same Ranger in Tan
  // at Onward Reserve at 15%, $250 (her link p-108736312 -> onwardreserve.com/products/turtlebox-ranger-tan;
  // Commission-switches-1121.md). Photo: the Tan Ranger cutout from turtleboxaudio.com the Him cover already drew.
  { name: "Turtlebox Ranger Speaker", brand: "Turtlebox", line: "A loud, waterproof speaker built for the outdoors.", href: shopmy("p-108736312"), image: "https://www.louisianahelpr.com/gift-guides/cutouts/turtlebox-ranger-tan-06e916.webp", store: "store-onward-reserve", sortPrice: 250, price: 250, commission: 15, type: "speaker" },
  // owner 11-22 screenshot list (builder-guide-adds-2): the owner, via the lead, 2026-11-22: the Dad version of the Mom
  // fill-in book on For Her goes on Him. Amazon, price read 2026-11-22.
  { name: "Just a Few Things I Love About You, Dad", brand: "", line: "A fill-in book of all the reasons you love him.", href: amz("B0GWXJ3PYM"), image: amzImg("61kkHlm55KL"), store: "store-amazon", sortPrice: 17.99, commission: 4.5, type: "book", priceAt: "2026-11-22" },
].map((r) => (Array.isArray(r) ? row(r) : r)).concat(HIM_AMAZON_MORE_1121, HIM_SHOPMY_1121);

/**
 * Her kids' ShopMy saves (Desktop note Kids-saved-shopmy-1121.md, 54 pins), 16 kept by her rules: at most 2 of a brand
 * (Melissa & Doug made ~22 of them, at Macy's, Wayfair and Over The Moon), 2 of an item type, nothing out of stock.
 * Counts and prices measured 2026-11-21 on each store's own page (Maisonette, Grove, Wayfair).
 */
export const KIDS_SHOPMY_1121 = [
  ["108632461", 34.99, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/eWo2uVncVtpsQvebn-mR5bF0A.jpg", "Steffi Love Baby Doctor Doll Playset", "Simba", "store-maisonette", "doll", 16, "A doll doctor set with a baby to check on."],
  ["108632432", 20.99, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/0dnFbFKBx5K6e6OmCfMNzo-dI.jpg", "Mentari Puppy on Wheels", "Mentari", "store-maisonette", "pull-toy", 16, "A wooden puppy to pull along on a string."],
  ["108632392", 27.99, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/1ZzbSn-AD4C1Zcfr2WzDUTQmE.jpg", "Tender Leaf Toys Rocket Construction", "Tender Leaf Toys", "store-maisonette", "construction-toy", 16, "Wooden rockets to take apart and build again."],
  ["108632273", 37.79, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/CaauQ70t8wMJ7uoE4RIz-0T7I.jpg", "Mentari Wooden Ramp Racer", "Mentari", "store-maisonette", "car-toy", 16, "A wooden ramp the little cars zig-zag down."],
  ["108632257", 25.5, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/DbI113V-lJpF_YY2t9LI_4_q4.jpg", "Colored Organics Truck Bath Toys", "Colored Organics", "store-maisonette", "bath-toy", 16, "Soft trucks for bath time."],
  ["108632317", 89, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/ASDi5ER268eeqg9QDRplkfnBw.jpg", "Round & Round Spin Toy", "Asweets", "store-maisonette", "spin-toy", 16, "A wooden spinning toy that keeps them moving."],
  ["108632251", 89, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/e3bkcRFq2cOoChymkqAzOUnxU.jpg", "Sand and Water Table", "Asweets", "store-maisonette", "play-table", 16, "A wooden play table for sand and water play."],
  ["108632230", 145, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/07fMtvSKy51XUzMcnMjlI4vks.jpg", "Highwaykick 1 Scooter and Ride-On, Ash", "Scoot and Ride", "store-maisonette", "scooter", 16, "A ride-on that grows into a scooter."],
  ["108632184", 59.99, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/OED6YgUaANM9D31fVA1qZUCTA.jpg", "Freddo 3 Wheel Balance Bike", "Freddo", "store-maisonette", "balance-bike", 16, "A first balance bike for toddlers."],
  ["108632365", 299, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/xuh1iRemTEjNomia7C6j_bKqU.jpg", "Model U Horse Ride-On, Brown", "PonyCycle", "store-maisonette", "ride-on", 16, "A plush ride-on horse for little cowboys and cowgirls."],
  ["108632379", 124.94, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/EP6NaZng2SVj-x3HxemGP-5QQ.jpg", "Hape Captain's Rocking Boat", "Hape", "store-maisonette", "rocker", 16, "A wooden rocking boat for pretend voyages."],
  ["108632481", 27, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/HtPxvujQFBYNQ2lbeag2NGhew.jpg", "Baby's 1st Christmas Toy & Gifting Tote", "Bits & Bows", "store-maisonette", "bag", 16, "A plaid tote for baby's first Christmas gifts."],
  ["108632592", 29.9, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/YVDrFHlUiF5bHBL0uzS5MXo_w.jpg", "Nellapima Wooden Toys Baby Gown", "Nellapima", "store-maisonette", "baby-clothes", 16, "A soft pima baby gown with a wooden toy print."],
  ["108632104", 29.99, "https://static.shopmy.us/pins/zoom-108632104-1795250093805-DancingAlligator-5105-Main-sq.jpg", "PlanToys Dancing Alligator Pull Toy", "PlanToys", "store-grove", "pull-toy", 25, "A wiggly wooden alligator to pull along."],
  // Wayfair pays 11% on these (Commission-audit-1121-night.md); they were blank.
  ["108632077", 117.99, "https://assets.wfcdn.com/im/45146626/compr-r85/4085/408563114/Wood+Furnished+Mansion.jpg", "Melissa & Doug Wood Furnished Mansion", "Melissa & Doug", "store-wayfair", "dollhouse", 11, "A big wooden dollhouse with the furniture inside."],
  ["108632046", 55.99, "https://assets.wfcdn.com/im/84968246/compr-r85/1747/174755531/Preschool+Pretend+Grocery+Shopping+Accessories+with+Kitchen+Accessories.jpg", "Melissa & Doug Toy Shopping Cart", "Melissa & Doug", "store-wayfair", "pretend-play", 11, "A sturdy metal shopping cart for pretend errands."],
  // Owner 11-21 ("same for the kids, add all items i had on the things"; caps off for her picks): every other kids save
  // still sold, priced on maisonette.com, wayfair.com and macys.com 2026-11-21. Left out, 2026-11-21: sold out or
  // unavailable at the store her pin goes to (Maisonette vanity, dress-up unit, customizable tote, garbage truck, 4-wheel
  // bike, Mustang, both torches, marble run, stacking jungle animals; Over The Moon music board; Macy's alphabet, tool
  // kit, stacking trains, block cart, ABC/123 blocks, wallet, Hi-Rise dollhouse, Beep-Beep, car loader, parking garage,
  // locks and latches, picture boards, jungle table, Mine to Love doll, cutting food box) and the Danny Digger (not listed).
  ["108632430", 329, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/unORD3VQuzDRRzbMq1w_2taVM_6b58675d-6a24-48b1-8321-f3c6a6bc0c79.jpg", "Model U Zebra Ride-On", "PonyCycle", "store-maisonette", "ride-on", 16, "A plush zebra ride-on for little riders."],
  ["108632133", 84.99, "https://cdn.shopify.com/s/files/1/0583/2323/8975/files/x2IuT5-1A8vUEdadpwkoOvMBw.jpg", "Freddo Swing Car with Flashing Wheels", "Freddo", "store-maisonette", "ride-on", 16, "A wiggle car with light-up wheels."],
  // RATE SWITCH 11-21 night (Commission-rates-search-1121-night.md): was Wayfair p-108632086 at 11% ($28.76; Wayfair's card
  // now $34.99); the same 24-piece box at Macy's at 16% (p-109002741), $32.99. Same box photo.
  ["109002741", 32.99, "https://assets.wfcdn.com/im/03058393/compr-r85/1765/176593778/24+Piece+Melissa+%26+Doug+Jumbo+Cardboard+Blocks+Learning+Tools.jpg", "Melissa & Doug Jumbo Cardboard Blocks, 24 Pieces", "Melissa & Doug", "store-macys", "blocks", 16, "Big cardboard bricks for towers and forts."],
  // Owner 2026-11-22 PM (builder-guide-emibauble): the Melissa & Doug Kids Club Chair (Wayfair p-108632059, $74.99) is off;
  // the personalized Pottery Barn Kids Anywhere Chair takes its place (scripts/giftGuideOwnerAdds1122.mjs).
  ["108632004", 23.49, "https://slimages.macysassets.com/is/image/MCY/products/2/optimized/1779252_fpx.tif", "Melissa & Doug Wooden Doorbell House", "Melissa & Doug", "store-macys", "pretend-play", 16, "A lock-and-key doorbell house with little dolls."],
  ["108631991", 43.49, "https://slimages.macysassets.com/is/image/MCY/products/5/optimized/8290245_fpx.tif", "Melissa & Doug Double-Sided Magnetic Tabletop Easel", "Melissa & Doug", "store-macys", "art", 16, "A tabletop easel with a chalkboard and a dry-erase side."],
  ["108631978", 17.99, "https://slimages.macysassets.com/is/image/MCY/products/8/optimized/1836568_fpx.tif", "Melissa & Doug Pull-Back Vehicle Toys", "Melissa & Doug", "store-macys", "car-toy", 16, "Soft pull-back cars that zoom across the floor."],
].map(shop);

/**
 * The rest of her Amazon kids list (owner 11-21: "same for the kids, add all items i had on the things"; brand and type
 * caps off for her own picks): every row of Kids-saved-amazon-1121.md not already above (18), at her list's captured
 * price. The kids camera's title was cut in the capture; Amazon's page names it a YEEHAO kids digital camera (11-21).
 */
export const KIDS_AMAZON_MORE_1121 = [
  ["B0HGX9TVW6", 23.72, "511xpoNUL0L", "Skillmatics Aqua Puffs Christmas Ornaments", "Skillmatics", "craft", 3, "Puffy paint-by-number ornaments they make with water."],
  ["B0FG2Z88P7", 9.99, "51HHk4qty0L", "JoyCat Christmas Paint with Water Books", "JoyCat", "book", 3, "Mess-free paint with water pages for toddlers."],
  ["B0D6RMZ3D1", 17.79, "51KltfpitTL", "YEEHAO Kids Digital Camera", "YEEHAO", "camera", 3, "A dual-lens kids camera for photos, videos and selfies."],
  ["B0D5ZN2YL8", 12.73, "51OP9VO0RuL", "Cupkin Christmas Sticker Book with Coloring Pages", "Cupkin", "book", 3, "A Christmas sticker book with coloring pages."],
  ["B0DB9JTTJQ", 18.99, "51T6IcL0NTL", "CreateOn Crayola Holiday Glitter Magnetic Tiles", "CreateOn", "building-toy", 3, "Sparkly magnetic tiles to build a holiday scene."],
  ["B0DCVF7YNW", 18.98, "41305yNiLyL", "Kinglucky Mini Karaoke Machine for Kids", "Kinglucky", "karaoke", 3, "A mini karaoke machine with a microphone."],
  // Amazon pays 1% on video game consoles, not 3% (Commission-audit-1121-night.md).
  ["B0F3GWXLTS", 499, "41A6+lQ6KSL", "Nintendo Switch 2", "Nintendo", "game-console", 1, "The new Nintendo Switch 2."],
  ["B0FJ2ZHPDY", 99.99, "41cXR296U-L", "Toniebox 2 Starter Set, Cloud Pink", "tonies", "audio", 3, "A screen-free story and music player in pink."],
  ["B0F62SVY89", 271.68, "31Bsjq4rZGL", "Segway Ninebot E2 Plus II Electric Scooter", "Segway", "scooter", 3, "A full-size electric scooter for teens."],
  // RATE SWITCH 11-21 night (Commission-rates-search-1121-night.md): was Amazon B0CT2WN59R at 3% ($484.49); the same black Segway S2 at Tractor Supply
  // (item 6017105) at 8% (p-109001528), $484.99. Photo: Tractor Supply's own product shot.
  { name: "Segway Ninebot S2 Self-Balancing Scooter", brand: "Segway", line: "A self-balancing scooter for big kids and teens.", href: shopmy("p-109001528"), image: "https://media.tractorsupply.com/is/image/TractorSupplyCompany/6017105?wid=1000&hei=1000", store: "store-tractor-supply", sortPrice: 484.99, price: 484.99, commission: 8, type: "hoverboard" },
  ["B09GXDQ122", 11.6, "41g75nJNagL", "Would You Rather Book for Kids", "", "book", 3, "Silly would-you-rather questions for car rides."],
  ["B0GT16T874", 14.98, "51u+SjYL7DL", "Taba Squishies Fidget Toys, 3 Pack", "", "squishy", 3, "Three squishy fidget toys to squeeze."],
  ["B0DDLZV8YM", 23.73, "51VHRxyCCdL", "Magic Gel Water Pets Kit", "", "craft", 3, "Make little gel water pets that come to life."],
].map((r) => (Array.isArray(r) ? row(r) : r));

// owner 11-22 kids play saves (builder-guide-adds-kids): her ShopMy play pins, prices read from the store pages 11-22.
export const KIDS_PLAY_1122 = [
  ["109160969", 134.99, "https://assets.wfcdn.com/im/01322405/compr-r85/2562/256287082/Step2+Up+&+Down+Platinum+Edition+Kids+Outdoor+Roller+Coaster.jpg", "Step2 Up & Down Roller Coaster", "Step2", "store-wayfair", "backyard-play", 11, "A backyard roller coaster that rolls up and down on its own track."],
  ["109160922", 96.99, "https://assets.wfcdn.com/im/04010235/compr-r85/1549/154922896/Step2+Play+&+Shade+Pool+with+Umbrella.jpg", "Step2 Play & Shade Pool", "Step2", "store-wayfair", "backyard-play", 11, "A kiddie pool with its own shade umbrella."],
  ["109160891", 130.99, "https://assets.wfcdn.com/im/06003087/compr-r85/2642/26426235/Step2+Naturally+Playful+Kids+Rectangle+Picnic+Table+with+Umbrella.jpg", "Step2 Picnic Table with Umbrella", "Step2", "store-wayfair", "backyard-play", 11, "A kid-size picnic table with shade for snacks and crafts outside."],
  ["109160773", 74.99, "https://assets.wfcdn.com/im/91322669/compr-r85/3379/337962490/Step2+Play+and+Fold+Jr.+Slide+and+Outdoor+Climber+for+Toddlers.jpg", "Step2 Play & Fold Jr. Slide and Climber", "Step2", "store-wayfair", "backyard-play", 11, "A toddler slide and climber that folds flat to store."],
  ["109160887", 194.99, "https://assets.wfcdn.com/im/24091129/compr-r85/2504/250478864/Step2+Crabbie+Sandbox+Plastic+Toddler+Outdoor+Sand+Box+with+Cover.jpg", "Step2 Crabbie Sandbox with Cover", "Step2", "store-wayfair", "backyard-play", 11, "A crab-shaped sandbox with a cover to keep the sand clean."],
  ["109160813", 47.99, "https://assets.wfcdn.com/im/07610885/compr-r85/2501/250137763/Step2+Infant+Plastic+Bucket+Swing.jpg", "Step2 Infant Bucket Swing", "Step2", "store-wayfair", "backyard-play", 11, "A snug bucket swing for the littlest ones."],
  ["109160795", 98.99, "https://assets.wfcdn.com/im/81918077/compr-r85/2501/250137563/Step2+Wagon+for+Two+Blue+2+Seat+Toddler+Outdoor+Riding+Toy.jpg", "Step2 Wagon for Two", "Step2", "store-wayfair", "backyard-play", 11, "A two-seat wagon for pulling a friend around the yard."],
  ["109160719", 49.99, "https://assets.wfcdn.com/im/11517987/compr-r85/2502/250235023/Step2+All+Around+Red+Easel+for+Two+Folding+Board+Easel.jpg", "Step2 All Around Easel for Two", "Step2", "store-wayfair", "backyard-play", 11, "A folding easel with room for two artists."],
  ["109160708", 153.99, "https://assets.wfcdn.com/im/45408439/compr-r85/2500/250031609/Step2+Panda+Climber+Outdoor+Climbing+Toy+for+Toddlers.jpg", "Step2 Panda Climber", "Step2", "store-wayfair", "backyard-play", 11, "A panda-shaped climber and slide for toddlers."],
  ["109160660", 72.99, "https://assets.wfcdn.com/im/96916567/compr-r85/2500/250033102/Step2+Gray+2-in-1+Toy+Box.jpg", "Step2 2-in-1 Toy Box and Art Lid", "Step2", "store-wayfair", "backyard-play", 11, "A toy box whose lid flips into a drawing table."],
  ["109160077", 229.99, "https://slimages.macysassets.com/is/image/MCY/products/7/optimized/26752727_fpx.tif", "PLAY22USA 10 ft Adjustable Basketball Hoop", "PLAY22USA", "store-macys", "sports", 16, "An adjustable driveway hoop that grows with them up to 10 ft."],
  // owner 11-22 kids picks 2 (builder-guide-kids2): prices read from the store pages 11-22. Step2 water table is a ShopMy-created Target link (4%), logged in ShopMy-links-created-1122.md.
  ["109218761", 84.99, "https://target.scene7.com/is/image/Target/GUEST_e24e9f30-ae18-4fd5-b2c0-e0bee49629b0", "Step2 Rain Showers Splash Pond Water Table", "Step2", "store-target", "backyard-play", 4, "A splash-pond water table with a rain shower to play under."],
  ["107902887", 54.95, "https://static.shopmy.us/uploads/pretty-prod-1764597442673", "Burt's Bees Baby Little Ducks Bath Time Gift Set", "Burt's Bees Baby", "store-burts-bees-baby", "baby-clothes", 12, "A duck-print bath time set for baby, packed in its own tote."],
  ["108100673", 21.6, "https://static.shopmy.us/pins/zoom-108100673-1795144222288-WXZdEMYzF3p1mC184cAVhLxQo.jpg", "Angel Dear American Ducks Short Sleeve Loungewear Set", "Angel Dear", "store-maisonette", "kids-pajamas", 16, "Snug-fit duck-print pajamas with teal cuffs, on sale at Maisonette."],
  ["107895388", 19.99, "https://static.shopmy.us/pins/zoom-107895388-1795118461682-6165186", "Duck Commander Build Your Own Starter Call", "Duck Commander", "store-tractor-supply", "duck-call", 8, "A build-your-own duck call kit for a little hunter."],
].map((r) => ({ ...shop(r), priceAt: "2026-11-22" }));


export const KIDS_1121 = [
  // Paint by Sticker Kids: Christmas (152350675X) came off (owner 2026-11-22 8:58 PM pop-up, "take it off"): Amazon has no
  // Buy Box for it and no other listing of the same book (links audit 1122 night #4).
  ["B0CFFZ389Y", 5.42, "41ulOjt6aQL", "Colgate Minecraft Kids Toothbrush", "Colgate", "toothbrush", 3, "A Minecraft toothbrush for the stocking."],
  ["B0FVX689L4", 7.99, "517ur30uekL", "Christmas Joke Book for Kids", "", "book", 3, "Silly Christmas jokes to read out loud."],
  ["B0G36VXNGX", 8.99, "51JNHGNSDML", "Slimygloop Squishmallows Slime", "Slimygloop", "slime", 3, "Squishmallows slime in a jar, ready to squish."],
  ["B0H9ZZGK8W", 9.98, "41YnNH+Nc1L", "Crunchy Butter Squishy Toy", "", "squishy", 3, "A slow-rise butter squishy kids love to squeeze."],
  ["B0G2KJ8V5R", 10.29, "41orTVxng-L", "LEGO Snowman Ornaments", "LEGO", "ornament", 3, "Little LEGO snowmen to build and hang on the tree."],
  ["B0DTJWSVWG", 11.89, "71wfzJhV-aL", "Handmade Hamster Squishy Toy", "", "squishy", 3, "A soft little hamster to squish."],
  ["B0H4V6PMJH", 13.76, "31N9f2HrjpL", "YOOLIFE Sling Bag", "YOOLIFE", "bag", 4, "A small sling bag for their things on the go."],
  ["B079D7XHSY", 14.98, "51QvTU7g3QL", "Flipslide Game", "Flipslide", "game", 3, "Flip, slide and match the colors to beat the clock."],
  ["B0CDN1M1FY", 14.99, "51McprPS33L", "Glitter Tattoo Kit for Kids", "", "craft", 3, "Sparkly temporary tattoos they can do themselves."],
  ["B08GJP4HHB", 16.24, "41uXOHhi22L", "Amazmic Kids Karaoke Microphone", "Amazmic", "karaoke", 3, "A wireless microphone with a speaker built in."],
  ["B08FL61CKL", 17.49, "41xk7crlTpL", "Shashibo Shape Shifting Box", "Shashibo", "fidget", 3, "A magnetic puzzle box that folds into many shapes."],
  ["B08199W8C1", 17.76, "41Dg5KQw2iL", "Piggy Bank ATM for Kids", "", "bank", 3, "A toy ATM that counts their savings."],
  ["B0F9WHCL19", 18.02, "51nPSRxPVkL", "Skillmatics Aqua Puffs Animals", "Skillmatics", "craft", 3, "Puffy animals they make with just water."],
  ["B0CJYKM4FT", 18.74, "51XHsO7ZoML", "Paint Vortex Spin Art Machine", "", "art", 3, "Drip, spin and make a new painting every time."],
  ["B0CHX4W2HH", 18.74, "51fb0MK08LL", "5-in-1 Voice Changer for Kids", "", "toy", 3, "Turns their voice into a robot, a monster and more."],
  ["B0CFDW7GNB", 18.99, "41R0Eb7bX5L", "Rechargeable Handheld Game Cube", "", "game", 3, "A light-up cube of quick games to play anywhere."],
  ["B0DCW1YDYG", 18.99, "4120eXGXT5L", "Ankle Skip Ball with Counter", "", "outdoor", 3, "A light-up skip ball that gets them moving."],
  ["B0GGTL1S8X", 19.55, "41EOHLPbf5L", "MAGNA-TILES microMAGS", "MAGNA-TILES", "building-toy", 3, "Tiny magnetic tiles for travel-size building."],
  ["B00FFJZ010", 23.74, "51ERLLeAYML", "Stomp Rocket Ultra LED", "Stomp Rocket", "rocket", 3, "Stomp to launch light-up rockets into the sky."],
  ["B0BP7JJWHC", 24.68, "417A8f8E5FL", "Kids Smart Watch, Ages 5-12", "", "watch", 3, "A first smart watch with games and a camera."],
  ["B0FXX575KP", 24.69, "41xKa3PEKPL", "Video Walkie Talkies, 2 Pack", "", "walkie-talkie", 3, "Walkie talkies with a screen so they can see each other."],
  ["B0FFSSWTB6", 25.49, "41htdnfvDsL", "Kids Handheld Digital Microscope", "", "science", 3, "A pocket microscope to see bugs and leaves up close."],
  // Links audit 1122 night #4: her saved color (Pink, B0084JUNVU) had no Buy Box, so the link is the same pad in Blue,
  // sold and shipped by Amazon.com, $30.19 read on its page 2026-11-22.
  { ...row(["B0084JUNXS", 30.19, "911TfZHJ1WL", "Crayola Light Up Tracing Pad", "Crayola", "art", 3, "A light-up pad that makes tracing easy."]), priceAt: "2026-11-22" },
  ["B0C9JLBY6V", 29.99, "514xs6sgmgL", "TOSY Light Up Flying Disc", "TOSY", "outdoor", 3, "A glowing flying disc for night games in the yard."],
  ["B0C6DXY5KC", 33.99, "41eg63OvH3L", "Kids Instant Print Camera", "", "camera", 3, "A camera that prints their photos right away."],
  ["B0CSJQHF6W", 34.11, "31TnRWQijXL", "Bitzee Disney Digital Pet", "Bitzee", "digital-pet", 3, "Disney pets they can touch and care for."],
  ["B000CBSNKQ", 34.99, "51x87JEhZSL", "MAGNA-TILES Classic 32 Piece Set", "MAGNA-TILES", "building-toy", 3, "The magnetic tiles kids play with for years."],
  ["B0B4JXZJYY", 37.99, "51+Bm+W7PvL", "Light Up Dance Mat", "", "dance", 3, "A dance mat with music, lights and games."],
  ["B0G2T2Q1RH", 39.92, "5135kn6g9LL", "LEGO Gingerbread House", "LEGO", "building-set", 3, "A LEGO gingerbread house to build together."],
  ["B0DTQ6TQ66", 42.49, "51paeZhFMML", "Kids Sensory Spinning Chair", "", "chair", 3, "A sit-and-spin chair that burns off energy."],
  ["B0D1VJMSQG", 45.89, "51AVvCaDOJL", "Karaoke Machine with 2 Wireless Mics", "", "karaoke", 3, "A karaoke machine with two microphones and lights."],
  ["B0F1N2MPND", 49.99, "41BGMLCnjyL", "Kids Hammock Chair with Cup Holder", "", "chair", 3, "A hanging pod chair for a cozy reading spot."],
  ["B0CJG3CV9P", 59.99, "41+qTY2lFEL", "Soccer Bot Indoor Soccer Game", "", "sports", 3, "A robot ball that dodges while they chase it."],
  ["B07PXR5J2D", 69.99, "51oZx3zY9dL", "LeapFrog Magic Adventures Globe", "LeapFrog", "learning", 3, "A talking globe with videos from around the world."],
  ["B081RJ8DW1", 80.02, "41XdbpXmFvL", "Gskyer Telescope", "Gskyer", "science", 3, "A real starter telescope for the moon and stars."],
  ["B0FJ3S78NR", 99.97, "41PRwqm4mXL", "Toniebox 2, Sky Blue", "tonies", "audio", 3, "A screen-free story and music player."],
  ["B0HDSSPY7Z", 127.49, "21gcm6OqZ0L", "Segway Ninebot C2 Go Kids Scooter", "Segway", "scooter", 3, "An electric scooter made for kids."],
  ["B0D2JGYX3F", 209, "31HNx5am69L", "Nex Playground", "Nex", "game-console", 3, "Active family games that get everyone moving."],
  ["B07V4GCFP9", 229, "31CHVspmUeL", "Nintendo Switch Lite", "Nintendo", "game-console", 1, "The handheld Switch for games on the go."],
  // owner 11-22 kids tech (builder-guide-adds-kids): the owner asked for popular tech; prices captured from Amazon 11-22.
  ["B0G4SCX27Q", 382, "61B-A4JhE9L", "Meta Quest 3S VR Headset, 256GB", "Meta", "vr", 3, "A mixed-reality headset for games and fitness, made for ages 10 and up."],
  ["B0D3WSFX3L", 26.56, "717IFJm-ZNL", "JLab JBuddies Studio 2 Wireless Kids Headphones", "JLab", "audio", 3, "Volume-limited Bluetooth headphones that fold up and keep little ears safe."],
  ["B0DZ77D5HL", 399, "61Q-vahOT9L", "Apple iPad 11-inch (A16, 128GB, Wi-Fi)", "Apple", "tablet", 3, "The iPad they will actually use for games, drawing and school."],
].map((r) => (Array.isArray(r) ? row(r) : r)).concat(KIDS_AMAZON_MORE_1121, KIDS_SHOPMY_1121, KIDS_PLAY_1122);

// owner 11-22 popular approved (builder-guide-popular): Kids, Amazon listings sold by Amazon.com, prices read 11-22.
export const KIDS_POPULAR_1122 = [
  ["B0FX3KW535", 30, "81NKE8LAWEL", "Tickle Me Elmo Giggle Max", "Sesame Street", "plush", 3, "The giggling Elmo everyone is asking for."],
  ["B0G497FGT6", 21, "81pheFGgbRL", "GUI GUI Mega Slime Haul", "GUI GUI", "slime", 3, "Five scented slimes and 50+ add-ins."],
  ["B0GH39S2GJ", 83, "815HwqBZIVL", "PAW Patrol Dino Movie Megasaurus Vehicle", "PAW Patrol", "vehicle-toy", 3, "A big dino rescue vehicle with an inflatable dino."],
  ["B0G4SR68GB", 44, "812ct6B-M+L", "Fisher-Price Little People My Mario Adventure Playset", "Fisher-Price", "playset", 3, "A toddler-size Mario world to play in."],
  ["B0GHBKG64Q", 35, "81MHgjNu-UL", "Primal Hatch Megalodon Hatching Egg", "Primal Hatch", "hatching-toy", 3, "Crack open the egg and a shark hatches."],
  ["B0G3RKYTMS", 170, "81jI7-Pm4TL", "Bluey Light and Surprise Heeler House", "Bluey", "dollhouse", 3, "The 28-inch Heeler house with lights and surprises."],
  ["B000FGECAI", 10, "712W+h7AF6L", "Kanoodle Brain Teaser Puzzle Game", "Educational Insights", "puzzle", 3, "A pocket puzzle game with 200+ challenges."],
  ["B0G2T1VN17", 175, "81lwvfbDd8L", "LEGO City Lava Land Roller Coaster Park 60501", "LEGO", "building-set", 3, "A build-it roller coaster park."],
  ["B0GWKJG2XR", 145, "71KXM3QhGbL", "American Girl Disney Frozen Elsa 18-inch Doll", "American Girl", "doll", 3, "Elsa as an 18-inch American Girl doll."],
].map(row).map((r) => ({ ...r, priceAt: "2026-11-22" }));

// owner 11-22 popular approved (builder-guide-popular): Him, Amazon listings sold by Amazon.com or the brand, prices read 11-22.
export const HIM_POPULAR_1122 = [
  ["B0FQFB8FMG", 169.99, "61solmQSSlL", "Apple AirPods Pro 3", "Apple", "earbuds", 1, "Noise-cancelling earbuds he will use daily."],
  ["B0GJTXVN9Z", 79, "611DjYhflAL", "Apple AirTag 4 Pack", "Apple", "tracker", 1, "Keys, wallet, bag: never lost again."],
  ["B0GXW9C8QC", 219, "615XBVqPGaL", "Bose QuietComfort Headphones, 2nd Gen", "Bose", "headphones", 3, "Noise-cancelling over-ear headphones with big sound."],
  ["B0CT3SGHXL", 191.99, "61m+fKy7wzL", "Garmin Forerunner 165 Running Smartwatch", "Garmin", "smartwatch", 3, "A bright running watch that tracks every mile."],
  ["B0GCGGWC1M", 349, "61YEzBsddpL", "Gozney Arc Lite Propane Pizza Oven", "Gozney", "pizza-oven", 4, "Real wood-fired-style pizza in his backyard."],
].map(row).map((r) => ({ ...r, priceAt: "2026-11-22" }));

// owner 11-23 keeps from the under-$25 suggestions (scripts/giftGuideOwnerKeeps1123.mjs), Amazon, priced 11-23.
export const HIM_KEEPS_1123 = HIM_KEEPS_1123_ROWS.map(row).map((r) => ({ ...r, priceAt: KEEPS_PRICE_AT }));
export const KIDS_KEEPS_1123 = KIDS_KEEPS_1123_ROWS.map(row).map((r) => ({ ...r, priceAt: KEEPS_PRICE_AT }));
// ... and the keeps whose ShopMy links she made 11-23 (Lodge skillet; Maisonette and Burt's Bees Baby), priced 11-23.
export const HIM_LINKS_1123 = HIM_LINKS_1123_ROWS.map(shop).map((r) => ({ ...r, priceAt: KEEPS_PRICE_AT }));
// ... and the Dearfoams slippers on her Walmart Creator link (lead 11-23 ~2:20 PM), priced on walmart.com 11-23.
const walmart = ([href, price, image, name, brand, type, commission, line]) => ({ name, brand, line, href, image, store: "store-walmart", sortPrice: price, price, commission, type });
export const HIM_WALMART_1123 = HIM_WALMART_1123_ROWS.map(walmart).map((r) => ({ ...r, priceAt: KEEPS_PRICE_AT }));
// ... and the Kids gifts from her Walmart "Claude" collection (lead 11-23 ~2:50 PM), priced on walmart.com 11-23.
export const KIDS_WALMART_1123 = KIDS_WALMART_1123_ROWS.map(walmart).map((r) => ({ ...r, priceAt: KEEPS_PRICE_AT }));
export const KIDS_LINKS_1123 = KIDS_LINKS_1123_ROWS.map(shop).map((r) => ({ ...r, priceAt: KEEPS_PRICE_AT }));

const isAmazon = (p) => p.store === "store-amazon" || /^https:\/\/(www\.)?amazon\.com\//.test(p.href);

const build = (rows, slug, g) =>
  rankByPrice(rows).map(({ row: r, priceRank }) => {
    const { sortPrice: _sp, price, ...rest } = r;
    const p = { ...rest, image: isAmazon(r) ? r.image : cutoutPhoto(r.image), ownerPick: true, from: slug, priceRank };
    // AMAZON PRICES ON (owner 2026-11-21 ~12:05 PM: "each item also needs a price"; she chose "Show Amazon prices
    // anyway" after the Associates warning): an Amazon pick shows the price captured from her saved list (sortPrice).
    const shown = isAmazon(r) ? r.sortPrice : price;
    if (typeof shown === "number" && shown > 0) Object.assign(p, { price: shown, priceAt: recheckedPriceAt(r.href, shown, r.priceAt ?? HIM_KIDS_PRICE_AT) });
    return { ...p, rels: g ? relsOf(g, p) : [] };
  });

/** For Him, cheapest first, each pick tagged with the men's relationships it suits. */
export function him1121Picks(rows = [...HIM_1121, ...HIM_ADDS_1122, ...HIM_POPULAR_1122, ...HIM_KEEPS_1123, ...HIM_LINKS_1123, ...HIM_WALMART_1123]) {
  return build(rows, HIM_GUIDE, PEOPLE_GUIDES.find((x) => x.slug === HIM_GUIDE));
}
/** For Kids, cheapest first. Kids has no relationship pages, so no tags. */
export function kids1121Picks(rows = [...KIDS_1121, ...KIDS_ADDS_1122, ...KIDS_POPULAR_1122, ...KIDS_KEEPS_1123, ...KIDS_LINKS_1123, ...KIDS_WALMART_1123]) {
  return build(rows, KIDS_GUIDE, null);
}

/**
 * Replace the Him and Kids pages with the owner's lists (and, given the store list, name any store a switched pick goes
 * to that it lacks, with the pick's link host). Returns the counts for the build log.
 */
export function applyHimKids1121(pageList, storeList = null) {
  const out = {};
  for (const [slug, picks] of [[HIM_GUIDE, him1121Picks()], [KIDS_GUIDE, kids1121Picks()]]) {
    out[slug] = { before: (pageList[slug] ?? []).length, after: picks.length };
    pageList[slug] = picks;
    if (!storeList) continue;
    for (const p of picks) {
      if (isAmazon(p)) continue;
      const host = new URL(p.href).hostname;
      storeList[p.store] ??= { name: HIM_KIDS_STORES[p.store] ?? ADDS_STORES_1122[p.store] ?? p.store, hosts: [] };
      if (!storeList[p.store].hosts.includes(host)) storeList[p.store].hosts = [...storeList[p.store].hosts, host].sort();
    }
  }
  return out;
}
