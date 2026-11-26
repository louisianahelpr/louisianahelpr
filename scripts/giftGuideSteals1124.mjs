/**
 * THE OWNER'S STEALS ON THE GUIDES (owner 11-24 ~1:45 AM, Desktop "Louisiana Helpr Tracker/reviews/steals-pick-1124.html";
 * list ~/.lh-shots/steals-to-guides-1124.md, S-numbers = ~/.lh-shots/bf-store-sales-1124.md "STEALS"), plus her Walmart
 * advent calendars (~2:30-2:35 AM, her own Walmart Creator links). Each row is the exact product page, read 11-24 (price,
 * stock, photo, maker's age), and the best-paying link for it by the owner's all-factors store rule: Target toys through
 * ShopMy at 4% (Later's Target rate is by category: Toys 2.8%), Macy's through ShopMy 16%, her own Walmart links as she
 * sent them. Rows: [link, price, store photo, name, brand, store, type, commission %, line]. Names carry no model year.
 * Pulled into scripts/giftGuideOwner1124.mjs (HER_ADDS_1124 / HIM_ADDS_1124 / KIDS_ADDS_1124). Guard: src/test/giftGuideOwner1124.test.ts.
 */

/** For Kids. */
export const KIDS_STEALS_1124_ROWS = [
  // S21 Target (reg. $40, through Nov 28; Frost and Rose Quartz in stock, the photo is Target's lead color). Store check 11-24 ~3:10 AM: stanley1913.com sells the same
  // 30 oz H2.0 FlowState at $45 (its only $24 one is a July-4th fireworks print), so Target's $20 at ShopMy 4% wins.
  ["https://go.shopmy.us/p-110125767", 20, "https://target.scene7.com/is/image/Target/GUEST_3fa007f1-e01f-45f0-b417-2596ef872a93", "Stanley Quencher H2.0 FlowState Tumbler, 30 oz", "Stanley", "store-target", "tumbler", 4, "A Stanley tumbler that keeps drinks cold all day."],
  // S19 Target (reg. $14.99, sale through Nov 28); LEGO's own site lists it at $14.99.
  ["https://go.shopmy.us/p-110125685", 8.99, "https://target.scene7.com/is/image/Target/GUEST_4d87f108-5489-4494-8fa1-e217b2f5b2ec", "LEGO Sunflowers", "LEGO", "store-target", "building-set", 4, "LEGO sunflowers that never need watering."],
  // S20 Target (reg. $29.99, through Nov 28).
  ["https://go.shopmy.us/p-110125702", 14.99, "https://target.scene7.com/is/image/Target/GUEST_17112714-0b0d-42cf-8155-764b003d717c", "Monster Jam Smash and Bash Toy Vehicle Playset", "Monster Jam", "store-target", "vehicle-toy", 4, "A Monster Jam smash-up playset for the floor."],
  // S22 Target (through Nov 28; styles vary).
  ["https://go.shopmy.us/p-110125781", 10, "https://target.scene7.com/is/image/Target/GUEST_3c239da7-60a0-4778-9907-30c1d39c75e1", "Hot Wheels Monster Trucks Mutant Chaos Truck, Car and Slime", "Hot Wheels", "store-target", "car-toy", 4, "A Mutant Chaos truck and car with slime."],
  // S23 Target (reg. $32.49, through Nov 28).
  ["https://go.shopmy.us/p-110125801", 19.49, "https://target.scene7.com/is/image/Target/GUEST_c83ac03c-e583-4186-9d54-8f45accdb680", "Hot Wheels Monster Trucks Mutant Chaos Loop Challenge Playset", "Hot Wheels", "store-target", "car-toy", 4, "A Mutant Chaos loop track for big stunts."],
  // S25 Target (reg. $29.99, through Nov 28); the link opens on Black (also Moonbeam, Pink, Red).
  ["https://go.shopmy.us/p-110125818", 19.99, "https://target.scene7.com/is/image/Target/GUEST_df42bc4c-6b91-47d1-8f17-b5927a32d819", "Frigidaire 6-Can Mini Fridge, Black", "Frigidaire", "store-target", "mini-fridge", 4, "A mini fridge for skincare or snacks."],
  // S26 Target (reg. $49.99, through Nov 28).
  ["https://go.shopmy.us/p-110125837", 24.99, "https://target.scene7.com/is/image/Target/GUEST_9bb0bfa5-6795-4fee-b757-b4e42550d250", "LEGO Minecraft Woodland Mansion Fighting Ring", "LEGO", "store-target", "building-set", 4, "The LEGO Minecraft Woodland Mansion to build."],
  // S27 Target (reg. $49.99, through Nov 28), the only store with this sale.
  ["https://go.shopmy.us/p-110125353", 24.99, "https://target.scene7.com/is/image/Target/GUEST_31e99209-6fc7-4143-814e-b3c379a26196", "Monster Jam Grave Digger Remote Control Truck", "Monster Jam", "store-target", "vehicle-toy", 4, "A remote-control Grave Digger monster truck."],
  // Her Walmart advent calendars (her own links; the two dumpling calendars are sold by marketplace sellers, the UUGEE one
  // by UUGEE, the Monster Jam pack by Walmart). Walmart Creator's Black Friday toys rate is 6% (bf-store-sales-1124.md);
  // her links' own rate is not shown.
  ["https://walmrt.us/4CpL44Q", 13.97, "https://i5.walmartimages.com/seo/Christmas-Dumpling-Advent-Calendar-2026-24-Day-Countdown-for-Kids-Adults-Christmas-Gifts_314174ac-f2be-4671-9298-cb45b155a858.71d0d4271709de6df7d649374e98a4c3.jpeg", "Christmas Dumpling Advent Calendar", "", "store-walmart", "advent-calendar", 6, "A 24-day countdown of squishy holiday dumpling toys."],
  ["https://walmrt.us/4fSzHIL", 12.61, "https://i5.walmartimages.com/seo/Cute-Farm-Animal-Dumpling-Advent-Calendar-24-Days-Christmas-Countdown-Ornament-Gift-for-Kids-Teens-Holiday-Tree-Decor_26079486-b2a9-431b-927a-7b2e8d268d0d.7c2740f8708f1d701d8f7d5534c608be.jpeg", "Cute Farm Animal Dumpling Advent Calendar", "", "store-walmart", "advent-calendar", 6, "Farm animal dumpling squishies, one for each day of December."],
  ["https://walmrt.us/4jcx3OU", 16.89, "https://i5.walmartimages.com/seo/UUGEE-2024-Christmas-Advent-Calendar-Boys-Kids-24-Days-Countdown-Calendar-Pull-Back-Cars-Toys-Set-24-Vehicles-Xmas-Surprise-Gifts-1-2-3-Years-Old-Tod_492e28fe-d787-4a63-9a78-0f73457b08bf.2903e563bf3a841cad4744e24bc94846.jpeg", "UUGEE Advent Calendar, 24 Pull-Back Cars", "UUGEE", "store-walmart", "advent-calendar", 6, "24 pull-back cars to open, one each day before Christmas."],
  ["https://walmrt.us/3V7qKEv", 15, "https://i5.walmartimages.com/seo/Monster-Jam-1-64-Truck-Collection-4-Pack-with-3-Bonus-Mini-Jams-Vehicles-for-Kids-3-and-up_5e70e26e-62fc-4d27-ac48-d6c0bbeb0a2e.8f9818984e305aa62898183ec2d08edb.jpeg", "Monster Jam 1:64 Truck 4-Pack with 3 Mini Jams", "Monster Jam", "store-walmart", "vehicle-toy", 6, "Four Monster Jam trucks plus three mini trucks to race."],
  // Owner 11-24 ~9:45 PM (via the lead, "add this"; picks round 2): her Walmart link, resolved by one header-only request;
  // walmart.com/ip/19251169318 read 9:44 PM: hardcover, sold by Walmart.com, IN_STOCK, $21.56, no was-price, age group Child
  // (no minimum age listed). Her link's own rate is not shown and books are not on the Black Friday elevated list: 6% is the
  // rate her other Walmart Kids links carry here, unconfirmed for books.
  ["https://walmrt.us/4zIzr6p", 21.56, "https://i5.walmartimages.com/seo/Elf-on-the-Shelf-The-Elf-on-the-Shelf-Advent-Calendar-Story-Activity-Collection-Series-10-Hardcover-9780063327351_c56acf0d-01e7-4f68-a407-a8651906af07.f5971afc5371def279f4c5461e01a47c.jpeg", "The Elf on the Shelf Advent Calendar Story and Activity Collection", "The Elf on the Shelf", "store-walmart", "book", 6, "A 24-day advent book of Elf on the Shelf stories and activities."],
  // Walmart Creator links made 11-24 ~3:05 AM (creator.walmart.com; Black Friday elevated rate for apparel and shoes 15%,
  // where Later's Walmart rate for apparel is its 0% baseline); listing re-read ~3:10 AM, sold by Walmart, in stock.
  // S28: the kid-size KPop Demon Hunters slipper (reg. $16.98; the $5 Huntrx pair is adult/teen sizes only).
  ["https://walmrt.us/4AQxuWv", 8, "https://i5.walmartimages.com/seo/KPop-Demon-Hunters-Girls-Slipper_4a177782-fa79-4508-9ca0-3a1196057428.81560971bb841793f8ca6e21114a80ff.jpeg", "KPop Demon Hunters Girls Slippers", "KPop Demon Hunters", "store-walmart", "slippers", 15, "Fuzzy KPop Demon Hunters slippers for cozy mornings."],
  // S29 (reg. $12.98), toddler sizes.
  ["https://walmrt.us/4CcMa3A", 5, "https://i5.walmartimages.com/seo/MONSTER-JAM-GRAVE-DI_def5b20b-fbde-4411-b535-8bf50039e548.c2076dadbc2472328eabc7b3f1a55779.jpeg", "Monster Jam Grave Digger Toddler Slippers", "Monster Jam", "store-walmart", "slippers", 15, "Grave Digger slippers for little feet."],
  // S30 (reg. $12.98), sizes 12M-5T; the listing's character is Bluey.
  ["https://walmrt.us/3VHA424", 5.84, "https://i5.walmartimages.com/seo/Character-Toddler-Long-Sleeve-Top-and-Pant-Pajama-Set-2-Piece-Sizes-12M-5T_85a8419b-f3f7-4696-a1fb-5ac768017ac8.20bc5657ccf727ebdbdb6c2dde622e53.jpeg", "Bluey Toddler Pajama Set", "Bluey", "store-walmart", "pajamas", 15, "A cozy Bluey pajama set for toddlers."],
  // OWNER SCREENSHOT PICKS, round 3 (owner 11-24 ~11:08-11:15 PM walmart.com screenshots via the lead; her 11:30 PM rule "if i send it
  // add it unless its a duplicate"; non-theme items go on Kids). The multi-print Walmart listings she sent ("Character" toddler/kids pajama
  // sets, coat-top sets, one-piece sleepers, fleece robe, patriotic tee, beanie + gloves): each print with no theme guide is its own row
  // here, one walmrt.us link per print variant (Walmart Creator API, 11-25 ~12:20 AM); the Bluey, Marvel, Cars, Pokemon, Minecraft and
  // Monster Jam prints are on their theme guides. Walmart Creator Black Friday apparel rate 15%, toys 6%.
  // Owner pick (via the lead, 11-24 night): Target A-1010386996 read 11-25 ~12:15 AM (redsky): $59.99, reg $59.99. Her ShopMy link (made by the
  // lead; never opened). ShopMy Target toys 4%.
  ["https://go.shopmy.us/p-110699595", 59.99, "https://target.scene7.com/is/image/Target/GUEST_aa607c4c-29d7-4ce2-af5b-587ebde268f0", "PAW Patrol My Size Lookout Tower Vehicle Playset", "PAW Patrol", "store-target", "playset", 4, "A kid-size PAW Patrol Lookout Tower with a working elevator."],
  // #8 print SpongeBob SquarePants Blue: walmart.com/ip/20389152512 read 11-25 ~12:25 AM, $5.4, was $10.98, sold by Walmart.com.
  ["https://walmrt.us/4eUyq3F", 5.4, "https://i5.walmartimages.com/asr/2ebd2ffc-3fe0-41ea-a2a7-89c10d55fa40.ad137f7373e995ff3ebad5439edbb758.jpeg", "SpongeBob Toddler Pajama Set (12M-5T)", "Nickelodeon", "store-walmart", "pajamas", 15, "SpongeBob pajamas at a Black Friday price."],
  // #8 print Disney Princess Pink: walmart.com/ip/20369808997 read 11-25 ~12:25 AM, $5.4, was $10.98, sold by Walmart.com.
  ["https://walmrt.us/4lc3orK", 5.4, "https://i5.walmartimages.com/asr/ffaee3a0-afdb-48b2-8b58-927bdd968029.49055b2639cae3288f4a732efc800e92.jpeg", "Disney Princess Toddler Pajama Set, Pink (12M-5T)", "Disney", "store-walmart", "pajamas", 15, "Disney Princess pajamas at a Black Friday price."],
  // #8 print How The Grinch Stole Christmas Red: walmart.com/ip/20398568986 read 11-25 ~12:25 AM, $5.4, was $10.98, sold by Walmart.com.
  ["https://walmrt.us/4zETfHG", 5.4, "https://i5.walmartimages.com/asr/3deb60dd-e31f-450a-be92-f0792f7bad41.c5785be7e2e2c296d6f278f59fb8ea2a.jpeg", "Grinch Toddler Pajama Set, Red (12M-5T)", "Dr. Seuss", "store-walmart", "pajamas", 15, "Grinch pajamas at a Black Friday price."],
  // #17 print Toy Story Blue: walmart.com/ip/20386967657 read 11-25 ~12:25 AM, $7.19, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4eVQ07i", 7.19, "https://i5.walmartimages.com/asr/4ee60411-45a7-4672-8fd3-34eb543cefe6.18d5db898fa8312d61f343d68ca1b677.jpeg", "Toy Story Toddler Coat-Top Pajama Set (12M-5T)", "Disney Pixar", "store-walmart", "pajamas", 15, "Toy Story pajamas at a Black Friday price."],
  // #17 print Paw Patrol Blue: walmart.com/ip/20405856543 read 11-25 ~12:25 AM, $7.19, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4AXpPpv", 7.19, "https://i5.walmartimages.com/asr/3df14a41-6925-4f54-984d-07e1c6c1e9df.ead35d5940ee90daab4d22be0adfce76.jpeg", "PAW Patrol Toddler Coat-Top Pajama Set (12M-5T)", "PAW Patrol", "store-walmart", "pajamas", 15, "PAW Patrol pajamas at a Black Friday price."],
  // #17 print Barbie: walmart.com/ip/5430873089 read 11-25 ~12:25 AM, $15.99, sold by Walmart.com.
  ["https://walmrt.us/4eWzgNd", 15.99, "https://i5.walmartimages.com/asr/fafd9f5f-77d4-4fab-9c7f-c9f67132c40c.9d13039c6fb94a9cfd84a453569ea44e.jpeg", "Barbie Toddler Coat-Top Pajama Set (2T-5T)", "Barbie", "store-walmart", "pajamas", 15, "Barbie pajamas at a Black Friday price."],
  // #17 print Hello Kitty: walmart.com/ip/20197123334 read 11-25 ~12:25 AM, $7.19, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4iW9on6", 7.19, "https://i5.walmartimages.com/asr/5e1bfb70-f352-47e1-9b2b-6f915d85fb89.e0c093ce2ebeb9831ed5adbf810fd03f.jpeg", "Hello Kitty Toddler Coat-Top Pajama Set (12M-5T)", "Hello Kitty", "store-walmart", "pajamas", 15, "Hello Kitty pajamas at a Black Friday price."],
  // #17 print Strawberry Shortcake Blue: walmart.com/ip/20386967653 read 11-25 ~12:25 AM, $7.19, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/48Ej3ZE", 7.19, "https://i5.walmartimages.com/asr/b17dc25a-2a4c-46af-9edc-dc722f18288e.b6fb2b224dcfeb438d711c68f3567732.jpeg", "Strawberry Shortcake Toddler Coat-Top Pajama Set (12M-5T)", "Strawberry Shortcake", "store-walmart", "pajamas", 15, "Strawberry Shortcake pajamas at a Black Friday price."],
  // #17 print Mickey Mouse Grey: walmart.com/ip/20355162857 read 11-25 ~12:25 AM, $7.19, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4j1P1VH", 7.19, "https://i5.walmartimages.com/asr/b06e3d84-ac3f-45d5-8f84-a2251192fcbb.4669a86c3ab63577707a024650571205.jpeg", "Mickey Mouse Toddler Coat-Top Pajama Set (12M-5T)", "Disney", "store-walmart", "pajamas", 15, "Mickey Mouse pajamas at a Black Friday price."],
  // #17 print Minnie: walmart.com/ip/20434060218 read 11-25 ~12:25 AM, $12.98, sold by Walmart.com.
  ["https://walmrt.us/4fPIaMM", 12.98, "https://i5.walmartimages.com/asr/c12c540a-ce7d-4d26-83f5-eed6d2cd0f60.f462ec92b5ec2f7632263ddf7b60f54c.jpeg", "Minnie Mouse Toddler Coat-Top Pajama Set (12M-5T)", "Disney", "store-walmart", "pajamas", 15, "Minnie Mouse pajamas at a Black Friday price."],
  // #17 print Tonka: walmart.com/ip/20233415040 read 11-25 ~12:25 AM, $7.19, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/3VHakCW", 7.19, "https://i5.walmartimages.com/asr/cc8c8286-6c3e-4aee-884a-e6b1e6c1fbb5.83c3fedf566ba8b545d337239b6cb5da.jpeg", "Tonka Toddler Coat-Top Pajama Set (12M-5T)", "Tonka", "store-walmart", "pajamas", 15, "Tonka pajamas at a Black Friday price."],
  // #17 print Princess: walmart.com/ip/20417757802 read 11-25 ~12:25 AM, $12.98, sold by Walmart.com.
  ["https://walmrt.us/4tjUhqV", 12.98, "https://i5.walmartimages.com/asr/9576c00f-8eed-40f9-8cca-e740662c1803.9298c12850a5e22e21827a2031705bc6.jpeg", "Disney Princess Toddler Coat-Top Pajama Set (12M-5T)", "Disney", "store-walmart", "pajamas", 15, "Disney Princess pajamas at a Black Friday price."],
  // #17 print Barbie Pink: walmart.com/ip/20166867398 read 11-25 ~12:25 AM, $12.98, sold by Walmart.com.
  ["https://walmrt.us/4lbUIl6", 12.98, "https://i5.walmartimages.com/asr/047dce25-f472-4a5c-a459-c4ebe35dbb5c.3cdb476e191f4e081eb2963f76110e32.jpeg", "Barbie Toddler Coat-Top Pajama Set, Pink (12M-5T)", "Barbie", "store-walmart", "pajamas", 15, "Barbie pajamas at a Black Friday price."],
  // #27 print Disney Princess Pink: walmart.com/ip/20140608346 read 11-25 ~12:25 AM, $7, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4lbUESo", 7.0, "https://i5.walmartimages.com/asr/55ef313b-6669-4a28-abfb-03734a50a3be.f56880b9f3f02e3f1a081f19b7e1b450.jpeg", "Disney Princess Kids Pajama Set (4-16)", "Disney", "store-walmart", "pajamas", 15, "Disney Princess pajamas at a Black Friday price."],
  // #27 print Super Mario Purple: walmart.com/ip/20140508718 read 11-25 ~12:25 AM, $7, sold by Walmart.com.
  ["https://walmrt.us/4A7xCkw", 7.0, "https://i5.walmartimages.com/asr/6dd738f3-1d78-4e91-a90e-e221e67d8948.1791e22c86efa528750ef835afce7d11.jpeg", "Super Mario Kids Pajama Set, Purple (4-16)", "Nintendo", "store-walmart", "pajamas", 15, "Super Mario pajamas at a Black Friday price."],
  // #27 print Super Mario Blue: walmart.com/ip/20098360915 read 11-25 ~12:25 AM, $7, sold by Walmart.com.
  ["https://walmrt.us/4AQzIVE", 7.0, "https://i5.walmartimages.com/asr/360e68a9-b50a-4c3a-9a17-15ccef70434c.82ae25a0f268c1e4b3429bb0ba45ce39.jpeg", "Super Mario Kids Pajama Set, Blue (4-16)", "Nintendo", "store-walmart", "pajamas", 15, "Super Mario pajamas at a Black Friday price."],
  // #27 print Hello Kitty Purple: walmart.com/ip/20160254345 read 11-25 ~12:25 AM, $7, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4AaBwJk", 7.0, "https://i5.walmartimages.com/asr/894ad2aa-37c1-4b5a-a10e-9cbaa60dedee.90b20f4cfa81ca5485cb0d5e00cfd9db.jpeg", "Hello Kitty Kids Pajama Set, Purple (4-16)", "Hello Kitty", "store-walmart", "pajamas", 15, "Hello Kitty pajamas at a Black Friday price."],
  // #27 print Hello Kitty Red: walmart.com/ip/20167205509 read 11-25 ~12:25 AM, $7, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4tlQ2eK", 7.0, "https://i5.walmartimages.com/asr/6f575ffd-8900-46d5-83c3-617fedfc7694.e9da7557e5da15986819c85a1d805862.jpeg", "Hello Kitty Kids Pajama Set, Red (4-16)", "Hello Kitty", "store-walmart", "pajamas", 15, "Hello Kitty pajamas at a Black Friday price."],
  // #27 print Frozen Blue: walmart.com/ip/20160254339 read 11-25 ~12:25 AM, $7, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4eZnjGG", 7.0, "https://i5.walmartimages.com/asr/fae8f15b-58e1-477d-9b8a-d5b34284060e.08c596f66fa8a90f174ca7001b011cf3.jpeg", "Frozen Kids Pajama Set (4-16)", "Disney", "store-walmart", "pajamas", 15, "Frozen pajamas at a Black Friday price."],
  // #27 print Lilo & Stitch Blue: walmart.com/ip/20167155634 read 11-25 ~12:25 AM, $7, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4Aa49X8", 7.0, "https://i5.walmartimages.com/asr/4cc12905-68a7-4ffd-953e-3c78731435d4.4f198f76f3f81f3d56bb12dcfc2619bd.jpeg", "Lilo & Stitch Kids Pajama Set, Blue (4-16)", "Disney", "store-walmart", "pajamas", 15, "Lilo & Stitch pajamas at a Black Friday price."],
  // #27 print Lilo & Stitch Pink: walmart.com/ip/20144763452 read 11-25 ~12:25 AM, $7, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4ARwgKs", 7.0, "https://i5.walmartimages.com/asr/e8dc85b2-908a-4207-8f3a-6fcf568d669e.3d10978fd4ee62f48b9c47d9df03d161.jpeg", "Lilo & Stitch Kids Pajama Set, Pink (4-16)", "Disney", "store-walmart", "pajamas", 15, "Lilo & Stitch pajamas at a Black Friday price."],
  // #27 print Jurassic World Orange: walmart.com/ip/20073103005 read 11-25 ~12:25 AM, $7, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/3Vg2vDU", 7.0, "https://i5.walmartimages.com/asr/6bba4e57-5147-4ec1-bac0-813078a168d7.ec95580470e8da93de03df051a73f5a3.jpeg", "Jurassic World Kids Pajama Set (4-16)", "Jurassic World", "store-walmart", "pajamas", 15, "Jurassic World pajamas at a Black Friday price."],
  // #27 print Sonic Blue: walmart.com/ip/20073103004 read 11-25 ~12:25 AM, $7, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4tfD9Tf", 7.0, "https://i5.walmartimages.com/asr/2754ebbd-be3d-43b3-808f-597f462ab6b3.5909ddb8283bac9b04a357fcd43deeb8.jpeg", "Sonic Kids Pajama Set (4-16)", "Sonic the Hedgehog", "store-walmart", "pajamas", 15, "Sonic pajamas at a Black Friday price."],
  // #27 print Ninja Turtles Green: walmart.com/ip/20058008197 read 11-25 ~12:25 AM, $7, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/3Vj4Kqe", 7.0, "https://i5.walmartimages.com/asr/22b867fd-a3d6-4117-885c-ac0c63191dee.69c2407749596105c702cf769972ca76.jpeg", "Teenage Mutant Ninja Turtles Kids Pajama Set (4-16)", "Nickelodeon", "store-walmart", "pajamas", 15, "Teenage Mutant Ninja Turtles pajamas at a Black Friday price."],
  // #27 print Barbie White: walmart.com/ip/20180056418 read 11-25 ~12:25 AM, $7, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4tl8fZF", 7.0, "https://i5.walmartimages.com/asr/871fd944-6ae5-4a57-be62-c6cf606869b1.528d06fbe5af70830d8905304f283833.jpeg", "Barbie Kids Pajama Set (4-16)", "Barbie", "store-walmart", "pajamas", 15, "Barbie pajamas at a Black Friday price."],
  // #27 print Toy Story Blue: walmart.com/ip/20082018805 read 11-25 ~12:25 AM, $7, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4tgDB3I", 7.0, "https://i5.walmartimages.com/asr/3b3f91b7-5af1-4149-827f-167715111605.e1966f8953a9c13ead95d703a476b000.jpeg", "Toy Story Kids Pajama Set (4-16)", "Disney Pixar", "store-walmart", "pajamas", 15, "Toy Story pajamas at a Black Friday price."],
  // #27 print The Grinch Pink: walmart.com/ip/20160254347 read 11-25 ~12:25 AM, $7, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4A0YC4p", 7.0, "https://i5.walmartimages.com/asr/4922d1a2-ccf4-45a5-9e2e-21a8467c4fe1.1650015e1358693d870dac478458282f.jpeg", "Grinch Kids Pajama Set, Pink (4-16)", "Dr. Seuss", "store-walmart", "pajamas", 15, "Grinch pajamas at a Black Friday price."],
  // #64 print Care Bears Blue: walmart.com/ip/20369808086 read 11-25 ~12:25 AM, $5.4, was $10.98, sold by Walmart.com.
  ["https://walmrt.us/4zGPOjQ", 5.4, "https://i5.walmartimages.com/asr/f5d3d7cb-4f0e-404e-8bbd-7cf47633ba77.5c780257a5748f0ca073e1c69d90217d.jpeg", "Care Bears Toddler One-Piece Sleeper (2T-5T)", "Care Bears", "store-walmart", "pajamas", 15, "A one-piece Care Bears sleeper for toddlers."],
  // #64 print Minnie Red: walmart.com/ip/20405856677 read 11-25 ~12:25 AM, $5.4, was $10.98, sold by Walmart.com.
  ["https://walmrt.us/48I4xQr", 5.4, "https://i5.walmartimages.com/asr/3efcd901-4b2f-4510-b78f-5ab3388c239d.451fa83be286167d9075ab0ead747a9f.jpeg", "Minnie Mouse Toddler One-Piece Sleeper (2T-5T)", "Disney", "store-walmart", "pajamas", 15, "A one-piece Minnie Mouse sleeper for toddlers."],
  // #64 print Disney Princess Blue: walmart.com/ip/20362270201 read 11-25 ~12:25 AM, $5.4, was $10.98, sold by Walmart.com.
  ["https://walmrt.us/4kzGB9d", 5.4, "https://i5.walmartimages.com/asr/63a7a91c-78c1-4fd6-b62c-7a62c451ec42.12c899427a9c8891693f96daf6537d6c.jpeg", "Disney Princess Toddler One-Piece Sleeper (2T-5T)", "Disney", "store-walmart", "pajamas", 15, "A one-piece Disney Princess sleeper for toddlers."],
  // #65 print How The Grinch Stole Christmas White: walmart.com/ip/20389102588 read 11-25 ~12:25 AM, $6.3, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4jBxIKf", 6.3, "https://i5.walmartimages.com/asr/e48d05c0-6d9b-4819-a050-a9576ab34c3b.fc53795d6005913ecdfaf33f1e189e0b.jpeg", "Grinch Toddler Fleece Robe (12M-5T)", "Dr. Seuss", "store-walmart", "robe", 15, "A fleece Grinch robe for toddlers."],
  // #65 print Strawberry Shortcake Pink: walmart.com/ip/20398618096 read 11-25 ~12:25 AM, $6.3, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4jaUUPc", 6.3, "https://i5.walmartimages.com/asr/28ede100-bd45-40d7-a7d7-47646c097eac.1bddfd91848c45ea91adab82b152caaa.jpeg", "Strawberry Shortcake Toddler Fleece Robe (12M-5T)", "Strawberry Shortcake", "store-walmart", "robe", 15, "A fleece Strawberry Shortcake robe for toddlers."],
  // #65 print Minnie Mouse Pink: walmart.com/ip/20335801879 read 11-25 ~12:25 AM, $6.3, was $12.98, sold by Walmart.com.
  ["https://walmrt.us/4jb5vcF", 6.3, "https://i5.walmartimages.com/asr/d5e48c94-eb64-44e9-9ce0-11ca27aaf1ad.1cd80398f966aed0905dd0ed2d190af4.jpeg", "Minnie Mouse Toddler Fleece Robe (12M-5T)", "Disney", "store-walmart", "robe", 15, "A fleece Minnie Mouse robe for toddlers."],
  // #66 print Minnie Mouse Vivid White: walmart.com/ip/19191554965 read 11-25 ~12:25 AM, $10, sold by Walmart.com.
  ["https://walmrt.us/4j9FpqC", 10.0, "https://i5.walmartimages.com/asr/8fdaacd3-1710-4f71-8514-fc081b812912.808255a2df42cc2c02012ee8b7b060a0.jpeg", "Minnie Mouse Toddler Patriotic Tee (12M-5T)", "Disney", "store-walmart", "tee", 15, "A patriotic Minnie Mouse tee for toddlers."],
  // #66 print Toy Story Pink Frost: walmart.com/ip/19179908893 read 11-25 ~12:25 AM, $14, sold by Walmart.com.
  ["https://walmrt.us/4A1HtrP", 14.0, "https://i5.walmartimages.com/asr/a4819d31-0543-446d-b4a4-562f291e43a8.ecf712cb861fd37be72c5f9659654555.jpeg", "Toy Story Toddler Patriotic Tee (12M-5T)", "Disney Pixar", "store-walmart", "tee", 15, "A patriotic Toy Story tee for toddlers."],
  // #66 print Stitch Rally Blue: walmart.com/ip/19201107354 read 11-25 ~12:25 AM, $11.97, sold by Walmart.com.
  ["https://walmrt.us/4jamQm7", 11.97, "https://i5.walmartimages.com/asr/2ac162af-6c13-45e1-b85a-734c6cae7e70.0e3603d3c0c859ef8469cbe34fc33dd2.jpeg", "Stitch Toddler Patriotic Tee (12M-5T)", "Disney", "store-walmart", "tee", 15, "A patriotic Stitch tee for toddlers."],
  // #66 print Mickey Mouse Blue Crest: walmart.com/ip/19171211827 read 11-25 ~12:25 AM, $14, sold by Walmart.com.
  ["https://walmrt.us/3X7CzuU", 14.0, "https://i5.walmartimages.com/asr/1308c9ef-0e89-4578-a9b8-24f039ec5f98.ef4339f86c2a22cc9443af30d4a63296.jpeg", "Mickey Mouse Toddler Patriotic Tee (12M-5T)", "Disney", "store-walmart", "tee", 15, "A patriotic Mickey Mouse tee for toddlers."],
  // #66 print Hello Kitty Clear Sky: walmart.com/ip/13947161779 read 11-25 ~12:25 AM, $14.49, sold by Walmart.com.
  ["https://walmrt.us/4A1xnHu", 14.49, "https://i5.walmartimages.com/asr/c246c850-105b-42c7-b6c7-1c4d4ee908d9.93adff5b41e98fa699a0ba4b1e29d1b5.jpeg", "Hello Kitty Toddler Patriotic Tee (12M-5T)", "Hello Kitty", "store-walmart", "tee", 15, "A patriotic Hello Kitty tee for toddlers."],
  // #78 print Hello Kitty: walmart.com/ip/20493453524 read 11-25 ~12:25 AM, $7, was $11.98, sold by Walmart.com.
  ["https://walmrt.us/4fqQX7K", 7.0, "https://i5.walmartimages.com/asr/d0773dd6-c747-4f9d-bbde-339c52ff3532.644388db831d18ffd32469c0a51024f9.jpeg", "Hello Kitty Toddler Girls Beanie and Gloves Set", "Hello Kitty", "store-walmart", "hat", 15, "A Hello Kitty beanie with matching gloves."],
  // #78 print Lilo & Stitch: walmart.com/ip/20178702330 read 11-25 ~12:25 AM, $7, sold by Walmart.com.
  ["https://walmrt.us/4jb5wgJ", 7.0, "https://i5.walmartimages.com/asr/a4c55790-df92-4cdc-b3f9-ca6ba5525081.a511fa68d50ad2ba3f13f6bf5232fcdf.jpeg", "Lilo & Stitch Toddler Girls Beanie and Gloves Set", "Disney", "store-walmart", "hat", 15, "A Lilo & Stitch beanie with matching gloves."],
  // #78 print Toy Story Jessie: walmart.com/ip/20187555500 read 11-25 ~12:25 AM, $11.98, sold by Walmart.com.
  ["https://walmrt.us/4jhFZmp", 11.98, "https://i5.walmartimages.com/asr/b512b8c8-a164-434c-941a-46c55006adda.f7d7b1a94dfc67789c5ba9ae98233b02.jpeg", "Toy Story Jessie Toddler Girls Beanie and Gloves Set", "Disney Pixar", "store-walmart", "hat", 15, "A Toy Story Jessie beanie with matching gloves."],
  // #78 print Toy Story: walmart.com/ip/20122651246 read 11-25 ~12:25 AM, $11.98, sold by Walmart.com.
  ["https://walmrt.us/4j8cZ03", 11.98, "https://i5.walmartimages.com/asr/f6c684e2-142b-4dfa-8942-4f7dab88025b.41a792897967012f1485352504c441ac.jpeg", "Toy Story Toddler Girls Beanie and Gloves Set", "Disney Pixar", "store-walmart", "hat", 15, "A Toy Story beanie with matching gloves."],
  // non-Bluey item print Paw Patrol: walmart.com/ip/5395472280 read 11-25 ~12:25 AM, $4.5, was $9.98, sold by Walmart.com.
  ["https://walmrt.us/3Vfu4xm", 4.5, "https://i5.walmartimages.com/asr/ef7d50b4-9a5c-4f2b-807c-579889bc4cdc.bb33e009f98fc8f410ea8a125eb931fb.jpeg", "PAW Patrol Toddler Pajama Set (12M-5T)", "PAW Patrol", "store-walmart", "pajamas", 15, "PAW Patrol pajamas at a Black Friday price."],
  // non-Bluey item print Ms. Rachel Platinum Silver Heather: walmart.com/ip/18523809793 read 11-25 ~12:25 AM, $3.38, sold by Walmart.com.
  ["https://walmrt.us/4ANUqp7", 3.38, "https://i5.walmartimages.com/asr/f403338a-c23f-474d-b079-4d6af1886e1e.0ae877f0943aacdd60b5e3bf80e2a855.jpeg", "Ms. Rachel Baby Girls Tee and Shorts Set (0-9M)", "Ms. Rachel", "store-walmart", "baby-clothes", 15, "A sweet Ms. Rachel tee and shorts set for babies."],
  // non-Bluey item: walmart.com/ip/1755280341 read 11-25 ~12:25 AM, $11.04, was $12.99, sold by Walmart.com.
  ["https://walmrt.us/4ku91Bo", 11.04, "https://i5.walmartimages.com/asr/f1e5ed5c-9c8c-4039-9601-53eb93bc24d7.a3f4a70fcc79512f97fe3036c051d341.jpeg", "Disney Eeyore Mini Bean Bag Plush", "Disney", "store-walmart", "plush", 6, "A soft little Eeyore to hug."],
  // OWNER JCPENNEY "KIDS TOYS" PICKS (owner screenshots 11-25 12:32-12:35 AM via the lead, ~/.lh-shots/kids-owner-adds-1125/
  // jcpenney-kids-toys.md): the 23 found on the jcpenney.com "kids toys" search page; her Later links (JCPenney via Later 10.5%),
  // made in the Later dashboard 11-25 ~1:00 AM, never opened.
  // JCPenney #3: costway-6v-kids-electric-quad-atv-4-wheels-ride-on-toy-toddlers-forward-reverse/ppm6100050812 read 11-25 ~12:58 AM (kids toys search): $69.99 (was $239.99).
  ["https://mavely.app.link/mQ3bdqWDl8b", 69.99, "https://mktpl-images.jcpenney.com/SOURCE/833aadb99d5b4febb801a50dc07b9f62", "Costway 6V Kids Electric Quad ATV Ride-On", "Costway", "store-jcpenney", "ride-on", 10.5, "A battery-powered ATV for little riders."],
  // JCPenney #31: costway-kids-pedal-go-kart-4-wheel-ride-on-toys-w-adjustable-seat-handbrake/ppm6100050884 read 11-25 ~12:58 AM (kids toys search): $99.99.
  ["https://mavely.app.link/fqxGCAWDl8b", 99.99, "https://mktpl-images.jcpenney.com/SOURCE/48cf8aa374884218b899e9f1277a24d4", "Costway Kids Pedal Go Kart", "Costway", "store-jcpenney", "ride-on", 10.5, "A pedal go kart with an adjustable seat."],
  // JCPenney #32: learning-resources-a-to-z-mini-foods-discovery-toy/ppr5008757332 read 11-25 ~12:58 AM (kids toys search): $14.99 (was $25).
  ["https://mavely.app.link/1aPI2KWDl8b", 14.99, "https://sc-images.jcpenney.com/JCPenney/DP0622202607143941M", "Learning Resources A to Z Mini Foods", "Learning Resources", "store-jcpenney", "pretend-play", 10.5, "Tiny play foods for every letter, A to Z."],
  // JCPenney #35: snowball-headband-hoop-game-set-of-2/ppr5008738146 read 11-25 ~12:58 AM (kids toys search): $14.99 (was $25).
  ["https://mavely.app.link/1i1TtVWDl8b", 14.99, "https://sc-images.jcpenney.com/JCPenney/DP0624202609034881M", "Snowball Headband Hoop Game, Set of 2", "", "store-jcpenney", "game", 10.5, "A silly headband toss game for two."],
  // JCPenney #36: quokka-60-piece-jigsaw-puzzle-for-kids-illustrated-learning-puzzles-with-animal-and-fantasy-themes-for-ages-3/ppm6100020594 read 11-25 ~12:58 AM (kids toys search): $8.99 (was $9.99).
  ["https://mavely.app.link/Rut9K5WDl8b", 8.99, "https://mktpl-images.jcpenney.com/SOURCE/0b6728a3e5454162bb35976503bb33ed", "QUOKKA 60-Piece Kids Jigsaw Puzzle", "QUOKKA", "store-jcpenney", "puzzle", 10.5, "A 60-piece picture puzzle for kids."],
  // JCPenney #37: discovery-mindblown-bionic-hand-diy-hydraulic-build-kit/ppr5008499526 read 11-25 ~12:58 AM (kids toys search): $24.99 (was $40).
  ["https://mavely.app.link/1fbvugXDl8b", 24.99, "https://sc-images.jcpenney.com/JCPenney/DP0929202509090126M", "Discovery Mindblown Bionic Hand DIY Hydraulic Kit", "Discovery", "store-jcpenney", "stem-kit", 10.5, "A hydraulic robot hand to build."],
  // JCPenney #38: discovery-kids-spy-goggles/ppr5008807329 read 11-25 ~12:58 AM (kids toys search): $14.99 (was $30).
  ["https://mavely.app.link/e3OCqrXDl8b", 14.99, "https://sc-images.jcpenney.com/JCPenney/DP73214776-20260924050938M", "Discovery Kids Spy Goggles", "Discovery", "store-jcpenney", "spy-toy", 10.5, "Spy goggles for backyard missions."],
  // JCPenney #39: disney-collection-mickey-mouse-clubhouse-grill-set/ppr5008819397 read 11-25 ~12:58 AM (kids toys search): $17.49 (was $24.99).
  ["https://mavely.app.link/VjBJoCXDl8b", 17.49, "https://sc-images.jcpenney.com/JCPenney/DP73027399-20260923025700M", "Disney Mickey Mouse Clubhouse Grill Set", "Disney", "store-jcpenney", "pretend-play", 10.5, "A Mickey Mouse Clubhouse play grill."],
  // JCPenney #40: discovery-kids-discovery-11-pc-drawing-kit/ppr5008807318 read 11-25 ~12:58 AM (kids toys search): $34.99 (was $70).
  ["https://mavely.app.link/ZxaYRVXDl8b", 34.99, "https://sc-images.jcpenney.com/JCPenney/DP72784624-20260918030400M", "Discovery Kids 11-Piece Light Designer Drawing Kit", "Discovery", "store-jcpenney", "art", 10.5, "A light-up drawing kit for little artists."],
  // JCPenney #41: 4-in-1-kids-art-easel-3-tier-bookshelf-double-sided-magnetic-whiteboard-blackboard-adjustable-angle-carry-handle/ppm6100026514 read 11-25 ~12:58 AM (kids toys search): $50.99 (was $101.99).
  ["https://mavely.app.link/vgUK49XDl8b", 50.99, "https://mktpl-images.jcpenney.com/SOURCE/e147e73cc07c4ebd8a0a50c7773775c3", "4-in-1 Kids Art Easel with Bookshelf", "", "store-jcpenney", "art", 10.5, "A 4-in-1 art easel with a bookshelf."],
  // JCPenney #43: disney-collection-9-pc-minnie-mouse-toy-playset/ppr5008546698 read 11-25 ~12:58 AM (kids toys search): $16.8 (was $24).
  ["https://mavely.app.link/LUeIqlYDl8b", 16.8, "https://sc-images.jcpenney.com/JCPenney/DP0909202509125637M", "Disney Minnie Mouse 9-Piece Shopping Playset", "Disney", "store-jcpenney", "pretend-play", 10.5, "A Minnie Mouse shopping cart playset."],
  // JCPenney #44: quokka-scavenger-hunt-cards-for-toddlers-50-activity-challenges-learning-games-for-kids-ages-2/ppm6100020555 read 11-25 ~12:58 AM (kids toys search): $11.69 (was $12.99).
  ["https://mavely.app.link/XeknLvYDl8b", 11.69, "https://mktpl-images.jcpenney.com/SOURCE/01327d718e384708b418413cffc8100f", "QUOKKA Toddler Scavenger Hunt Cards", "QUOKKA", "store-jcpenney", "game", 10.5, "Scavenger hunt cards for toddlers."],
  // JCPenney #45: discovery-kids-toy-24-piece-magnetic-tile/ppr5007275541 read 11-25 ~12:58 AM (kids toys search): $19.99 (was $42).
  ["https://mavely.app.link/5mhK5l0Dl8b", 19.99, "https://sc-images.jcpenney.com/JCPenney/DP0710201717120536M", "Discovery Kids 24-Piece Magnetic Tiles", "Discovery", "store-jcpenney", "building-set", 10.5, "Magnetic tiles to build with."],
  // JCPenney #46: disney-collection-talking-mickey-mouse-clubhouse-minnie-mouse-interactive-plush/ppr5008450298 read 11-25 ~12:58 AM (kids toys search): $17.5 (was $25).
  ["https://mavely.app.link/7QubVC0Dl8b", 17.5, "https://sc-images.jcpenney.com/JCPenney/DP0614202411032024M", "Disney Talking Minnie Mouse Clubhouse Plush", "Disney", "store-jcpenney", "plush", 10.5, "A talking Minnie Mouse plush."],
  // JCPenney #47: sperric-splash-catch-bath-toy-magnetic-fishing-game-w-surprise-animal-eggs-floating-fun-for-toddlers-kids/ppm6100027749 read 11-25 ~12:58 AM (kids toys search): $19.87 (was $26.85).
  ["https://mavely.app.link/wZWXGO0Dl8b", 19.87, "https://mktpl-images.jcpenney.com/SOURCE/b1c342a8849f4e04a959c45a6c65a681", "Sperric Splash and Catch Magnetic Fishing Bath Toy", "Sperric", "store-jcpenney", "bath-toy", 10.5, "A magnetic fishing game for the tub."],
  // JCPenney #48: retro-arcade-desktop-pool-table-game/ppr5008738140 read 11-25 ~12:58 AM (kids toys search): $19.99 (was $50).
  ["https://mavely.app.link/2hIOUY0Dl8b", 19.99, "https://sc-images.jcpenney.com/JCPenney/DP0624202609030169M", "Retro Arcade Desktop Pool Table Game", "Retro Arcade", "store-jcpenney", "game", 10.5, "A tabletop pool table game."],
  // JCPenney #49: learning-resources-lock-and-key-clubhouse-discovery-toy/ppr5008757331 read 11-25 ~12:58 AM (kids toys search): $14.99 (was $25).
  ["https://mavely.app.link/lAc8De1Dl8b", 14.99, "https://sc-images.jcpenney.com/JCPenney/DP0622202607144150M", "Learning Resources Lock and Key Clubhouse", "Learning Resources", "store-jcpenney", "pretend-play", 10.5, "A lock-and-key clubhouse for little hands."],
  // JCPenney #50: retro-arcade-duck-shooting-gallery-game/ppr5008738137 read 11-25 ~12:58 AM (kids toys search): $19.99 (was $50).
  ["https://mavely.app.link/5QNqNo1Dl8b", 19.99, "https://sc-images.jcpenney.com/JCPenney/DP0624202609031843M", "Retro Arcade Duck Shooting Gallery Game", "Retro Arcade", "store-jcpenney", "game", 10.5, "A duck shooting gallery game for the table."],
  // JCPenney #51: kiddieland-noahs-ark-play-set/ppr5007754169 read 11-25 ~12:58 AM (kids toys search): $31.99.
  ["https://mavely.app.link/j53Kfz1Dl8b", 31.99, "https://sc-images.jcpenney.com/JCPenney/5f7979b8-4f04-11e8-b3d8-35fb160e5921", "Kiddieland Noah's Ark Play Set", "Kiddieland", "store-jcpenney", "playset", 10.5, "A Noah's Ark playset with animals."],
  // JCPenney #52: discovery-mindblown-planetarium-projector-discovery-toy/ppr5008807323 read 11-25 ~12:58 AM (kids toys search): $29.99 (was $65).
  ["https://mavely.app.link/YteYEJ1Dl8b", 29.99, "https://sc-images.jcpenney.com/JCPenney/DP73197925-20260924043449M", "Discovery Mindblown Planetarium Projector", "Discovery", "store-jcpenney", "stem-toy", 10.5, "A planetarium projector for bedtime stars."],
  // JCPenney #53: sharper-image-flip-stunt-rally-remote-control-car/ppr5008279405 read 11-25 ~12:58 AM (kids toys search): $19.99 (was $40).
  ["https://mavely.app.link/6EGA1T1Dl8b", 19.99, "https://sc-images.jcpenney.com/JCPenney/DP0310202309015796M", "Sharper Image Flip Stunt Rally RC Car", "Sharper Image", "store-jcpenney", "rc-car", 10.5, "A remote-control stunt car that flips."],
  // JCPenney #54: quokka-kids-sewing-craft-kit-felt-toy-making-beginner-stitching-set-for-kids-ages-6/ppm6100020547 read 11-25 ~12:58 AM (kids toys search): $20.69 (was $22.99).
  ["https://mavely.app.link/eLRI671Dl8b", 20.69, "https://mktpl-images.jcpenney.com/SOURCE/fb1a47cbf3934e45a2d1894bb075b80b", "QUOKKA Kids Sewing Craft Kit", "QUOKKA", "store-jcpenney", "craft-kit", 10.5, "A felt sewing kit for beginners."],
  // JCPenney #55: discovery-kids-bright-doodles-lcd-art-tablet-drawing-kit/ppr5008499523 read 11-25 ~12:58 AM (kids toys search): $19.99 (was $30).
  ["https://mavely.app.link/phkEti2Dl8b", 19.99, "https://sc-images.jcpenney.com/JCPenney/DP1120202409072907M", "Discovery Kids Bright Doodles LCD Art Tablet", "Discovery", "store-jcpenney", "art", 10.5, "An LCD drawing tablet for doodling."],
  // Owner ~3:10 AM (kohls.com screenshot, "Add this."): Kohl's $44.99 sale (reg $59.99, not eligible for coupons), ages 3+.
  // Store check 11-24 ~3:08 AM: Target $67.99 (lead), Walmart $71 / a $99.22 marketplace seller, Amazon ~$111; Kohl's wins and
  // pays 10.5% through Later (link made ~3:29 AM when Later signed in again; ShopMy has no Kohl's).
  ["https://mavely.app.link/yftqKoJ9j8b", 44.99, "https://media.kohlsimg.com/is/image/kohls/8214073", "Monster Jam Megalodon & El Toro Loco Supercharge Speedway Playset", "Monster Jam", "store-kohls", "vehicle-toy", 10.5, "A light-up figure-8 Monster Jam track with two trucks."],
  // S47: Walmart $54 (was $74.99, Midnight Black, sold by Walmart, in stock ~3:17 AM) through Walmart Creator 6%; Kohl's
  // ($54.99 + Kohl's Cash) pays 0% on gaming, Target pays 4% (ShopMy), Later's Walmart gaming 4.9%.
  ["https://walmrt.us/4texdKc", 54, "https://i5.walmartimages.com/seo/Sony-PS5-DualSense-Wireless-Controller-Midnight-Black_2384fbb2-237e-4e16-89bb-f39d20777a0f.a6d2c857ba5ab080f212f44d72baf0f4.png", "Sony PS5 DualSense Wireless Controller, Midnight Black", "Sony", "store-walmart", "game-controller", 6, "A PS5 DualSense controller for game nights."],
  // Macy's steals (links made in her ShopMy at Macy's 16%, 11-24 ~2:00 AM). Prices are the Macy's Black Friday prices read
  // ~1:30 AM (bf-store-sales-1124.md); macys.com has refused page reads since ~2:11 AM (Access Denied in Chrome and curl), so
  // each photo is Macy's own product photo as mirrored on a Macy's price-tracker page (beyondstyle.us, id macys_<ID>), and
  // each age is the maker's (Jakks lists Bowser 3+, Mattel lists UNO 7+).
  // S5 (reg. $23, offer ends Dec 6), Macy's ID 17611947, "for ages 3 and up".
  ["https://go.shopmy.us/p-110122442", 8, "https://5thave-img-cdn.santasmartnetwork.com/pf/a4439462-c327-3203-a0af-134c8b7e1f9a.jpg", "Gund Kuromi Cupcake Plush", "Gund", "store-macys", "plush", 16, "A squishy Kuromi cupcake plush to hug."],
  // S6 (reg. $26.99), Macy's ID 23353679.
  ["https://go.shopmy.us/p-110122526", 5.57, "https://5thave-img-cdn.santasmartnetwork.com/pf/5639cc43-2a59-3a28-8865-53a02bedabf8.jpg", "UNO Artiste Vexx Card Game", "Mattel", "store-macys", "game", 16, "An art-filled UNO deck for family game night."],
  // S8 (reg. $44.99; Walmart and Target $26.99), Macy's ID 17037168.
  ["https://go.shopmy.us/p-110122583", 12.57, "https://5thave-img-cdn.santasmartnetwork.com/pf/21ce5baf-790f-3743-a60e-6f71d23bd440.jpg", "Super Mario Deluxe Bowser Battle Playset", "Jakks Pacific", "store-macys", "playset", 16, "A Bowser boss battle with glowing lava and sounds."],
  // S9 (reg. $99.99, created for Macy's), Macy's ID 18890561, "designed for children aged 3+".
  ["https://go.shopmy.us/p-110122602", 13.97, "https://5thave-img-cdn.santasmartnetwork.com/pf/1a9b2af2-832b-374b-b7d9-45e706e2a90b.jpg", "Starlight Glam Light-Up Vanity Playset", "Geoffrey's Toy Box", "store-macys", "pretend-play", 16, "A light-up play vanity with beauty accessories."],
  // S10 (reg. $119.99), Macy's ID 23693052; no maker's age on the listing.
  ["https://go.shopmy.us/p-110122700", 16.77, "https://5thave-img-cdn.santasmartnetwork.com/pf/7089d969-7721-3baa-b676-dff0c0b25fe0.jpg", "Journey Girls Glam Runway 4-Sided Fashion Show Playset", "Journey Girls", "store-macys", "pretend-play", 16, "A light-up runway for at-home fashion shows."],
  // S15 (reg. $65), Macy's ID 27143484, girls' sizes 5-16 (the Steve Madden jacket of the "Reebok or Steve Madden" deal).
  ["https://go.shopmy.us/p-110122792", 19.99, "https://5thave-img-cdn.santasmartnetwork.com/pf/978baa26-8b88-3a81-9edc-30ddba307077.jpg", "Steve Madden Girls' Lightweight Hooded Packable Jacket", "Steve Madden", "store-macys", "jacket", 16, "A light packable puffer in girls' sizes 5-16."],
  // S51: ShopMy crocs.com 10% (link made 11-24 ~4:10 AM, rate on ShopMy's link screen); crocs.com $23 for the Kids' Classic
  // Clog (read ~3:12 AM, in stock; the photo is Black). Kids' third Crocs item is skipped (one per brand rule: Jibbitz + this).
  ["https://go.shopmy.us/p-110135306", 23, "https://media.crocs.com/images/t_standard/products/206991_001_ALT140/crocs", "Crocs Kids' Classic Clog", "Crocs", "store-crocs", "shoes", 10, "Classic Crocs clogs in kid sizes."],
  // S52 (owner ticked it; Kids' 3rd Crocs item, over the ~2-per-brand line, for her to trim): crocs.com Kids' Classic Cozzzy
  // Slipper 210856, $25 (crocs.com product data read 11-24 ~4:05 AM, in stock; Black photo), ShopMy 10% (link ~4:15 AM).
  ["https://go.shopmy.us/p-110137252", 25, "https://media.crocs.com/images/t_standard/products/210856_001_ALT100/crocs", "Crocs Kids' Classic Cozzzy Slipper", "Crocs", "store-crocs", "slippers", 10, "Fuzzy Crocs slippers in kid sizes."],
  // Owner Kohl's screenshot 11-25 1:09 AM (kohls-mixed-0110.md #3): kohls.com prd-4576090 read 11-25 ~1:20 AM: $9.99 sale (reg $17.99; $7.99 with TAKE20), print Toy Story Retro (pick that print on the page). ShopMy quick link, Kohl's 12%; never opened.
  ["https://go.shopmy.us/p-110718740", 9.99, "https://media.kohlsimg.com/is/image/kohls/4576090_Toy_Story_Retro", "The Big One Disney Toy Story Oversized Supersoft Plush Throw", "The Big One", "store-kohls", "blanket", 12, "A huge, soft Toy Story throw for movie nights."],
  // Owner Kohl's screenshot 11-25 1:09 AM (kohls-mixed-0110.md #5): kohls.com prd-8577832 read 11-25 ~1:20 AM: $20 sale (orig $40; $16 with TAKE20). ShopMy quick link, Kohl's 12%; never opened.
  ["https://go.shopmy.us/p-110718757", 20, "https://media.kohlsimg.com/is/image/kohls/8577832", "PAW Patrol Toddler Boy 4-Piece Pajama Set", "PAW Patrol", "store-kohls", "pajamas", 12, "Two cozy PAW Patrol pajama sets in one pack."],
  // Owner Kohl's screenshot 11-25 1:10 AM (kohls-mixed-0110.md #8): kohls.com prd-8053525 read 11-25 ~1:20 AM: $20.99 sale (reg $29.99). ShopMy quick link, Kohl's 12%; never opened.
  ["https://go.shopmy.us/p-110718832", 20.99, "https://media.kohlsimg.com/is/image/kohls/8053525", "Fisher-Price Little People Bowser's Airship and Figure", "Fisher-Price", "store-kohls", "playset", 12, "Bowser's airship for little Mario fans."],
  // Owner Kohl's screenshot 11-25 1:10 AM (kohls-mixed-0110.md #9; Hot Wheels has no Matchbox rows, so Kids): kohls.com prd-7006887 read 11-25 ~1:20 AM: $24.99 sale (reg $49.99). ShopMy quick link, Kohl's 12%; never opened.
  ["https://go.shopmy.us/p-110718853", 24.99, "https://media.kohlsimg.com/is/image/kohls/7006887", "Matchbox Aircraft Carrier Play Set with 10 Die-Cast Planes", "Matchbox", "store-kohls", "playset", 12, "An aircraft carrier with 10 Sky Busters planes and a car."],
  // Owner Kohl's screenshot 11-25 1:10 AM (kohls-mixed-0110.md #9, the 5-pack): kohls.com prd-8100049 read 11-25 ~1:20 AM: $5.24 sale (reg $6.99), styles vary. ShopMy quick link, Kohl's 12%; never opened.
  ["https://go.shopmy.us/p-110718866", 5.24, "https://media.kohlsimg.com/is/image/kohls/8100049", "Matchbox Die-Cast Cars 5-Pack", "Matchbox", "store-kohls", "die-cast", 12, "Five Matchbox cars for a stocking."],
  // JCPenney #1: quokka-30-piece-jigsaw-puzzle-for-kids-educational-puzzles-with-princess-animals-dinosaurs-ages-2-6/ppm6100020584 read 11-25 ~1:20 AM (jcpenney.com search by name): $8.99 (was $9.99). Later link ~1:40 AM.
  ["https://mavely.app.link/7hnOQCcGl8b", 8.99, "https://mktpl-images.jcpenney.com/SOURCE/cd5db8076eda48e3a2fa581121ec607b", "QUOKKA 30-Piece Kids Jigsaw Puzzle", "QUOKKA", "store-jcpenney", "puzzle", 10.5, "A 30-piece puzzle with princesses, animals and dinos."],
  // JCPenney #2: what-do-you-meme-color-stack-board-game/ppr5008745357 read 11-25 ~1:20 AM (jcpenney.com search by name): $19.99 (was $35). Later link ~1:40 AM.
  ["https://mavely.app.link/C7qabzgGl8b", 19.99, "https://sc-images.jcpenney.com/JCPenney/DP0616202607221825M", "What Do You Meme Color Stack Board Game", "What Do You Meme", "store-jcpenney", "game", 10.5, "A fast color-stacking family game."],
  // JCPenney #4: sharper-image-2-pc-remote-control-car/ppr5008807351 read 11-25 ~1:20 AM (jcpenney.com search by name): $14.99 (was $35). Later link ~1:40 AM.
  ["https://mavely.app.link/kzmOaJgGl8b", 14.99, "https://sc-images.jcpenney.com/JCPenney/DP73212561-20260924050435M", "Sharper Image 2-Piece Remote Control Cars", "Sharper Image", "store-jcpenney", "rc-car", 10.5, "Two remote-control cars for racing."],
  // JCPenney #6: play-doh-fun-factory-starter-set/ppr5008551588 read 11-25 ~1:20 AM (jcpenney.com search by name): $7.99 (was $10). Later link ~1:40 AM.
  ["https://mavely.app.link/nz2t3xiGl8b", 7.99, "https://sc-images.jcpenney.com/JCPenney/DP0909202515062231M", "Play-Doh Fun Factory Starter Set", "Play-Doh", "store-jcpenney", "toy", 10.5, "The classic Play-Doh Fun Factory."],
  // JCPenney #7: discovery-mindblown-glow-roll-marble-run-interactive-toy/ppr5008807327 read 11-25 ~1:20 AM (jcpenney.com search by name): $39.99 (was $75). Later link ~1:40 AM.
  ["https://mavely.app.link/Vd9SWHiGl8b", 39.99, "https://sc-images.jcpenney.com/JCPenney/DP72769952-20260917185741M", "Discovery Mindblown Glow Roll Marble Run", "Discovery", "store-jcpenney", "stem-toy", 10.5, "A glowing marble run to build."],
  // JCPenney #8: costway-24v-kids-ride-on-electric-atv-car-toy-with-spring-suspension-led-lights-usb/ppm6100050834 read 11-25 ~1:20 AM (jcpenney.com search by name): $149.99 (was $349.99). Later link ~1:40 AM.
  ["https://mavely.app.link/FFeATSiGl8b", 149.99, "https://mktpl-images.jcpenney.com/SOURCE/2a5aaefd3b2c453eabd88a50129c1fa1", "Costway 24V Kids Ride-On Electric ATV", "Costway", "store-jcpenney", "ride-on", 10.5, "A big 24V ATV with lights and suspension."],
  // JCPenney #9: disney-collection-minnie-mouse-cell-phone-toy-playset/ppr5008542862 read 11-25 ~1:20 AM (jcpenney.com search by name): $20. Later link ~1:40 AM.
  ["https://mavely.app.link/F0aXA3iGl8b", 20.0, "https://sc-images.jcpenney.com/JCPenney/DP0804202511092279M", "Disney Minnie Mouse Cell Phone Toy Playset", "Disney", "store-jcpenney", "pretend-play", 10.5, "A Minnie Mouse play phone."],
  // JCPenney #10: costway-6v-electric-kids-ride-on-train-motorized-train-toy-w-track-6-wheels/ppm6100050868 read 11-25 ~1:20 AM (jcpenney.com search by name): $99.99 (was $309.99). Later link ~1:40 AM.
  ["https://mavely.app.link/Qw4Y2djGl8b", 99.99, "https://mktpl-images.jcpenney.com/SOURCE/ad42853b83084a22af9829d09d6a0f67", "Costway 6V Kids Ride-On Train with Track", "Costway", "store-jcpenney", "ride-on", 10.5, "A ride-on train with its own track."],
  // JCPenney #11: jitterygit-kids-construktor-glow-in-the-dark-track-set-194-piece-stem-building-toy/ppm6100083944 read 11-25 ~1:20 AM (jcpenney.com search by name): $31.99 (was $39.99). Later link ~1:40 AM.
  ["https://mavely.app.link/9VRXk5kGl8b", 31.99, "https://mktpl-images.jcpenney.com/SOURCE/41f6994664d94d58919b69efb93e3e96", "JitteryGit Glow-in-the-Dark Construktor Track Set, 194 Pieces", "JitteryGit", "store-jcpenney", "race-track", 10.5, "A glow-in-the-dark car track to build."],
  // JCPenney #12: costway-wiggle-car-ride-on-toy-w-flashing-wheels-for-toddlers-kids/ppm6100050815 read 11-25 ~1:20 AM (jcpenney.com search by name): $79.99 (was $259.99). Later link ~1:40 AM.
  ["https://mavely.app.link/G4VkFflGl8b", 79.99, "https://mktpl-images.jcpenney.com/SOURCE/81d79d2f2d3e4ff58e20c381a42fcea0", "Costway Wiggle Car Ride-On with Flashing Wheels", "Costway", "store-jcpenney", "ride-on", 10.5, "A wiggle car with light-up wheels."],
  // JCPenney #14: discovery-rc-smoke-breathing-dragon/ppr5007994625 read 11-25 ~1:20 AM (jcpenney.com search by name): $49.99 (was $79). Later link ~1:40 AM.
  ["https://mavely.app.link/8OJevqlGl8b", 49.99, "https://sc-images.jcpenney.com/JCPenney/DP0701202009010173M", "Discovery RC Smoke Breathing Dragon", "Discovery", "store-jcpenney", "rc-toy", 10.5, "A remote-control dragon that breathes mist."],
  // JCPenney #15: sugift-adjustable-kids-stand-punching-bag-toy-set-with-boxing-gloves-32-485-in-tall-ages-3-pinkwhite-blackred/ppm6100073656 read 11-25 ~1:20 AM (jcpenney.com search by name): $68.99 (was $137.99). Later link ~1:40 AM.
  ["https://mavely.app.link/hRAxiBlGl8b", 68.99, "https://mktpl-images.jcpenney.com/SOURCE/d52f5b2d3f86448a9a7671d3df19a774", "SUGIFT Adjustable Kids Punching Bag Set with Gloves", "SUGIFT", "store-jcpenney", "sports", 10.5, "A stand-up punching bag with kid gloves."],
  // JCPenney #16: disney-collection-fabulous-fashion-mickey-mouse-clubhouse-minnie-mouse-doll/ppr5008352983 read 11-25 ~1:20 AM (jcpenney.com search by name): $21 (was $30). Later link ~1:40 AM.
  ["https://mavely.app.link/yS22DLlGl8b", 21.0, "https://sc-images.jcpenney.com/JCPenney/DP0922202317102880M", "Disney Fabulous Fashion Minnie Mouse Doll", "Disney", "store-jcpenney", "doll", 10.5, "Minnie with outfits to mix and match."],
  // JCPenney #17: safari-ltd-energy-ball-kids-science-toy/ppm6100024378 read 11-25 ~1:20 AM (jcpenney.com search by name): $7.63. Later link ~1:40 AM.
  ["https://mavely.app.link/WHKsiknGl8b", 7.63, "https://mktpl-images.jcpenney.com/SOURCE/62998981d7de4cad8fdd4f4e4f471bf6", "Safari Ltd. Energy Ball Science Toy", "Safari Ltd.", "store-jcpenney", "stem-toy", 10.5, "A ball that lights up and buzzes when you touch it."],
  // JCPenney #18: disney-collection-mickey-mouse-fishing-set-mickey-mouse-toy-playset/ppr5008232656 read 11-25 ~1:20 AM (jcpenney.com search by name): $19.99 (was $40). Later link ~1:40 AM.
  ["https://mavely.app.link/fd1RVunGl8b", 19.99, "https://sc-images.jcpenney.com/JCPenney/DP0802202211033966M", "Disney Mickey Mouse Fishing Set", "Disney", "store-jcpenney", "game", 10.5, "A Mickey Mouse fishing game."],
  // JCPenney #19: merry-merry-bingo-table-game/ppr5008739336 read 11-25 ~1:20 AM (jcpenney.com search by name): $24.99 (was $50). Later link ~1:40 AM.
  ["https://mavely.app.link/repxKInGl8b", 24.99, "https://sc-images.jcpenney.com/JCPenney/DP0624202609055756M", "Merry Merry Bingo Table Game", "", "store-jcpenney", "game", 10.5, "Christmas bingo for the whole family."],
  // JCPenney #20: sharper-image-sharper-image-toys-robot/ppr5008807339 read 11-25 ~1:20 AM (jcpenney.com search by name): $49.99 (was $90). Later link ~1:40 AM.
  ["https://mavely.app.link/Cx8yzTnGl8b", 49.99, "https://sc-images.jcpenney.com/JCPenney/DP73228802-20260924053918M", "Sharper Image Remote Control Robots, 2-Pack", "Sharper Image", "store-jcpenney", "rc-toy", 10.5, "Two remote-control robots to battle."],
  // JCPenney #21: banzai-kids-inflatable-mega-boxing-gloves/ppr5007752327 read 11-25 ~1:20 AM (jcpenney.com search by name): $14.99. Later link ~1:40 AM.
  ["https://mavely.app.link/wY4lB4nGl8b", 14.99, "https://sc-images.jcpenney.com/JCPenney/DP0201202407105949M", "Banzai Kids Inflatable Mega Boxing Gloves", "Banzai", "store-jcpenney", "sports", 10.5, "Giant inflatable boxing gloves for silly matches."],
  // JCPenney #22: retro-arcade-desktop-foosball-game/ppr5008738139 read 11-25 ~1:20 AM (jcpenney.com search by name): $19.99 (was $50). Later link ~1:40 AM.
  ["https://mavely.app.link/fnOhMEpGl8b", 19.99, "https://sc-images.jcpenney.com/JCPenney/DP0624202609032785M", "Retro Arcade Desktop Foosball Game", "Retro Arcade", "store-jcpenney", "game", 10.5, "A tabletop foosball game."],
  // JCPenney #23: cra-z-art-grinch-slime-bucket-art-set/ppr5008809633 read 11-25 ~1:20 AM (jcpenney.com search by name): $7.99 (was $12). Later link ~1:40 AM.
  ["https://mavely.app.link/F3147OpGl8b", 7.99, "https://sc-images.jcpenney.com/JCPenney/DP75669144-20261102094620M", "Cra-Z-Art Grinch Slime Bucket", "Cra-Z-Art", "store-jcpenney", "slime", 10.5, "A Grinch slime-making bucket."],
  // JCPenney #24: gbruno-baby-learning-tablet-educational-mini-pads-toys-touch-learn-toddler-tablet-for-abc-numbers-words-blue/ppm6100132572 read 11-25 ~1:20 AM (jcpenney.com search by name): $22.99 (was $28.99). Later link ~1:40 AM.
  ["https://mavely.app.link/zDsVGZpGl8b", 22.99, "https://mktpl-images.jcpenney.com/SOURCE/3fc5737d2a014907964de813080afb37", "GBruno Toddler Learning Tablet", "GBruno", "store-jcpenney", "learning-toy", 10.5, "A toddler tablet for letters, numbers and words."],
  // JCPenney #28: discovery-kids-magnetic-tiles-set-with-12-triangles-and-12-squares-24-pieces/ppr5007920359 read 11-25 ~1:20 AM (jcpenney.com search by name): $24.99 (was $40). Later link ~1:40 AM.
  ["https://mavely.app.link/ZL7PwlrGl8b", 24.99, "https://sc-images.jcpenney.com/JCPenney/DP1008202007111712M", "Discovery Kids Magnetic Tiles, 24 Pieces with Triangles", "Discovery", "store-jcpenney", "building-set", 10.5, "Magnetic tiles with triangles and squares."],
  // JCPenney #30: supreme-silent-sports-basketball/ppr5008575837 read 11-25 ~1:20 AM (jcpenney.com search by name): $19.99 (was $40). Later link ~1:40 AM.
  ["https://mavely.app.link/YY7h4vrGl8b", 19.99, "https://sc-images.jcpenney.com/JCPenney/DP0730202507115886M", "Supreme Silent Sports Basketball", "Supreme", "store-jcpenney", "sports", 10.5, "A soft, quiet basketball for indoor play."],
  // JCPenney #34: discovery-mindblown-discovery-discovery-toy/ppr5008807322 read 11-25 ~1:20 AM (jcpenney.com search by name): $39.99 (was $75). Later link ~1:40 AM.
  ["https://mavely.app.link/4u6AoErGl8b", 39.99, "https://sc-images.jcpenney.com/JCPenney/DP73198890-20260924043646M", "Discovery Mindblown DIY Model Hybrid Engine Kit", "Discovery", "store-jcpenney", "stem-kit", 10.5, "A see-through engine model to build."],
  // JCPenney #42: discovery-mindblown-interactive-toy/ppr5008807325 read 11-25 ~1:20 AM (jcpenney.com search by name): $24.99 (was $50). Later link ~1:40 AM.
  ["https://mavely.app.link/kn5OcRrGl8b", 24.99, "https://sc-images.jcpenney.com/JCPenney/DP73206521-20260924045155M", "Discovery Mindblown DIY Arm Blaster", "Discovery", "store-jcpenney", "stem-kit", 10.5, "A build-it-yourself arm blaster."],
];
/** For Her. */
export const HER_STEALS_1124_ROWS = [
  // S7 Macy's ("ONLY $10, $29 value", a gift-set value; offer ends Dec 6), read on macys.com 2:35 AM, Add to Bag active.
  // S21 Target (reg. $40, through Nov 28; Frost and Rose Quartz in stock, the photo is Target's lead color). Store check 11-24 ~3:10 AM: stanley1913.com sells the same
  // 30 oz H2.0 FlowState at $45 (its only $24 one is a July-4th fireworks print), so Target's $20 at ShopMy 4% wins.
  ["https://go.shopmy.us/p-110125767", 20, "https://target.scene7.com/is/image/Target/GUEST_3fa007f1-e01f-45f0-b417-2596ef872a93", "Stanley Quencher H2.0 FlowState Tumbler, 30 oz", "Stanley", "store-target", "tumbler", 4, "A Stanley tumbler that keeps drinks cold all day."],
  ["https://go.shopmy.us/p-110122551", 10, "https://slimages.macysassets.com/is/image/MCY/products/7/optimized/39005037_fpx.tif", "Clinique 2-Piece Merry Minis Gift Set", "Clinique", "store-macys", "makeup", 16, "A mini Black Honey lipstick and mascara, gift-boxed."],
  // Walmart Creator links made 11-24 ~3:05 AM (creator.walmart.com; Black Friday elevated rate for apparel and shoes 15%,
  // where Later's Walmart rate for apparel is its 0% baseline); listing re-read ~3:10 AM, sold by Walmart, in stock.
  // S35 (reg. $115, Black Friday deal through Nov 29), sizes S-3X.
  ["https://walmrt.us/49fAVtS", 24.99, "https://i5.walmartimages.com/seo/Big-Chill-Women-s-and-Women-s-Plus-Wide-Quilted-Puffer-Coat-with-Faux-Fur-Trim-Hood-Sizes-S-3X_415ec42d-a42a-49a7-aa5a-26b95859a395.ae8dc7cc90376f7855971e13df5d658f.jpeg", "Big Chill Women's Quilted Puffer Coat with Faux Fur Hood", "Big Chill", "store-walmart", "jacket", 15, "A warm puffer coat for cold snaps, in sizes S to 3X."],
  // S49 / S50: lululemon via ShopMy 12% (links ~4:16 AM); read on shop.lululemon.com 11-24 ~4:15 AM: the keychain $9 (reg. $18,
  // Black/Gold, final sale, ships) and the Logo Bead Hair Ties 3 Pack $9 (reg. $20, final sale, ships).
  ["https://go.shopmy.us/p-110137387", 9, "https://images.lululemon.com/is/image/lululemon/LU9CCJS_3385_1", "lululemon Mini Everywhere Belt Bag Keychain", "lululemon", "store-lululemon", "accessory", 12, "A tiny belt bag keychain for her keys."],
  ["https://go.shopmy.us/p-110137457", 9, "https://images.lululemon.com/is/image/lululemon/LW9FNLS_075332_1", "lululemon Logo Bead Hair Ties, 3 Pack", "lululemon", "store-lululemon", "hair", 12, "Three logo-bead hair ties that double as bracelets."],
  // S54: Kate Spade Outlet $29 (79% off a $139 comparable value; an extra 10% comes off in the cart, so $26.10), Black, read
  // ~4:17 AM; ShopMy pays 16% there (quick link ~4:17 AM). Store key: Kate Spade Outlet folds into the Kate Spade New York store page.
  ["https://go.shopmy.us/p-110137572", 29, "https://katespade.scene7.com/is/image/KateSpade/KE574_001", "Kate Spade Lucy Wristlet, Black", "Kate Spade", "store-kate-spade-new-york", "wallet", 16, "A pebbled leather wristlet for phone and cards."],
  // S37: JCPenney via Later 10.5% (bf-page link 11-24 ~4:09 AM); read on jcpenney.com 11-24 ~5:17 AM: $7.99 (reg. $30,
  // Black Friday deal), Trees, 19 left, ships. S43: Kohl's via Later 10.5% (link ~5:19 AM); read on kohls.com ~5:18 AM:
  // $1.99 (reg. $6; $1.59 with TAKE20 through Nov 28), Santa, best seller.
  ["https://mavely.app.link/wb8BXrxck8b", 7.99, "https://sc-images.jcpenney.com/JCPenney/DP69992719-20260803190503M", "North Pole Trading Co. Holiday Velvet Plush Throw, Trees", "North Pole Trading Co.", "store-jcpenney", "throw-blanket", 10.5, "A soft holiday throw for movie nights on the couch."],
  ["https://mavely.app.link/vRv8iAthk8b", 1.99, "https://media.kohlsimg.com/is/image/kohls/3840392_Santa", "SHINE Women's Holiday Crew Socks, Santa", "SHINE", "store-kohls", "socks", 10.5, "Festive Santa socks for her stocking."],
  // S42: JCPenney via Later 10.5% (bf-page link 11-24 ~5:35 AM); read on jcpenney.com 11-24 ~8:33 AM: $29.99 (reg. $150,
  // Black Friday deal), Gray Fairisle (the page's default color, the one with a product-only photo), 17 left, ships.
  ["https://mavely.app.link/n2955rKik8b", 29.99, "https://sc-images.jcpenney.com/JCPenney/DP0527202607083329M", "Beautyrest Ultrasoft Plush Heated Throw, Gray Fairisle", "Beautyrest", "store-jcpenney", "throw-blanket", 10.5, "A plush heated throw for cold nights on the couch."],
];
/**
 * HER OWNER PICK 11-25 (owner via the lead, 2026-11-25 ~4:15 PM): the Magic Puzzle Company "The Festive Factory" 1000-piece
 * puzzle, our first Later (Mavely) sale, through her own Later link (never opened or fetched by us). Target's own listing,
 * TCIN 1011193016 (target.com/p/-/A-1011193016, sold by Target), read through Target's product API 2026-11-25 ~3:42 PM CT
 * for the digital store and both Lafayette stores: regular $19.99 (the price the page shows; $9.99 only in the cart),
 * ships out of stock, pickup in stock at one Lafayette store. Lead: show $19.99 (the sale's $44.98 was the order total).
 * Later's Target rate for Toys is 2.8%. Photo: Target's lead photo, cut out (Apple Vision).
 */
