/**
 * FOR HIM and FOR KIDS = THE OWNER'S SAVES (owner 2026-11-21 ~2:15 AM: "i also added the mens stuff to the amazon men
 * list"; ~2:45 AM: "i did kids too in amazon list"; ~2:47 AM: "add all oft he things to the guides. fix them how you
 * see fit. launch the 3 guides"). Both pages hold ONLY picks from her own Amazon lists (Desktop notes
 * Him-saved-amazon-1121.md and Kids-saved-amazon-1121.md), tidied by her standing rules: at most 2 of one brand and 2 of
 * one item type per page, men in classic colors, no Louisiana brands, cheaper first. Her ShopMy saves for Him and Kids
 * follow once their prices and cutout photos are checked.
 *
 * scripts/gift-guide-picks.mjs runs applyHimKids1121 LAST, next to applyHer1121, so no earlier pass can drop or reorder
 * these. Page rules are the same as For Her (scripts/giftGuideHer1121.mjs): ONE flat list, cheapest first, no sections,
 * no relationship chips, no codes or deals box (OWNER_LIST_GUIDES in src/content/giftGuidePeople.mjs). Every pick here
 * is an Amazon one, so none carries a price (Associates rule) and every photo is Amazon's own, never edited;
 * `sortPrice` is the price she saw, used only to order the list. Him picks keep their relationship tags (`rels`), so
 * /dad, /husband ... still build from this list.
 * Guard: src/test/giftGuideHimKids1121.test.ts.
 */
import { PEOPLE_GUIDES } from "../src/content/giftGuidePeople.mjs";
import { relsOf } from "./giftGuidePeople1120.mjs";
import { rankByPrice } from "./giftGuidePriceRank1121.mjs";

export const HIM_GUIDE = "him";
export const KIDS_GUIDE = "kids";
const amz = (asin) => `https://www.amazon.com/dp/${asin}?tag=louisianahelpr-20`;
const amzImg = (id) => `https://m.media-amazon.com/images/I/${id}._SL500_.jpg`;
/** One row per pick: [ASIN, price she saw, Amazon image id, name, brand, type, commission %, line]. */
const row = ([asin, sortPrice, img, name, brand, type, commission, line]) => ({ name, brand, line, href: amz(asin), image: amzImg(img), store: "store-amazon", sortPrice, commission, type });

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
  ["B001DPHF4U", 99.95, "41sGIwYOwML", "LaCrosse Grange Rubber Boot", "LaCrosse", "boots", 4, "Tall rubber boots made for mud and marsh."],
  ["B0FKCJNHWB", 189.99, "316iNnvixrL", "Theragun Prime Massage Gun", "Therabody", "massager", 1, "A massage gun for sore backs and shoulders."],
  ["B0FDYD1C2N", 200, "41tgypUHtjL", "YETI Roadie 15 Hard Cooler", "YETI", "cooler", 3, "A small hard cooler that rides behind the seat."],
  ["B0F2JHSGCJ", 237.5, "31f9tFHPW4L", "Turtlebox Ranger Speaker", "Turtlebox", "speaker", 3, "A loud, waterproof speaker built for the outdoors."],
].map(row);

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
].map(row);

const build = (rows, slug, g) =>
  rankByPrice(rows).map(({ row: r, priceRank }) => {
    const { sortPrice: _sp, ...rest } = r;
    const p = { ...rest, ownerPick: true, from: slug, priceRank };
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

/** Replace the Him and Kids pages with the owner's lists. Returns the counts for the build log. */
export function applyHimKids1121(pageList) {
  const out = {};
  for (const [slug, picks] of [[HIM_GUIDE, him1121Picks()], [KIDS_GUIDE, kids1121Picks()]]) {
    out[slug] = { before: (pageList[slug] ?? []).length, after: picks.length };
    pageList[slug] = picks;
  }
  return out;
}
