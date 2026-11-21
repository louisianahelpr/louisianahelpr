/**
 * FOR HIM and FOR KIDS = THE OWNER'S SAVES (owner 2026-11-21 ~2:15 AM: "i also added the mens stuff to the amazon men
 * list"; ~2:45 AM: "i did kids too in amazon list"; ~2:47 AM: "add all oft he things to the guides. fix them how you
 * see fit. launch the 3 guides"). Both pages hold ONLY picks she saved herself, from her Amazon lists (Desktop notes
 * Him-saved-amazon-1121.md and Kids-saved-amazon-1121.md) and her ShopMy links (below), tidied by her standing rules: at
 * most 2 of one brand and 2 of one item type per page, men in classic colors, no Louisiana brands, cheaper first.
 *
 * HER SHOPMY SAVES 11-21 (owner ~2:45 AM: "i also added some man and kids stuff in shop my"; later: "the him and kids
 * need gifts on their covers"): HIM_SHOPMY_1121 and KIDS_SHOPMY_1121 add the ones her rules keep (Desktop notes
 * Him-saved-shopmy-1121.md and Kids-saved-shopmy-1121.md; also no LSU, nothing out of stock). Their non-Amazon photos are
 * what the Him and Kids covers draw.
 *
 * scripts/gift-guide-picks.mjs runs applyHimKids1121 LAST, next to applyHer1121, so no earlier pass can drop or reorder
 * these. Page rules are the same as For Her (scripts/giftGuideHer1121.mjs): ONE flat list, cheapest first, no sections,
 * no relationship chips, no codes or deals box (OWNER_LIST_GUIDES in src/content/giftGuidePeople.mjs). An Amazon pick
 * carries no price (Associates rule) and keeps Amazon's own photo, never edited; `sortPrice` is the price she saw, used
 * only to order the list. COMMISSION SWITCHES 11-21 (owner: "if the items on the guides can we fund at another place
 * for higher commison just change the link"; same item, same price, better-paying store): those few picks are ShopMy
 * links instead, and like For Her's ShopMy picks they show their price checked 11-21 and a transparent cutout of the
 * new store's own photo (scripts/giftGuideCutouts1120.mjs), never Amazon's. Him picks keep their relationship tags
 * (`rels`), so /dad, /husband ... still build from this list.
 * Guard: src/test/giftGuideHimKids1121.test.ts.
 */
import { PEOPLE_GUIDES } from "../src/content/giftGuidePeople.mjs";
import { relsOf } from "./giftGuidePeople1120.mjs";
import { cutoutPhoto } from "./giftGuideCutouts1120.mjs";
import { rankByPrice } from "./giftGuidePriceRank1121.mjs";

export const HIM_GUIDE = "him";
export const KIDS_GUIDE = "kids";
const amz = (asin) => `https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20`;
const amzImg = (id) => `https://m.media-amazon.com/images/I/${id}._SL500_.jpg`;
const shopmy = (pin) => `https://go.shopmy.us/${pin}`;
/** The day the switched picks' ShopMy prices were checked (Louisiana day). */
export const HIM_KIDS_PRICE_AT = "2026-11-21";
/** Stores a switched pick goes to that the store list may not hold yet (key -> shown name). */
export const HIM_KIDS_STORES = {
  "store-dillards": "Dillard's", "store-exclusive-beauty-club": "Exclusive Beauty Club",
  // The owner's ShopMy saves for Him and Kids (11-21).
  "store-smathers-and-branson": "Smathers & Branson", "store-duck-head": "Duck Head", "store-grove": "Grove",
  "store-clinique": "Clinique", "store-maisonette": "Maisonette", "store-wayfair": "Wayfair",
};
/** One row per pick: [ASIN, price she saw, Amazon image id, name, brand, type, commission %, line]. */
const row = ([asin, sortPrice, img, name, brand, type, commission, line]) => ({ name, brand, line, href: amz(asin), image: amzImg(img), store: "store-amazon", sortPrice, commission, type });
/** One of her ShopMy saves: [pin, price on the store's own page 11-21, store photo, name, brand, store, type, commission %, line]. */
const shop = ([pin, price, image, name, brand, store, type, commission, line]) => ({ name, brand, line, href: shopmy(`p-${pin}`), image, store, sortPrice: price, price, commission, type });