export const HER_OWNER_1125_ROWS = [
  ["https://mavely.app.link/Etc8x0jLk8b", 19.99, "https://target.scene7.com/is/image/Target/GUEST_111f8fbc-5d93-4ed4-85e5-34eb057e8c00", "Magic Puzzle Company The Festive Factory 1000-Piece Puzzle", "Magic Puzzle Company", "store-target", "puzzle", 2.8, "A Santa's-workshop jigsaw packed with tiny details to find."],
];
/**
 * THE 11-26 ADDS (owner, Thu 2026-11-26): her picks from a "Gift Guide For Little Boys" ad (on Kids) and the US best-seller
 * adds (~/.lh-shots/us-best-sellers-adds-1126-handoff.md). Each row was priced 2026-11-26 (priceAt PRICE_AT_1126): Walmart
 * rows from Walmart Creator search (price, rating and photo; walmart.com itself showed a bot check, not passed), other stores
 * from their own product pages. Rows: [link, price, store photo, name, brand, store, type, commission %, line].
 */
export const PRICE_AT_1126 = "2026-11-26";
/** Kids, 11-26. */
export const KIDS_OWNER_1126_ROWS = [
];
/** Her, 11-26. */
export const HER_OWNER_1126_ROWS = [
];
/** Him, 11-26. */
export const HIM_OWNER_1126_ROWS = [
];
/** Every pick priced 2026-11-26: the rows above plus Amazon re-reads that day (AirPods Pro 3 on Him, $149). */
export const PRICED_1126_HREFS = new Set([...KIDS_OWNER_1126_ROWS, ...HER_OWNER_1126_ROWS, ...HIM_OWNER_1126_ROWS].map((r) => r[0]).concat(["https://www.amazon.com/dp/B0FQFB8FMG?tag=louisianahelpr-20"]));
/** For Him. */
export const HIM_STEALS_1124_ROWS = [
  // S1 Macy's exclusive (reg. $50, 80% off), read on macys.com 2:11 AM, Add to Bag active.
  ["https://go.shopmy.us/p-110122396", 9.99, "https://slimages.macysassets.com/is/image/MCY/products/4/optimized/38043904_fpx.tif", "The Cellar Morgan Ceramic Plaid Mugs, Set of 2", "The Cellar", "store-macys", "mug", 16, "Two plaid mugs for cocoa by the tree."],
  // Walmart Creator links made 11-24 ~3:05 AM (creator.walmart.com; Black Friday elevated rate for apparel and shoes 15%,
  // where Later's Walmart rate for apparel is its 0% baseline); listing re-read ~3:10 AM, sold by Walmart, in stock.
  // S33 (reg. $24.98, through Nov 29).
  ["https://walmrt.us/3XKh0AM", 10, "https://i5.walmartimages.com/seo/The-Grinch-12-Days-of-Socks-Combo_e33cd6e5-1e35-4769-9490-059af8503126.9e5e89e3e8c8b7df6251e0b6d39896b6.jpeg", "The Grinch Men's 12 Days of Socks", "Dr. Seuss", "store-walmart", "socks", 15, "Twelve pairs of Grinch socks, one for each day of Christmas."],
  // Macy's steals (links made in her ShopMy at Macy's 16%, 11-24 ~2:00 AM). Prices are the Macy's Black Friday prices read
  // ~1:30 AM (bf-store-sales-1124.md); macys.com has refused page reads since ~2:11 AM (Access Denied in Chrome and curl), so
  // each photo is Macy's own product photo as mirrored on a Macy's price-tracker page (beyondstyle.us, id macys_<ID>), and
  // each age is the maker's (Jakks lists Bowser 3+, Mattel lists UNO 7+).
  // S16 (reg. $50), Macy's ID 20376480. Store check 11-24 ~3:55 AM: Hibbett $50, Nordstrom Rack $39.97+, adidas.com's
  // Essentials hoodie $35 (adidas ShopMy 12%); Macy's $25 at 16% wins on price and rate.
  ["https://go.shopmy.us/p-110122844", 25, "https://5thave-img-cdn.santasmartnetwork.com/pf/96c05f84-372b-3d82-afad-8d13a22ed3a9.jpg", "adidas Men's Essentials Feel Cozy Fleece Hoodie", "adidas", "store-macys", "sweatshirt", 16, "A soft fleece hoodie for chilly mornings."],
  // S52: ShopMy crocs.com 10% (link made 11-24 ~4:08 AM); crocs.com $25 (reg. $49.99, read ~3:12 AM, in stock, Black photo).
  // Zappos and DSW (ShopMy 12%) list the Cozzzy at full price, so crocs.com's $25 wins.
  ["https://go.shopmy.us/p-110135239", 25, "https://media.crocs.com/images/t_standard/products/209386_001_ALT100/crocs", "Crocs Classic Cozzzy Slipper", "Crocs", "store-crocs", "slippers", 10, "Fuzzy-lined Crocs slippers for cold floors."],
  // S36: Kohl's $99.99 (reg. $199.99, plus $15 Kohl's Cash; read on kohls.com 11-24 ~4:12 AM) through Later (link by bf-page
  // ~3:45 AM; Kohl's 10.5%, Later did not show an electronics rate). Walmart's $88.97 listing is gone (only open-box or
  // marketplace sellers) and Walmart pays 0% on Beats; Target pays ShopMy 4%.
  ["https://mavely.app.link/y7KIsnyak8b", 99.99, "https://media.kohlsimg.com/is/image/kohls/7173442_Black", "Beats Solo 4 On-Ear Wireless Headphones, Matte Black", "Beats", "store-kohls", "headphones", 10.5, "Wireless Beats headphones with 50 hours of battery."],
];

