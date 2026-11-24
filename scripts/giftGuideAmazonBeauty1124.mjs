/**
 * HER AMAZON BEAUTY (owner 2026-11-24 ~11:20 AM CT: "Add Amazon beauty to Her: A1 … A48", all 48 items of her Desktop
 * review page "Louisiana Helpr Tracker/reviews/amazon-beauty-33-1124.html"). Each is a product in an Amazon Creator
 * Connections campaign she had already accepted (Associates > Creator Connections > Affiliate+ > Active, read 11-24
 * ~3:30-4:20 AM, ~/.lh-shots/amazon-cc-beauty-1124-handoff.md): Lancôme and Kiehl's 30% to Dec 16; Estée Lauder,
 * Clinique, Bobbi Brown and Too Faced 30% to Dec 31; Summer Fridays 15% (no end date shown). She picked every one, so they
 * go in as owner picks even where a brand or type passes the ~2-per-guide line (counted 2026-11-24 on this file: Lancôme
 * 15, Kiehl's 10, Estée Lauder 8, Clinique 7, Summer Fridays 3, Too Faced 3, Bobbi Brown 2; by type fragrance 20,
 * skincare 7, lotion 5, makeup 5, gift-set 4, lip-balm 4, lip 2, hand-care 1) for her to trim.
 *
 * Website only: Amazon links never go on Facebook, so these rows feed the For Her page and nothing else (no deals feed).
 *
 * Price and photo: every row's amazon.com product page (www.amazon.com/dp/<ASIN>) was read 2026-11-24 ~11:30 AM CT (curl,
 * browser user agent); all 48 said "In Stock" and showed the same price the review page lists. The photo is the listing's
 * own lead photo (Amazon's photo is the only one allowed on an Amazon link, and it is never edited: Associates
 * agreement). All 48 sit on pure white (every border pixel measured >= 245 on 47; A13 98% of border pixels), so the
 * guide's white photo box with multiply blending shows no box around them.
 * A1: the review page's "$45" size was unconfirmed; the dp page shows the $45 option as "0.13 Fl Oz (Pack of 4)", a
 * set of four mini sprays, so it is named that way.
 *
 * Rows: [ASIN, price, Amazon image id, name, brand, type, commission %, campaign last day | "", line]. Names carry no
 * model year. Pulled into scripts/giftGuideHer1121.mjs (HER_ROWS). Guard: src/test/giftGuideAmazonBeauty1124.test.ts.
 */

/** The Louisiana day these prices were read on amazon.com. */
export const AMAZON_BEAUTY_1124_PRICE_AT = "2026-11-24";

const L = "2026-12-16"; // Lancôme and Kiehl's campaigns end Dec 16
const E = "2026-12-31"; // Estée Lauder, Clinique, Bobbi Brown and Too Faced campaigns end Dec 31