/**
 * Her men's ShopMy saves (Desktop note Him-saved-shopmy-1121.md, 43 pins), 8 kept by her rules: at most 2 of a brand
 * (Smathers & Branson made ~30 of them; the camo belt she saved at Duck Head is theirs too), 2 of an item type, no LSU,
 * nothing out of stock. Prices read on each store's own page 11-21 (Grove, Clinique, Smathers & Branson, Duck Head).
 */
export const HIM_SHOPMY_1121 = [
  ["108628349", 35, "https://static.shopmy.us/pins/zoom-108628349-1795247477620-DuckDecoys_AntiqueBlue__KeyFob_Primary_LowRes_c251e80f-b48c-4193-88c2-0b366856e967.jpg", "Smathers & Branson Duck Decoys Needlepoint Key Fob", "Smathers & Branson", "store-smathers-and-branson", "accessory", 15, "A hand-stitched needlepoint key fob with a wood duck."],
  ["108628518", 195, "https://static.shopmy.us/uploads/img-product-1792092560933", "Smathers & Branson Camo Needlepoint Belt", "Smathers & Branson", "store-duck-head", "belt", 16, "A hand-stitched needlepoint belt in classic camo."],
  ["108626053", 15.99, "https://static.shopmy.us/pins/zoom-108626053-1795245908121-FaceBeardSerum.jpg", "Phil's Face + Beard Serum", "Phil's", "store-grove", "skincare", 25, "A light serum for his face and beard."],
  ["108626008", 7.49, "https://static.shopmy.us/pins/zoom-108626008-1795245889562-iewmi44ymwp5whivvent.jpg", "Dr. Squatch Fresh Falls Bar Soap", "Dr. Squatch", "store-grove", "soap", 25, "The natural men's soap with a fresh, woodsy scent."],
  ["108626036", 18, "https://static.shopmy.us/pins/zoom-108626036-1795245900235-scay0j7x7kubjvla5qrv.jpg", "Dr. Squatch Hand and Body Lotion, Wood Barrel Bourbon", "Dr. Squatch", "store-grove", "lotion", 25, "A rich lotion in the Wood Barrel Bourbon scent."],
  ["108625988", 8.49, "https://static.shopmy.us/pins/zoom-108625988-1795245880004-qtvoydnznvaowxmbx9or.jpg", "Method Men Body Wash, Sea + Surf", "Method", "store-grove", "body-wash", 15, "A fresh sea and surf body wash for his shower."],
  ["108625882", 29.4, "https://www.clinique.com/cdn/shop/files/cl_sku_V2Y701_3000x3000_0.png", "Clinique For Men Oil-Free Moisturizer", "Clinique", "store-clinique", "skincare", 21, "A light gel moisturizer that never feels greasy."],
  ["108625877", 23.1, "https://www.clinique.com/cdn/shop/files/cl_sku_651705_3000x3000_0.png", "Clinique For Men Post-Shave Soother", "Clinique", "store-clinique", "shave", 21, "An aloe lotion that calms skin after a shave."],
].map(shop);

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
  ["B08P2C446P", 28, "314FhKMZAbL", "BURLEBO Cap", "BURLEBO", "hat", 4, "A broken-in cap from a Southern outdoor brand."],
  ["B01KTULYO6", 28.58, "41jWsAeRoHL", "Legendary Whitetails Buck Camp Flannel", "Legendary Whitetails", "shirt", 4, "A thick flannel shirt he will reach for all season."],
  ["B09R5TGLFR", 31.9, "51eZqCXlw0L", "Chemical Guys Car Cleaning Kit", "Chemical Guys", "car-care", 3, "Everything to wash and shine his truck."],
  ["B0CKMF6GPZ", 32.99, "41uo6lSsK3L", "HOSHANHO Fillet Knife", "HOSHANHO", "knife", 3, "A sharp, flexible fillet knife for the catch."],
  ["B0076R6MN4", 34.5, "41gvAlcoEhL", "Columbia Steens Mountain Fleece Jacket", "Columbia", "jacket", 4, "The full-zip fleece that goes with everything."],
  ["B0FDY7G84C", 40, "41t6YK7Y+RL", "YETI Rambler 20 oz Tumbler", "YETI", "drinkware", 4.5, "Keeps his coffee hot through the whole drive."],
  ["B0CPHY1VZL", 41.94, "41VLSmU2SBL", "HUK Pursuit Fishing Shirt", "HUK", "shirt", 4, "A cool, quick-dry shirt for long days on the boat."],
  ["B0F2K9B696", 44.99, "31V+5B67tTL", "HEYDUDE Wally", "HEYDUDE", "shoes", 4, "Light slip-ons he can wear anywhere."],
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
  ["B0DGZ45WB2", 89.6, "31w-q2iXR+L", "Sperry Authentic Original Boat Shoe", "Sperry", "shoes", 4, "The classic leather boat shoe."],
  ["B08Q1RN656", 93.75, "41awlHUVBzL", "XTRATUF Ankle Deck Boot", "XTRATUF", "boots", 4, "Waterproof deck boots for the boat and the yard."],
  // COMMISSION SWITCH 11-21: was Amazon B001DPHF4U at 4%; the same OD green Grange 18", same $99.95, at Dillard's at 8%.
  { name: "LaCrosse Grange Rubber Boot", brand: "LaCrosse", line: "Tall rubber boots made for mud and marsh.", href: shopmy("p-108736038"), image: "https://dimg.dillards.com/is/image/DillardsZoom/zoom/lacrosse-mens-grange-18-tall-waterproof-rubber-hunting-work-boots/00000000_zi_ac01ed80-ad36-4d40-8cca-066a3f05fcbd.jpg", store: "store-dillards", sortPrice: 99.95, price: 99.95, commission: 8, type: "boots" },
  // COMMISSION SWITCH 11-21: was Amazon B0FKCJNHWB at 1%; the same Theragun Prime 6th Gen in black, same $189.99, at
  // Exclusive Beauty Club at 16% (Therabody.com lists only the 5th gen).
  { name: "Theragun Prime Massage Gun", brand: "Therabody", line: "A massage gun for sore backs and shoulders.", href: shopmy("p-108734364"), image: "https://cdn.shopify.com/s/files/1/2959/8080/files/therabody-theragun-prime-massage-gun-black.png", store: "store-exclusive-beauty-club", sortPrice: 189.99, price: 189.99, commission: 16, type: "massager" },
  ["B0FDYD1C2N", 200, "41tgypUHtjL", "YETI Roadie 15 Hard Cooler", "YETI", "cooler", 3, "A small hard cooler that rides behind the seat."],
  ["B0F2JHSGCJ", 237.5, "31f9tFHPW4L", "Turtlebox Ranger Speaker", "Turtlebox", "speaker", 3, "A loud, waterproof speaker built for the outdoors."],
].map((r) => (Array.isArray(r) ? row(r) : r)).concat(HIM_SHOPMY_1121);