/** Store photos for the steals, cut out (Apple Vision) into public/gift-guides/cutouts: photo URL -> file. */
export const STEALS_CUTOUTS_1124 = [
  ["https://target.scene7.com/is/image/Target/GUEST_111f8fbc-5d93-4ed4-85e5-34eb057e8c00", "target-magic-puzzle-festive-factory-1000-111f8f.webp"],
  ["https://mktpl-images.jcpenney.com/SOURCE/833aadb99d5b4febb801a50dc07b9f62", "costway-6v-kids-electric-quad-atv-ride-on-jcpenney-aa68f2.webp"],
  ["https://mktpl-images.jcpenney.com/SOURCE/48cf8aa374884218b899e9f1277a24d4", "costway-kids-pedal-go-kart-jcpenney-f21ed3.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0622202607143941M", "learning-resources-a-to-z-mini-foods-jcpenney-7f4c4a.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0624202609034881M", "snowball-headband-hoop-game-set-of-2-jcpenney-2b10bd.webp"],
  ["https://mktpl-images.jcpenney.com/SOURCE/0b6728a3e5454162bb35976503bb33ed", "quokka-60-piece-kids-jigsaw-puzzle-jcpenney-b6c0e0.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0929202509090126M", "discovery-mindblown-bionic-hand-diy-hydraulic-kit-jcpenney-de14c8.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP73214776-20260924050938M", "discovery-kids-spy-goggles-jcpenney-2a3e71.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP73027399-20260923025700M", "disney-mickey-mouse-clubhouse-grill-set-jcpenney-1d9b24.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP72784624-20260918030400M", "discovery-kids-11-piece-light-designer-drawing-kit-jcpenney-fe63c0.webp"],
  ["https://mktpl-images.jcpenney.com/SOURCE/e147e73cc07c4ebd8a0a50c7773775c3", "4-in-1-kids-art-easel-with-bookshelf-jcpenney-a227b5.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0909202509125637M", "disney-minnie-mouse-9-piece-shopping-playset-jcpenney-de4e92.webp"],
  ["https://mktpl-images.jcpenney.com/SOURCE/01327d718e384708b418413cffc8100f", "quokka-toddler-scavenger-hunt-cards-jcpenney-33b5bb.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0710201717120536M", "discovery-kids-24-piece-magnetic-tiles-jcpenney-c2c58c.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0614202411032024M", "disney-talking-minnie-mouse-clubhouse-plush-jcpenney-3065dc.webp"],
  ["https://mktpl-images.jcpenney.com/SOURCE/b1c342a8849f4e04a959c45a6c65a681", "sperric-splash-and-catch-magnetic-fishing-bath-toy-jcpenney-6b8e69.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0624202609030169M", "retro-arcade-desktop-pool-table-game-jcpenney-6633c1.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0622202607144150M", "learning-resources-lock-and-key-clubhouse-jcpenney-39bac8.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0624202609031843M", "retro-arcade-duck-shooting-gallery-game-jcpenney-e24e85.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/5f7979b8-4f04-11e8-b3d8-35fb160e5921", "kiddieland-noahs-ark-play-set-jcpenney-66ad8d.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP73197925-20260924043449M", "discovery-mindblown-planetarium-projector-jcpenney-4708da.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0310202309015796M", "sharper-image-flip-stunt-rally-rc-car-jcpenney-c6ce0b.webp"],
  ["https://mktpl-images.jcpenney.com/SOURCE/fb1a47cbf3934e45a2d1894bb075b80b", "quokka-kids-sewing-craft-kit-jcpenney-4fe0a2.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP1120202409072907M", "discovery-kids-bright-doodles-lcd-art-tablet-jcpenney-ebf2e6.webp"],
  ["https://target.scene7.com/is/image/Target/GUEST_aa607c4c-29d7-4ce2-af5b-587ebde268f0", "paw-patrol-my-size-lookout-tower-vehicle-playset-target-5cef1e.webp"],
  ["https://i5.walmartimages.com/asr/2ebd2ffc-3fe0-41ea-a2a7-89c10d55fa40.ad137f7373e995ff3ebad5439edbb758.jpeg", "spongebob-toddler-pajama-set-12m-5t-walmart-fe120b.webp"],
  ["https://i5.walmartimages.com/asr/ffaee3a0-afdb-48b2-8b58-927bdd968029.49055b2639cae3288f4a732efc800e92.jpeg", "disney-princess-toddler-pajama-set-pink-12m-5t-walmart-4ee2ef.webp"],
  ["https://i5.walmartimages.com/asr/3deb60dd-e31f-450a-be92-f0792f7bad41.c5785be7e2e2c296d6f278f59fb8ea2a.jpeg", "grinch-toddler-pajama-set-red-12m-5t-walmart-53c862.webp"],
  ["https://i5.walmartimages.com/asr/4ee60411-45a7-4672-8fd3-34eb543cefe6.18d5db898fa8312d61f343d68ca1b677.jpeg", "toy-story-toddler-coat-top-pajama-set-12m-5t-walmart-dbdcba.webp"],
  ["https://i5.walmartimages.com/asr/3df14a41-6925-4f54-984d-07e1c6c1e9df.ead35d5940ee90daab4d22be0adfce76.jpeg", "paw-patrol-toddler-coat-top-pajama-set-12m-5t-walmart-ec0179.webp"],
  ["https://i5.walmartimages.com/asr/fafd9f5f-77d4-4fab-9c7f-c9f67132c40c.9d13039c6fb94a9cfd84a453569ea44e.jpeg", "barbie-toddler-coat-top-pajama-set-2t-5t-walmart-a1731a.webp"],
  ["https://i5.walmartimages.com/asr/5e1bfb70-f352-47e1-9b2b-6f915d85fb89.e0c093ce2ebeb9831ed5adbf810fd03f.jpeg", "hello-kitty-toddler-coat-top-pajama-set-12m-5t-walmart-08e1f1.webp"],
  ["https://i5.walmartimages.com/asr/b17dc25a-2a4c-46af-9edc-dc722f18288e.b6fb2b224dcfeb438d711c68f3567732.jpeg", "strawberry-shortcake-toddler-coat-top-pajama-set-12m-5t-walmart-5b6611.webp"],
  ["https://i5.walmartimages.com/asr/b06e3d84-ac3f-45d5-8f84-a2251192fcbb.4669a86c3ab63577707a024650571205.jpeg", "mickey-mouse-toddler-coat-top-pajama-set-12m-5t-walmart-3e7fb7.webp"],
  ["https://i5.walmartimages.com/asr/c12c540a-ce7d-4d26-83f5-eed6d2cd0f60.f462ec92b5ec2f7632263ddf7b60f54c.jpeg", "minnie-mouse-toddler-coat-top-pajama-set-12m-5t-walmart-b4f160.webp"],
  ["https://i5.walmartimages.com/asr/cc8c8286-6c3e-4aee-884a-e6b1e6c1fbb5.83c3fedf566ba8b545d337239b6cb5da.jpeg", "tonka-toddler-coat-top-pajama-set-12m-5t-walmart-5fb01e.webp"],
  ["https://i5.walmartimages.com/asr/9576c00f-8eed-40f9-8cca-e740662c1803.9298c12850a5e22e21827a2031705bc6.jpeg", "disney-princess-toddler-coat-top-pajama-set-12m-5t-walmart-179e3d.webp"],
  ["https://i5.walmartimages.com/asr/047dce25-f472-4a5c-a459-c4ebe35dbb5c.3cdb476e191f4e081eb2963f76110e32.jpeg", "barbie-toddler-coat-top-pajama-set-pink-12m-5t-walmart-e2eb1b.webp"],
  ["https://i5.walmartimages.com/asr/55ef313b-6669-4a28-abfb-03734a50a3be.f56880b9f3f02e3f1a081f19b7e1b450.jpeg", "disney-princess-kids-pajama-set-4-16-walmart-bc6178.webp"],
  ["https://i5.walmartimages.com/asr/6dd738f3-1d78-4e91-a90e-e221e67d8948.1791e22c86efa528750ef835afce7d11.jpeg", "super-mario-kids-pajama-set-purple-4-16-walmart-61ea14.webp"],
  ["https://i5.walmartimages.com/asr/360e68a9-b50a-4c3a-9a17-15ccef70434c.82ae25a0f268c1e4b3429bb0ba45ce39.jpeg", "super-mario-kids-pajama-set-blue-4-16-walmart-aff255.webp"],
  ["https://i5.walmartimages.com/asr/894ad2aa-37c1-4b5a-a10e-9cbaa60dedee.90b20f4cfa81ca5485cb0d5e00cfd9db.jpeg", "hello-kitty-kids-pajama-set-purple-4-16-walmart-d9701d.webp"],
  ["https://i5.walmartimages.com/asr/6f575ffd-8900-46d5-83c3-617fedfc7694.e9da7557e5da15986819c85a1d805862.jpeg", "hello-kitty-kids-pajama-set-red-4-16-walmart-6679de.webp"],
  ["https://i5.walmartimages.com/asr/fae8f15b-58e1-477d-9b8a-d5b34284060e.08c596f66fa8a90f174ca7001b011cf3.jpeg", "frozen-kids-pajama-set-4-16-walmart-ffe9a0.webp"],
  ["https://i5.walmartimages.com/asr/4cc12905-68a7-4ffd-953e-3c78731435d4.4f198f76f3f81f3d56bb12dcfc2619bd.jpeg", "lilo-stitch-kids-pajama-set-blue-4-16-walmart-9e324d.webp"],
  ["https://i5.walmartimages.com/asr/e8dc85b2-908a-4207-8f3a-6fcf568d669e.3d10978fd4ee62f48b9c47d9df03d161.jpeg", "lilo-stitch-kids-pajama-set-pink-4-16-walmart-a5ba23.webp"],
  ["https://i5.walmartimages.com/asr/6bba4e57-5147-4ec1-bac0-813078a168d7.ec95580470e8da93de03df051a73f5a3.jpeg", "jurassic-world-kids-pajama-set-4-16-walmart-c860a5.webp"],
  ["https://i5.walmartimages.com/asr/2754ebbd-be3d-43b3-808f-597f462ab6b3.5909ddb8283bac9b04a357fcd43deeb8.jpeg", "sonic-kids-pajama-set-4-16-walmart-214000.webp"],
  ["https://i5.walmartimages.com/asr/22b867fd-a3d6-4117-885c-ac0c63191dee.69c2407749596105c702cf769972ca76.jpeg", "teenage-mutant-ninja-turtles-kids-pajama-set-4-16-walmart-3f122a.webp"],
  ["https://i5.walmartimages.com/asr/871fd944-6ae5-4a57-be62-c6cf606869b1.528d06fbe5af70830d8905304f283833.jpeg", "barbie-kids-pajama-set-4-16-walmart-823678.webp"],
  ["https://i5.walmartimages.com/asr/3b3f91b7-5af1-4149-827f-167715111605.e1966f8953a9c13ead95d703a476b000.jpeg", "toy-story-kids-pajama-set-4-16-walmart-75fb38.webp"],
  ["https://i5.walmartimages.com/asr/4922d1a2-ccf4-45a5-9e2e-21a8467c4fe1.1650015e1358693d870dac478458282f.jpeg", "grinch-kids-pajama-set-pink-4-16-walmart-880abf.webp"],
  ["https://i5.walmartimages.com/asr/f5d3d7cb-4f0e-404e-8bbd-7cf47633ba77.5c780257a5748f0ca073e1c69d90217d.jpeg", "care-bears-toddler-one-piece-sleeper-2t-5t-walmart-5618d5.webp"],
  ["https://i5.walmartimages.com/asr/3efcd901-4b2f-4510-b78f-5ab3388c239d.451fa83be286167d9075ab0ead747a9f.jpeg", "minnie-mouse-toddler-one-piece-sleeper-2t-5t-walmart-6ae94f.webp"],
  ["https://i5.walmartimages.com/asr/63a7a91c-78c1-4fd6-b62c-7a62c451ec42.12c899427a9c8891693f96daf6537d6c.jpeg", "disney-princess-toddler-one-piece-sleeper-2t-5t-walmart-3e0e2a.webp"],
  ["https://i5.walmartimages.com/asr/e48d05c0-6d9b-4819-a050-a9576ab34c3b.fc53795d6005913ecdfaf33f1e189e0b.jpeg", "grinch-toddler-fleece-robe-12m-5t-walmart-6677bc.webp"],
  ["https://i5.walmartimages.com/asr/28ede100-bd45-40d7-a7d7-47646c097eac.1bddfd91848c45ea91adab82b152caaa.jpeg", "strawberry-shortcake-toddler-fleece-robe-12m-5t-walmart-77263c.webp"],
  ["https://i5.walmartimages.com/asr/d5e48c94-eb64-44e9-9ce0-11ca27aaf1ad.1cd80398f966aed0905dd0ed2d190af4.jpeg", "minnie-mouse-toddler-fleece-robe-12m-5t-walmart-006018.webp"],
  ["https://i5.walmartimages.com/asr/8fdaacd3-1710-4f71-8514-fc081b812912.808255a2df42cc2c02012ee8b7b060a0.jpeg", "minnie-mouse-toddler-patriotic-tee-12m-5t-walmart-4f6bb0.webp"],
  ["https://i5.walmartimages.com/asr/a4819d31-0543-446d-b4a4-562f291e43a8.ecf712cb861fd37be72c5f9659654555.jpeg", "toy-story-toddler-patriotic-tee-12m-5t-walmart-1d57c4.webp"],
  ["https://i5.walmartimages.com/asr/2ac162af-6c13-45e1-b85a-734c6cae7e70.0e3603d3c0c859ef8469cbe34fc33dd2.jpeg", "stitch-toddler-patriotic-tee-12m-5t-walmart-edca45.webp"],
  ["https://i5.walmartimages.com/asr/1308c9ef-0e89-4578-a9b8-24f039ec5f98.ef4339f86c2a22cc9443af30d4a63296.jpeg", "mickey-mouse-toddler-patriotic-tee-12m-5t-walmart-45af7a.webp"],
  ["https://i5.walmartimages.com/asr/c246c850-105b-42c7-b6c7-1c4d4ee908d9.93adff5b41e98fa699a0ba4b1e29d1b5.jpeg", "hello-kitty-toddler-patriotic-tee-12m-5t-walmart-2541ff.webp"],
  ["https://i5.walmartimages.com/asr/d0773dd6-c747-4f9d-bbde-339c52ff3532.644388db831d18ffd32469c0a51024f9.jpeg", "hello-kitty-toddler-girls-beanie-and-gloves-set-walmart-2fe1a4.webp"],
  ["https://i5.walmartimages.com/asr/a4c55790-df92-4cdc-b3f9-ca6ba5525081.a511fa68d50ad2ba3f13f6bf5232fcdf.jpeg", "lilo-stitch-toddler-girls-beanie-and-gloves-set-walmart-354404.webp"],
  ["https://i5.walmartimages.com/asr/b512b8c8-a164-434c-941a-46c55006adda.f7d7b1a94dfc67789c5ba9ae98233b02.jpeg", "toy-story-jessie-toddler-girls-beanie-and-gloves-set-walmart-a42715.webp"],
  ["https://i5.walmartimages.com/asr/f6c684e2-142b-4dfa-8942-4f7dab88025b.41a792897967012f1485352504c441ac.jpeg", "toy-story-toddler-girls-beanie-and-gloves-set-walmart-e2c6f5.webp"],
  ["https://i5.walmartimages.com/asr/ef7d50b4-9a5c-4f2b-807c-579889bc4cdc.bb33e009f98fc8f410ea8a125eb931fb.jpeg", "paw-patrol-toddler-pajama-set-12m-5t-walmart-7232cb.webp"],
  ["https://i5.walmartimages.com/asr/f403338a-c23f-474d-b079-4d6af1886e1e.0ae877f0943aacdd60b5e3bf80e2a855.jpeg", "ms-rachel-baby-girls-tee-and-shorts-set-0-9m-walmart-579bcb.webp"],
  ["https://i5.walmartimages.com/asr/f1e5ed5c-9c8c-4039-9601-53eb93bc24d7.a3f4a70fcc79512f97fe3036c051d341.jpeg", "disney-eeyore-mini-bean-bag-plush-walmart-ae08ed.webp"],
  ["https://i5.walmartimages.com/seo/Elf-on-the-Shelf-The-Elf-on-the-Shelf-Advent-Calendar-Story-Activity-Collection-Series-10-Hardcover-9780063327351_c56acf0d-01e7-4f68-a407-a8651906af07.f5971afc5371def279f4c5461e01a47c.jpeg", "elf-on-the-shelf-advent-calendar-story-activity-walmart-c7043f.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP69992719-20260803190503M", "jcpenney-holiday-velvet-plush-throw-trees-folded-9d76e9.webp"],
  ["https://media.kohlsimg.com/is/image/kohls/3840392_Santa", "kohls-shine-holiday-crew-socks-santa-6d3af3.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0527202607083329M", "jcpenney-beautyrest-heated-throw-gray-fairisle-b0cc71.webp"],
  ["https://target.scene7.com/is/image/Target/GUEST_4d87f108-5489-4494-8fa1-e217b2f5b2ec", "lego-sunflowers-40524-target-1c9b32.webp"],
  ["https://target.scene7.com/is/image/Target/GUEST_17112714-0b0d-42cf-8155-764b003d717c", "monster-jam-smash-bash-playset-target-1e137b.webp"],
  ["https://target.scene7.com/is/image/Target/GUEST_3c239da7-60a0-4778-9907-30c1d39c75e1", "hot-wheels-mutant-chaos-truck-slime-target-cca8dc.webp"],
  ["https://target.scene7.com/is/image/Target/GUEST_c83ac03c-e583-4186-9d54-8f45accdb680", "hot-wheels-mutant-chaos-loop-challenge-target-93d8dd.webp"],
  ["https://target.scene7.com/is/image/Target/GUEST_df42bc4c-6b91-47d1-8f17-b5927a32d819", "frigidaire-6-can-mini-fridge-black-target-2fc526.webp"],
  ["https://target.scene7.com/is/image/Target/GUEST_9bb0bfa5-6795-4fee-b757-b4e42550d250", "lego-minecraft-woodland-mansion-21272-target-158553.webp"],
  ["https://target.scene7.com/is/image/Target/GUEST_31e99209-6fc7-4143-814e-b3c379a26196", "monster-jam-grave-digger-rc-target-4eba21.webp"],
  ["https://i5.walmartimages.com/seo/Christmas-Dumpling-Advent-Calendar-2026-24-Day-Countdown-for-Kids-Adults-Christmas-Gifts_314174ac-f2be-4671-9298-cb45b155a858.71d0d4271709de6df7d649374e98a4c3.jpeg", "christmas-dumpling-advent-calendar-walmart-5562ff.webp"],
  ["https://i5.walmartimages.com/seo/Cute-Farm-Animal-Dumpling-Advent-Calendar-24-Days-Christmas-Countdown-Ornament-Gift-for-Kids-Teens-Holiday-Tree-Decor_26079486-b2a9-431b-927a-7b2e8d268d0d.7c2740f8708f1d701d8f7d5534c608be.jpeg", "farm-animal-dumpling-advent-calendar-walmart-727c1f.webp"],
  ["https://i5.walmartimages.com/seo/UUGEE-2024-Christmas-Advent-Calendar-Boys-Kids-24-Days-Countdown-Calendar-Pull-Back-Cars-Toys-Set-24-Vehicles-Xmas-Surprise-Gifts-1-2-3-Years-Old-Tod_492e28fe-d787-4a63-9a78-0f73457b08bf.2903e563bf3a841cad4744e24bc94846.jpeg", "uugee-advent-calendar-pull-back-cars-walmart-e48a48.webp"],
  ["https://i5.walmartimages.com/seo/Monster-Jam-1-64-Truck-Collection-4-Pack-with-3-Bonus-Mini-Jams-Vehicles-for-Kids-3-and-up_5e70e26e-62fc-4d27-ac48-d6c0bbeb0a2e.8f9818984e305aa62898183ec2d08edb.jpeg", "monster-jam-164-4-pack-mini-jams-walmart-c6e25c.webp"],
  ["https://slimages.macysassets.com/is/image/MCY/products/7/optimized/39005037_fpx.tif", "clinique-merry-minis-macys-f8ee8e.webp"],
  ["https://target.scene7.com/is/image/Target/GUEST_3fa007f1-e01f-45f0-b417-2596ef872a93", "stanley-quencher-30oz-frost-target-827cc1.webp"],
  ["https://slimages.macysassets.com/is/image/MCY/products/4/optimized/38043904_fpx.tif", "cellar-morgan-plaid-mugs-macys-6d5a78.webp"],
  ["https://i5.walmartimages.com/seo/Big-Chill-Women-s-and-Women-s-Plus-Wide-Quilted-Puffer-Coat-with-Faux-Fur-Trim-Hood-Sizes-S-3X_415ec42d-a42a-49a7-aa5a-26b95859a395.ae8dc7cc90376f7855971e13df5d658f.jpeg", "big-chill-puffer-coat-walmart-7bb294.webp"],
  ["https://i5.walmartimages.com/seo/The-Grinch-12-Days-of-Socks-Combo_e33cd6e5-1e35-4769-9490-059af8503126.9e5e89e3e8c8b7df6251e0b6d39896b6.jpeg", "grinch-12-days-of-socks-walmart-87e74c.webp"],
  ["https://i5.walmartimages.com/seo/KPop-Demon-Hunters-Girls-Slipper_4a177782-fa79-4508-9ca0-3a1196057428.81560971bb841793f8ca6e21114a80ff.jpeg", "kpop-demon-hunters-girls-slippers-walmart-dd2d42.webp"],
  ["https://i5.walmartimages.com/seo/MONSTER-JAM-GRAVE-DI_def5b20b-fbde-4411-b535-8bf50039e548.c2076dadbc2472328eabc7b3f1a55779.jpeg", "monster-jam-grave-digger-toddler-slippers-walmart-f8f94b.webp"],
  ["https://i5.walmartimages.com/seo/Character-Toddler-Long-Sleeve-Top-and-Pant-Pajama-Set-2-Piece-Sizes-12M-5T_85a8419b-f3f7-4696-a1fb-5ac768017ac8.20bc5657ccf727ebdbdb6c2dde622e53.jpeg", "bluey-toddler-pajama-set-walmart-2c75ab.webp"],
  ["https://media.kohlsimg.com/is/image/kohls/8214073", "monster-jam-supercharge-speedway-kohls-f0045d.webp"],
  ["https://i5.walmartimages.com/seo/Sony-PS5-DualSense-Wireless-Controller-Midnight-Black_2384fbb2-237e-4e16-89bb-f39d20777a0f.a6d2c857ba5ab080f212f44d72baf0f4.png", "ps5-dualsense-midnight-black-walmart-186f7c.webp"],
  ["https://5thave-img-cdn.santasmartnetwork.com/pf/a4439462-c327-3203-a0af-134c8b7e1f9a.jpg", "kuromi-cupcake-plush-macys-bd4aac.webp"],
  ["https://5thave-img-cdn.santasmartnetwork.com/pf/5639cc43-2a59-3a28-8865-53a02bedabf8.jpg", "uno-artiste-vexx-macys-c5446b.webp"],
  ["https://5thave-img-cdn.santasmartnetwork.com/pf/21ce5baf-790f-3743-a60e-6f71d23bd440.jpg", "bowser-battle-playset-macys-7709e0.webp"],
  ["https://5thave-img-cdn.santasmartnetwork.com/pf/1a9b2af2-832b-374b-b7d9-45e706e2a90b.jpg", "starlight-glam-vanity-macys-93527e.webp"],
  ["https://5thave-img-cdn.santasmartnetwork.com/pf/7089d969-7721-3baa-b676-dff0c0b25fe0.jpg", "glam-runway-playset-macys-1afb7a.webp"],
  ["https://5thave-img-cdn.santasmartnetwork.com/pf/978baa26-8b88-3a81-9edc-30ddba307077.jpg", "steve-madden-girls-packable-jacket-macys-1bd659.webp"],
  ["https://5thave-img-cdn.santasmartnetwork.com/pf/96c05f84-372b-3d82-afad-8d13a22ed3a9.jpg", "adidas-feelcozy-hoodie-macys-f5b284.webp"],
  ["https://media.crocs.com/images/t_standard/products/206991_001_ALT140/crocs", "crocs-kids-classic-clog-black-614d9c.webp"],
  ["https://media.crocs.com/images/t_standard/products/209386_001_ALT100/crocs", "crocs-classic-cozzzy-slipper-black-1fe5a2.webp"],
  ["https://media.kohlsimg.com/is/image/kohls/7173442_Black", "beats-solo-4-black-kohls-bcae83.webp"],
  ["https://media.crocs.com/images/t_standard/products/210856_001_ALT100/crocs", "crocs-kids-classic-cozzzy-slipper-black-a68d92.webp"],
  ["https://images.lululemon.com/is/image/lululemon/LU9CCJS_3385_1", "lululemon-mini-belt-bag-keychain-black-5fcdc5.webp"],
  ["https://images.lululemon.com/is/image/lululemon/LW9FNLS_075332_1", "lululemon-bead-hair-ties-9752c6.webp"],
  ["https://katespade.scene7.com/is/image/KateSpade/KE574_001", "kate-spade-lucy-wristlet-black-b22e43.webp"],
  ["https://media.kohlsimg.com/is/image/kohls/4576090_Toy_Story_Retro", "the-big-one-disney-toy-story-oversized-supersoft-plush-throw-kohls-660ad2.webp"],
  ["https://media.kohlsimg.com/is/image/kohls/8577832", "paw-patrol-toddler-boy-4-piece-pajama-set-kohls-6c414d.webp"],
  ["https://media.kohlsimg.com/is/image/kohls/8053525", "fisher-price-little-people-bowsers-airship-and-figure-kohls-e3d844.webp"],
  ["https://media.kohlsimg.com/is/image/kohls/7006887", "matchbox-aircraft-carrier-play-set-with-10-die-cast-planes-kohls-c34731.webp"],
  ["https://media.kohlsimg.com/is/image/kohls/8100049", "matchbox-die-cast-cars-5-pack-kohls-21591d.webp"],
  ["https://mktpl-images.jcpenney.com/SOURCE/cd5db8076eda48e3a2fa581121ec607b", "quokka-30-piece-kids-jigsaw-puzzle-jcpenney-8f1bb3.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0616202607221825M", "what-do-you-meme-color-stack-board-game-jcpenney-e19b2f.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP73212561-20260924050435M", "sharper-image-2-piece-remote-control-cars-jcpenney-14f723.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0909202515062231M", "play-doh-fun-factory-starter-set-jcpenney-5b166f.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP72769952-20260917185741M", "discovery-mindblown-glow-roll-marble-run-jcpenney-569ff0.webp"],
  ["https://mktpl-images.jcpenney.com/SOURCE/2a5aaefd3b2c453eabd88a50129c1fa1", "costway-24v-kids-ride-on-electric-atv-jcpenney-0f6cd0.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0804202511092279M", "disney-minnie-mouse-cell-phone-toy-playset-jcpenney-932d58.webp"],
  ["https://mktpl-images.jcpenney.com/SOURCE/ad42853b83084a22af9829d09d6a0f67", "costway-6v-kids-ride-on-train-with-track-jcpenney-8392de.webp"],
  ["https://mktpl-images.jcpenney.com/SOURCE/41f6994664d94d58919b69efb93e3e96", "jitterygit-glow-in-the-dark-construktor-track-set-194-pieces-jcpenney-0a7d11.webp"],
  ["https://mktpl-images.jcpenney.com/SOURCE/81d79d2f2d3e4ff58e20c381a42fcea0", "costway-wiggle-car-ride-on-with-flashing-wheels-jcpenney-685dfe.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0701202009010173M", "discovery-rc-smoke-breathing-dragon-jcpenney-3797b2.webp"],
  ["https://mktpl-images.jcpenney.com/SOURCE/d52f5b2d3f86448a9a7671d3df19a774", "sugift-adjustable-kids-punching-bag-set-with-gloves-jcpenney-b53139.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0922202317102880M", "disney-fabulous-fashion-minnie-mouse-doll-jcpenney-97d2a7.webp"],
  ["https://mktpl-images.jcpenney.com/SOURCE/62998981d7de4cad8fdd4f4e4f471bf6", "safari-ltd-energy-ball-science-toy-jcpenney-322773.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0802202211033966M", "disney-mickey-mouse-fishing-set-jcpenney-dae9c7.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0624202609055756M", "merry-merry-bingo-table-game-jcpenney-c65ff1.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP73228802-20260924053918M", "sharper-image-remote-control-robots-2-pack-jcpenney-6b8e0f.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0201202407105949M", "banzai-kids-inflatable-mega-boxing-gloves-jcpenney-982cc9.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0624202609032785M", "retro-arcade-desktop-foosball-game-jcpenney-dfdf43.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP75669144-20261102094620M", "cra-z-art-grinch-slime-bucket-jcpenney-03f9f2.webp"],
  ["https://mktpl-images.jcpenney.com/SOURCE/3fc5737d2a014907964de813080afb37", "gbruno-toddler-learning-tablet-jcpenney-c496cd.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP1008202007111712M", "discovery-kids-magnetic-tiles-24-pieces-with-triangles-jcpenney-3d7d32.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP0730202507115886M", "supreme-silent-sports-basketball-jcpenney-08ea42.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP73198890-20260924043646M", "discovery-mindblown-diy-model-hybrid-engine-kit-jcpenney-592129.webp"],
  ["https://sc-images.jcpenney.com/JCPenney/DP73206521-20260924045155M", "discovery-mindblown-diy-arm-blaster-jcpenney-4d6351.webp"],
];

