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
  ["https://walmrt.us/4CpL44Q", 9.88, "https://i5.walmartimages.com/seo/Christmas-Dumpling-Advent-Calendar-2026-24-Day-Countdown-for-Kids-Adults-Christmas-Gifts_314174ac-f2be-4671-9298-cb45b155a858.71d0d4271709de6df7d649374e98a4c3.jpeg", "Christmas Dumpling Advent Calendar", "", "store-walmart", "advent-calendar", 6, "A 24-day countdown of squishy holiday dumpling toys."],
  ["https://walmrt.us/4fSzHIL", 12.61, "https://i5.walmartimages.com/seo/Cute-Farm-Animal-Dumpling-Advent-Calendar-24-Days-Christmas-Countdown-Ornament-Gift-for-Kids-Teens-Holiday-Tree-Decor_26079486-b2a9-431b-927a-7b2e8d268d0d.7c2740f8708f1d701d8f7d5534c608be.jpeg", "Cute Farm Animal Dumpling Advent Calendar", "", "store-walmart", "advent-calendar", 6, "Farm animal dumpling squishies, one for each day of December."],
  ["https://walmrt.us/4jcx3OU", 16.89, "https://i5.walmartimages.com/seo/UUGEE-2024-Christmas-Advent-Calendar-Boys-Kids-24-Days-Countdown-Calendar-Pull-Back-Cars-Toys-Set-24-Vehicles-Xmas-Surprise-Gifts-1-2-3-Years-Old-Tod_492e28fe-d787-4a63-9a78-0f73457b08bf.2903e563bf3a841cad4744e24bc94846.jpeg", "UUGEE Advent Calendar, 24 Pull-Back Cars", "UUGEE", "store-walmart", "advent-calendar", 6, "24 pull-back cars to open, one each day before Christmas."],
  ["https://walmrt.us/3V7qKEv", 15, "https://i5.walmartimages.com/seo/Monster-Jam-1-64-Truck-Collection-4-Pack-with-3-Bonus-Mini-Jams-Vehicles-for-Kids-3-and-up_5e70e26e-62fc-4d27-ac48-d6c0bbeb0a2e.8f9818984e305aa62898183ec2d08edb.jpeg", "Monster Jam 1:64 Truck 4-Pack with 3 Mini Jams", "Monster Jam", "store-walmart", "vehicle-toy", 6, "Four Monster Jam trucks plus three mini trucks to race."],
  // Walmart Creator links made 11-24 ~3:05 AM (creator.walmart.com; Black Friday elevated rate for apparel and shoes 15%,
  // where Later's Walmart rate for apparel is its 0% baseline); listing re-read ~3:10 AM, sold by Walmart, in stock.
  // S28: the kid-size KPop Demon Hunters slipper (reg. $16.98; the $5 Huntrx pair is adult/teen sizes only).
  ["https://walmrt.us/4AQxuWv", 8, "https://i5.walmartimages.com/seo/KPop-Demon-Hunters-Girls-Slipper_4a177782-fa79-4508-9ca0-3a1196057428.81560971bb841793f8ca6e21114a80ff.jpeg", "KPop Demon Hunters Girls Slippers", "KPop Demon Hunters", "store-walmart", "slippers", 15, "Fuzzy KPop Demon Hunters slippers for cozy mornings."],
  // S29 (reg. $12.98), toddler sizes.
  ["https://walmrt.us/4CcMa3A", 5, "https://i5.walmartimages.com/seo/MONSTER-JAM-GRAVE-DI_def5b20b-fbde-4411-b535-8bf50039e548.c2076dadbc2472328eabc7b3f1a55779.jpeg", "Monster Jam Grave Digger Toddler Slippers", "Monster Jam", "store-walmart", "slippers", 15, "Grave Digger slippers for little feet."],
  // S30 (reg. $12.98), sizes 12M-5T; the listing's character is Bluey.
  ["https://walmrt.us/3VHA424", 5.84, "https://i5.walmartimages.com/seo/Character-Toddler-Long-Sleeve-Top-and-Pant-Pajama-Set-2-Piece-Sizes-12M-5T_85a8419b-f3f7-4696-a1fb-5ac768017ac8.20bc5657ccf727ebdbdb6c2dde622e53.jpeg", "Bluey Toddler Pajama Set", "Bluey", "store-walmart", "pajamas", 15, "A cozy Bluey pajama set for toddlers."],
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
];
/** For Him. */
export const HIM_STEALS_1124_ROWS = [
  // S1 Macy's exclusive (reg. $50, 80% off), read on macys.com 2:11 AM, Add to Bag active.
  ["https://go.shopmy.us/p-110122396", 9.99, "https://slimages.macysassets.com/is/image/MCY/products/4/optimized/38043904_fpx.tif", "The Cellar Morgan Ceramic Plaid Mugs, Set of 2", "The Cellar", "store-macys", "mug", 16, "Two plaid mugs for cocoa by the tree."],
  // Walmart Creator links made 11-24 ~3:05 AM (creator.walmart.com; Black Friday elevated rate for apparel and shoes 15%,
  // where Later's Walmart rate for apparel is its 0% baseline); listing re-read ~3:10 AM, sold by Walmart, in stock.
  // S33 (reg. $24.98, through Nov 29).
  ["https://walmrt.us/3XKh0AM", 10, "https://i5.walmartimages.com/seo/The-Grinch-12-Days-of-Socks-Combo_e33cd6e5-1e35-4769-9490-059af8503126.9e5e89e3e8c8b7df6251e0b6d39896b6.jpeg", "The Grinch Men's 12 Days of Socks", "Dr. Seuss", "store-walmart", "socks", 15, "Twelve pairs of Grinch socks, one for each day of Christmas."],
];

/** Store photos for the steals, cut out (Apple Vision) into public/gift-guides/cutouts: photo URL -> file. */
export const STEALS_CUTOUTS_1124 = [
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
];
