/**
 * THE OWNER'S STEALS ON THE GUIDES (owner 11-24 ~1:45 AM, Desktop "Louisiana Helpr Tracker/reviews/steals-pick-1124.html";
 * list ~/.lh-shots/steals-to-guides-1124.md, S-numbers = ~/.lh-shots/bf-store-sales-1124.md "STEALS"), plus her Walmart
 * advent calendars (~2:30-2:35 AM, her own Walmart Creator links). Each row is the exact product page, read 11-24 (price,
 * stock, photo, maker's age), and the best-paying link for it by the owner's all-factors store rule: Target toys through
 * ShopMy at 4% (Later's Target rate is by category: Toys 2.8%), Macy's through ShopMy 16%, her own Walmart links as she
 * sent them. Rows: [link, price, store photo, name, brand, store, type, commission %, line]. Names carry no model year.
 * Pulled into scripts/giftGuideOwner1124.mjs (HER_ADDS_1124 / KIDS_ADDS_1124). Guard: src/test/giftGuideOwner1124.test.ts.
 */

/** For Kids. */
export const KIDS_STEALS_1124_ROWS = [
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
];
/** For Her (filled in the next batch). */
export const HER_STEALS_1124_ROWS = [];

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
];