/**
 * The owner's round-3 screenshot picks on Kids (links above): her own sends, so the "at most 2 pajamas per section" rule
 * (src/test/giftGuideOwner1120d.test.ts) does not count them, as it does not count a theme row marked ownerAdd.
 */
export const KIDS_OWNER_SCREENSHOTS_1125 = ["https://go.shopmy.us/p-110699595", "https://walmrt.us/4eUyq3F", "https://walmrt.us/4lc3orK", "https://walmrt.us/4zETfHG", "https://walmrt.us/4eVQ07i", "https://walmrt.us/4AXpPpv", "https://walmrt.us/4eWzgNd", "https://walmrt.us/4iW9on6", "https://walmrt.us/48Ej3ZE", "https://walmrt.us/4j1P1VH", "https://walmrt.us/4fPIaMM", "https://walmrt.us/3VHakCW", "https://walmrt.us/4tjUhqV", "https://walmrt.us/4lbUIl6", "https://walmrt.us/4lbUESo", "https://walmrt.us/4A7xCkw", "https://walmrt.us/4AQzIVE", "https://walmrt.us/4AaBwJk", "https://walmrt.us/4tlQ2eK", "https://walmrt.us/4eZnjGG", "https://walmrt.us/4Aa49X8", "https://walmrt.us/4ARwgKs", "https://walmrt.us/3Vg2vDU", "https://walmrt.us/4tfD9Tf", "https://walmrt.us/3Vj4Kqe", "https://walmrt.us/4tl8fZF", "https://walmrt.us/4tgDB3I", "https://walmrt.us/4A0YC4p", "https://walmrt.us/4zGPOjQ", "https://walmrt.us/48I4xQr", "https://walmrt.us/4kzGB9d", "https://walmrt.us/4jBxIKf", "https://walmrt.us/4jaUUPc", "https://walmrt.us/4jb5vcF", "https://walmrt.us/4j9FpqC", "https://walmrt.us/4A1HtrP", "https://walmrt.us/4jamQm7", "https://walmrt.us/3X7CzuU", "https://walmrt.us/4A1xnHu", "https://walmrt.us/4fqQX7K", "https://walmrt.us/4jb5wgJ", "https://walmrt.us/4jhFZmp", "https://walmrt.us/4j8cZ03", "https://walmrt.us/3Vfu4xm", "https://walmrt.us/4ANUqp7", "https://walmrt.us/4ku91Bo"];