/** A1 ... A48, in the review page's order. */
export const HER_AMAZON_BEAUTY_1124_ROWS = [
  /* A1 */ ["B0HFQ324TF", 45, "31FM+ed7ZvL", "Lancôme La Vie Est Belle Eau de Parfum Mini Set, 4 x 0.13 oz", "Lancôme", "fragrance", 30, L, "Four purse-size sprays of Lancôme's La Vie Est Belle."],
  /* A2 */ ["B0GQ14CTW7", 99, "41cJ08ScMTL", "Lancôme La Vie Est Belle Rose Perfume and Eyeshadow Palette Gift Set", "Lancôme", "gift-set", 30, L, "A rosy perfume plus an eyeshadow palette, boxed for gifting."],
  /* A3 */ ["B0CS4LRHHS", 95.9, "316Ul+4fPLL", "Lancôme La Vie Est Belle Rose Extraordinaire Eau de Parfum, 1.7 oz", "Lancôme", "fragrance", 30, L, "A fresh rose take on La Vie Est Belle, an Amazon exclusive."],
  /* A4 */ ["B092W4P1N9", 23.8, "11u5wYYQhWL", "Lancôme Idôle Eau de Parfum, 0.35 oz", "Lancôme", "fragrance", 30, L, "A clean floral perfume in a slim travel spray."],
  /* A5 */ ["B00IMU2IPA", 51, "21sFlbgCeLL", "Estée Lauder White Linen Eau de Parfum, 2 oz", "Estée Lauder", "fragrance", 30, E, "A crisp, classic floral she will wear for years."],
  /* A6 */ ["B005IQ866G", 63, "212IHtafP9L", "Estée Lauder Pleasures Eau de Parfum", "Estée Lauder", "fragrance", 30, E, "Soft lilies and peonies, a timeless everyday scent."],
  /* A7 */ ["B0D6L6TWJC", 19.2, "21aAVCWrw1L", "Estée Lauder Beautiful Magnolia Eau de Parfum, 0.34 oz", "Estée Lauder", "fragrance", 30, E, "A creamy magnolia perfume in a little travel spray."],
  /* A8 */ ["B00PWVIQKI", 23.8, "21It5Q+ti4L", "Clinique Happy Eau de Parfum, 0.34 oz", "Clinique", "fragrance", 30, E, "Bright citrus and flowers that smell like a good mood."],
  /* A9 */ ["B004EHOTJS", 34.3, "41bju+Lf+IL", "Kiehl's Creme de Corps Whipped Body Butter, 8 oz", "Kiehl's", "lotion", 30, L, "A whipped body butter for dry winter skin."],
  /* A10 */ ["B06X9DFBNK", 43.4, "314TJlnyLHL", "Lancôme La Vie Est Belle Scented Body Lotion, 6.7 oz", "Lancôme", "lotion", 30, L, "A silky body lotion in the La Vie Est Belle scent."],
  /* A11 */ ["B0HB6Z65TX", 40, "41JXca1aOnL", "Summer Fridays Jet Lag Duo Gift Set", "Summer Fridays", "gift-set", 15, "", "A mini Jet Lag face mask plus under-eye patches."],
  /* A12 */ ["B0D19JDZJS", 30, "41G+kIWFR8L", "Too Faced Born This Way Natural Nudes Mini Eyeshadow Palette", "Too Faced", "makeup", 30, E, "Easy everyday nude shades in a small palette."],
  /* A13 */ ["B07KWM3JXN", 46.9, "31W74tR0oxL", "Clinique Happy Heart Eau de Parfum, 1 oz", "Clinique", "fragrance", 30, E, "A soft, fresh floral with a hint of mandarin."],
  /* A14 */ ["B00E1HJLEY", 97.3, "31Z9Cv1w7aL", "Kiehl's Midnight Recovery Concentrate, 3.4 oz", "Kiehl's", "skincare", 30, L, "A cult overnight face oil for glowing mornings."],
  /* A15 */ ["B0DNLC5T7S", 9.6, "31qOZMWre+L", "Lancôme Lash Idôle Flutter Extension Mascara", "Lancôme", "makeup", 30, L, "A lengthening mascara that fits in her stocking."],
  /* A16 */ ["B0081KINZK", 65.1, "31uIrjbGXiL", "Bobbi Brown Beach Eau de Parfum, 1.7 oz", "Bobbi Brown", "fragrance", 30, E, "Sea spray, jasmine and mandarin, summer in a bottle."],
  /* A17 */ ["B0009OAIBI", 51, "21h+I-5iXwL", "Estée Lauder Beautiful Eau de Parfum, 1 oz", "Estée Lauder", "fragrance", 30, E, "A romantic bouquet of rose, lily and orange flower."],
  /* A18 */ ["B0012RSTIA", 31.5, "310XE5vDX+L", "Estée Lauder Youth-Dew Eau de Parfum", "Estée Lauder", "fragrance", 30, E, "A warm, spicy classic for the woman who loves one."],
  /* A19 */ ["B0HB6KB3BW", 56.1, "41DmSdsNogL", "Summer Fridays Vanilla Lip Trio Gift Set", "Summer Fridays", "gift-set", 15, "", "Three vanilla lip products from the cult lip balm brand."],
  /* A20 */ ["B096CFPBLY", 25.9, "31CuadbZawL", "Clinique My Happy Fragrance Spray, 0.5 oz", "Clinique", "fragrance", 30, E, "A mini Happy spray in one of eight fun scents."],
  /* A21 */ ["B0DBVZX9YH", 25.2, "21EZ9fgk98L", "Lancôme La Vie Est Belle L'Elixir Eau de Parfum", "Lancôme", "fragrance", 30, L, "A richer, sweeter take on La Vie Est Belle."],
  /* A22 */ ["B0GQJRMLG4", 25.2, "21ZWeJBrsJL", "Lancôme La Vie Est Belle Very Cherry Eau de Parfum, 0.34 oz", "Lancôme", "fragrance", 30, L, "A juicy cherry twist on La Vie Est Belle."],
  /* A23 */ ["B0F22N1MNV", 25.2, "21JxOGT14uL", "Lancôme La Vie Est Belle La Vie Vanille Nude Eau de Parfum, 0.34 oz", "Lancôme", "fragrance", 30, L, "A soft vanilla version for cozy winter days."],
  /* A24 */ ["B000P20PU8", 35.7, "31K6UBnkNyL", "Clinique Happy Body Cream, 6.7 oz", "Clinique", "lotion", 30, E, "A rich body cream in the cheerful Happy scent."],
  /* A25 */ ["B0G319B1CR", 23.8, "21CIMgfcEYL", "Lancôme Idôle Peach 'N Roses Eau de Parfum, 0.34 oz", "Lancôme", "fragrance", 30, L, "Peach and rose in a slim travel spray."],
  /* A26 */ ["B0DFDSRCHY", 23.8, "21T9RJP--oL", "Clinique Happy Body Spritz, 4.2 oz", "Clinique", "fragrance", 30, E, "A light all-over spritz of Clinique Happy."],
  /* A27 */ ["B0H9ZVR21B", 34.3, "31GPUioNWSL", "Kiehl's Richly Whipped Body Butter", "Kiehl's", "lotion", 30, L, "A thick, whipped body butter for cold-weather skin."],
  /* A28 */ ["B0BJBT1WQJ", 43.4, "31TgugKU75L", "Kiehl's Midnight Recovery Cloud Cream, 1.7 oz", "Kiehl's", "skincare", 30, L, "A fluffy night cream for plump morning skin."],
  /* A29 */ ["B077Y7CTR8", 31.5, "311t1bNnSyL", "Kiehl's Creme de Corps Dry Body Oil, 5.9 oz", "Kiehl's", "lotion", 30, L, "A quick-soaking body oil that leaves skin glowy."],
  /* A30 */ ["B002LK0GAQ", 42, "314krkepnBL", "Kiehl's Ultra Facial Moisturizer, 4.2 oz", "Kiehl's", "skincare", 30, L, "A light all-day face lotion for every skin type."],
  /* A31 */ ["B0GQJPHLK7", 20.3, "216lLOELvYL", "Lancôme Les Ô Juicy Hair and Body Mist, 3 oz", "Lancôme", "fragrance", 30, L, "A light, fruity mist for hair and skin."],
  /* A32 */ ["B0GZ8BDMHS", 19.6, "21IxoJBTXrL", "Estée Lauder Glimmer Eau de Parfum, 0.34 oz", "Estée Lauder", "fragrance", 30, E, "Estée Lauder's new rose and amber scent, travel size."],
  /* A33 */ ["B0FTHLKL42", 19.2, "21svnApaCrL", "Estée Lauder Bronze Goddess Eau de Parfum, 0.34 oz", "Estée Lauder", "fragrance", 30, E, "Coconut and warm amber in a travel spray."],
  /* A34 */ ["B0DY1WSW83", 34, "31rHKkasHYL", "Summer Fridays Jet Lag Essentials Mini Set", "Summer Fridays", "gift-set", 15, "", "A travel-size Summer Fridays skincare kit."],
  /* A35 */ ["B0DM3S16NM", 32.5, "310R8OkkT7L", "Lancôme Génifique Ultimate Recovery Serum", "Lancôme", "skincare", 30, L, "A hydrating serum for smooth, bouncy skin."],
  /* A36 */ ["B000S97MAY", 28, "21-Zcs5By2L", "Kiehl's Avocado Eye Treatment, 0.5 oz", "Kiehl's", "skincare", 30, L, "A rich avocado eye cream for tired eyes."],
  /* A37 */ ["B00EKT4MCY", 15.4, "31gw8QYh3fL", "Kiehl's Ultimate Strength Hand Salve, 2.5 oz", "Kiehl's", "hand-care", 30, L, "A rescue cream for hardworking, dry hands."],
  /* A38 */ ["B08P541DPH", 14, "21J1t9dyksL", "Estée Lauder Advanced Night Repair Serum", "Estée Lauder", "skincare", 30, E, "The famous little brown bottle night serum."],
  /* A39 */ ["B016Z69QF2", 18.2, "21Lb6+UcqiL", "Kiehl's Ultra Facial Cream, 0.95 oz", "Kiehl's", "skincare", 30, L, "Kiehl's cult daily moisturizer in a small jar."],
  /* A40 */ ["B007GOQYR6", 25.2, "31n6RXZaVXL", "Bobbi Brown Pot Rouge for Lips and Cheeks", "Bobbi Brown", "makeup", 30, E, "A creamy blush that doubles as a lip tint."],
  /* A41 */ ["B0CTL1F8LW", 22.4, "31YcYC3hYQL", "Lancôme Lip Idôle Butterglow Lip Balm", "Lancôme", "lip-balm", 30, L, "A glossy tinted balm that keeps lips soft."],
  /* A42 */ ["B00DNGVPZW", 11.2, "31XN9nVUZOL", "Too Faced Better Than Sex Volumizing Mascara", "Too Faced", "makeup", 30, E, "A big-volume mascara, perfect for her stocking."],
  /* A43 */ ["B083PXLPHC", 19.6, "31DB7-U5PvL", "Too Faced Pillow Balm Lip Treatment", "Too Faced", "lip-balm", 30, E, "A cushiony liquid lip balm for shiny, soft lips."],
  /* A44 */ ["B074G4J1KK", 9.6, "31v-eSPI-GL", "Lancôme Monsieur Big Mascara", "Lancôme", "makeup", 30, L, "A big-volume mascara at a stocking stuffer price."],
  /* A45 */ ["B08LHFXTX7", 17.5, "21bykGr6KJL", "Lancôme Juicy Tubes Lip Gloss", "Lancôme", "lip", 30, L, "The classic shiny Juicy Tubes gloss, back for a new generation."],
  /* A46 */ ["B07Q6J2C9C", 16.8, "21pg+JIUp7L", "Clinique Moisture Surge Lip Hydro-Plump Treatment", "Clinique", "lip-balm", 30, E, "A plumping lip treatment that works overnight too."],
  /* A47 */ ["B07V5X4KDZ", 16.8, "31dnhY3VNjL", "Kiehl's Buttermask for Lips", "Kiehl's", "lip-balm", 30, L, "An overnight lip mask for soft lips by morning."],
  /* A48 */ ["B0FZXN4HN9", 16.06, "310edKn9MCL", "Clinique Chubby Stick Tinted Lip Balm", "Clinique", "lip", 30, E, "A tinted balm crayon for easy everyday color."],
];

const amz = (asin) => `https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20`;
const amzImg = (id) => `https://m.media-amazon.com/images/I/${id}._SL500_.jpg`;

/** The rows as Her builder rows (Amazon: the price shows from sortPrice). */
export const HER_AMAZON_BEAUTY_1124 = HER_AMAZON_BEAUTY_1124_ROWS.map(([asin, sortPrice, img, name, brand, type, commission, campaignEnds, line]) => ({
  name, brand, line, href: amz(asin), image: amzImg(img), store: "store-amazon", sortPrice, priceAt: AMAZON_BEAUTY_1124_PRICE_AT, commission, type,
  ...(campaignEnds ? { campaignEnds } : {}),
}));