/**
 * Her kids' ShopMy saves (Desktop note Kids-saved-shopmy-1121.md, 54 pins), 16 kept by her rules: at most 2 of a brand
 * (Melissa & Doug made ~22 of them, at Macy's, Wayfair and Over The Moon), 2 of an item type, nothing out of stock.
 * Prices read on each store's own page 11-21 (Maisonette, Grove, Wayfair).
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
  ["108632077", 117.99, "https://assets.wfcdn.com/im/45146626/compr-r85/4085/408563114/Wood+Furnished+Mansion.jpg", "Melissa & Doug Wood Furnished Mansion", "Melissa & Doug", "store-wayfair", "dollhouse", null, "A big wooden dollhouse with the furniture inside."],
  ["108632046", 55.99, "https://assets.wfcdn.com/im/84968246/compr-r85/1747/174755531/Preschool+Pretend+Grocery+Shopping+Accessories+with+Kitchen+Accessories.jpg", "Melissa & Doug Toy Shopping Cart", "Melissa & Doug", "store-wayfair", "pretend-play", null, "A sturdy metal shopping cart for pretend errands."],
].map(shop);

export const KIDS_1121 = [
  ["152350675X", 3.44, "51J30U2ygrL", "Paint by Sticker Kids: Christmas", "Workman", "book", 3, "Sticker-by-number Christmas pictures, no mess."],
  ["B0CFFZ389Y", 5.42, "41ulOjt6aQL", "Colgate Minecraft Kids Toothbrush", "Colgate", "toothbrush", 3, "A Minecraft toothbrush for the stocking."],
  ["B0FVX689L4", 7.99, "517ur30uekL", "Christmas Joke Book for Kids", "", "book", 3, "Silly Christmas jokes to read out loud."],
  ["B0G36VXNGX", 8.99, "51JNHGNSDML", "Slimygloop Squishmallows Slime", "Slimygloop", "slime", 3, "Squishmallows slime in a jar, ready to squish."],
  ["B0H9ZZGK8W", 9.98, "41YnNH+Nc1L", "Crunchy Butter Squishy Toy", "", "squishy", 3, "A slow-rise butter squishy kids love to squeeze."],
  ["B0G2KJ8V5R", 10.29, "41orTVxng-L", "LEGO Snowman Ornaments", "LEGO", "ornament", 3, "Little LEGO snowmen to build and hang on the tree."],
  ["B0DTJWSVWG", 11.89, "41-YrWLVSgL", "Handmade Hamster Squishy Toy", "", "squishy", 3, "A soft little hamster to squish."],
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
  ["B0084JUNVU", 26.99, "51n6kaGkRTL", "Crayola Light Up Tracing Pad", "Crayola", "art", 3, "A light-up pad that makes tracing easy."],
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
  ["B07V4GCFP9", 229, "31CHVspmUeL", "Nintendo Switch Lite", "Nintendo", "game-console", 3, "The handheld Switch for games on the go."],
].map(row).concat(KIDS_SHOPMY_1121);

const isAmazon = (p) => p.store === "store-amazon" || /^https:\/\/(www\.)?amazon\.com\//.test(p.href);

const build = (rows, slug, g) =>
  rankByPrice(rows).map(({ row: r, priceRank }) => {
    const { sortPrice: _sp, price, ...rest } = r;
    const p = { ...rest, image: isAmazon(r) ? r.image : cutoutPhoto(r.image), ownerPick: true, from: slug, priceRank };
    if (!isAmazon(r)) Object.assign(p, { price, priceAt: HIM_KIDS_PRICE_AT });
    return { ...p, rels: g ? relsOf(g, p) : [] };
  });

/** For Him, cheapest first, each pick tagged with the men's relationships it suits. */
export function him1121Picks(rows = HIM_1121) {
  return build(rows, HIM_GUIDE, PEOPLE_GUIDES.find((x) => x.slug === HIM_GUIDE));
}
/** For Kids, cheapest first. Kids has no relationship pages, so no tags. */
export function kids1121Picks(rows = KIDS_1121) {
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
      storeList[p.store] ??= { name: HIM_KIDS_STORES[p.store] ?? p.store, hosts: [] };
      if (!storeList[p.store].hosts.includes(host)) storeList[p.store].hosts = [...storeList[p.store].hosts, host].sort();
    }
  }
  return out;
}
