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

/** The day these prices were checked (Louisiana day). */
export const ADDS_PRICE_AT = "2026-11-22";

/** Stores these picks go to that the store list may not hold yet (key -> shown name). */
export const ADDS_STORES_1122 = {
  "store-sleep-crown": "Sleep Crown", "store-crown-affair": "Crown Affair", "store-eadem": "EADEM", "store-aera": "Aera",
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
].map(dated);

/** For Kids (owner via the lead, 11-22): the two Camp Snap 2 colors, at Camp Snap direct (see the header). */
export const KIDS_ADDS_1122 = [
  { name: "Camp Snap 2 Screen-Free Camera, Blue Rush", brand: "Camp Snap", line: "A screen-free kids' camera in see-through blue.", href: shopmy("p-107929152"), image: "https://static.shopmy.us/pins/zoom-109142125-1795365781660-Yellow_Front_9ea4e828-8752-4bcd-bf01-b49ef26f4be5.webp", store: "store-camp-snap", sortPrice: 59.99, price: 59.99, commission: 10, type: "camera", code: CAMP_SNAP_CODE },
  { name: "Camp Snap 2 Screen-Free Camera, Strawberry Splash", brand: "Camp Snap", line: "A screen-free kids' camera in see-through pink.", href: shopmy("p-104219842"), image: "https://static.shopmy.us/pins/zoom-109142226-1795365794451-Yellow_Front-3.webp", store: "store-camp-snap", sortPrice: 59.99, price: 59.99, commission: 10, type: "camera", code: CAMP_SNAP_CODE },
].map(dated);

/** For Him (owner via the lead, 11-22). */
export const HIM_ADDS_1122 = [].map(dated);

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
];
