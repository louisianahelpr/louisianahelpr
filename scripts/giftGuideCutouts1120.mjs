/**
 * PHOTO CUTOUTS (photo review 11-20, ~/.lh-shots/holiday-audit-1120/PHOTO-findings.md, "busy-background"): owner
 * 11-20 "None of the images should have a background". Each photo listed here showed its product in a room, on a
 * table or against a coloured backdrop; the product was cut out to a transparent WebP in
 * public/gift-guides/cutouts/ (each one checked by eye), and the picks generator shows that file instead.
 * Keyed on the photo's URL without its query string. Amazon photos are never listed: Associates rules forbid
 * editing them.
 */
export const CUTOUT_BASE = "https://www.louisianahelpr.com/gift-guides/cutouts/";
export const CUTOUTS_1120 = new Map([
  // Step2 Whisper Ride Cruiser
  ["https://assets.wfcdn.com/avif/im/24582098/compr-r85/3383/338369132/Step2+Whisper+Ride+Cruiser+Toddler+Outdoor+Riding+Toy-49982616.jpg", "step2-whisper-ride-cruiser-304ddc.webp"],
  // Eddie Bauer Reversible Plaid Heated Plush Throw
  ["https://static.shopmy.us/pins/zoom-108165789-1795157431909-6e32be17-4d52-4ecc-a2f3-239d032555d9.869fb9b8a1242a5c295bd581afa872e3.jpeg", "eddie-bauer-reversible-plaid-heated-plush-throw-d84e40.webp"],
  // OYU Botanica Winter Radiance Duo
  ["https://www.oyubotanica.com/cdn/shop/files/Gemini_Generated_Image_lkrav9lkrav9lkra.jpg", "oyu-botanica-winter-radiance-duo-6b8633.webp"],
  // Kodak Ektar H35 Half Frame Film Camera
  ["https://static.shopmy.us/pins/zoom-107907561-1795119684742-NickeyKehoe-Oct21st2026-P21801-1-Under3.5MB.jpg", "kodak-ektar-h35-half-frame-film-camera-f7ce7d.webp"],
  // Printfresh Pima Modal Short PJ Set
  ["https://static.shopmy.us/uploads/9ae2ae20-23af-4b10-9fdb-8a6d00c87c0fimgi_128_PF_SU26_Bagheera_Ink_PimaKnitShortSet_002.png", "printfresh-pima-modal-short-pj-set-82b45e.webp"],
  // Southern Tide Sara Lounge Pullover
  ["https://static.shopmy.us/uploads/img-product-1763060875825", "southern-tide-sara-lounge-pullover-6bd957.webp"],
  // Under Armour Rival Fleece Hoodie
  ["https://static.shopmy.us/uploads/5a684727-75dd-4133-9ab7-6ae364f216dbimgi_1_V5-1379861-410_INTFAB.webp", "under-armour-rival-fleece-hoodie-88de48.webp"],
  // Caden Lane Cozy Claus Christmas Pajama Set
  ["https://cdn.shopify.com/s/files/1/1275/3323/files/CozyClaus_Products_066v2.jpg", "caden-lane-cozy-claus-christmas-pajama-set-c75cc1.webp"],
  // Cocolillys Coco Leggings
  ["https://cdn.shopify.com/s/files/1/0383/0834/7948/files/JAZP2327_170e8e95-ca74-4f37-9b33-1477423b6d6b.jpg", "cocolillys-coco-leggings-795ab9.webp"],
  // Eberjey Gisele Long PJ Set, Ivory
  ["https://static.shopmy.us/pins/zoom-108002676-1795131005268-4141400580175_270_b", "eberjey-gisele-long-pj-set-ivory-f3827c.webp"],
  // Privet House Papers & Prints Privet House Woodland Lodge Shield Gift Tags
  ["https://cdn.shopify.com/s/files/1/0251/1846/files/logeshieldtag2.jpg", "privet-house-papers-prints-privet-house-woodland-l-0047b7.webp"],
  // Tower 28 Holiday Mini Tote
  ["https://cdn.shopify.com/s/files/1/2926/6108/files/T28_OnHoliday_Shot10__1239__FINAL_FULL__TEXTURE.jpg", "tower-28-holiday-mini-tote-6210de.webp"],
  // bareMinerals Eye, Cheek & Lip VIP Set
  ["https://cdn.shopify.com/s/files/1/0552/0883/7205/files/BM_4Q26_BFCM_SITE_Ingrid_2_V2.jpg", "bareminerals-eye-cheek-lip-vip-set-8f5780.webp"],
  // Splendid Red Satin Silk PJ Set
  ["https://static.shopmy.us/pins/zoom-107932765-1795122390459-HO24_SLEEP_RPF2079SE_RED_1.jpg", "splendid-red-satin-silk-pj-set-60e245.webp"],
  // Caden Lane Personalized Color Blanket (Pink)
  ["https://cdn.shopify.com/s/files/1/1275/3323/files/blanketgroup-pinks_1.jpg", "caden-lane-personalized-color-blanket-pink-f5baf0.webp"],
  // Printfresh Long Cotton Robe
  ["https://cdn.shopify.com/s/files/1/1543/8719/products/Printfresh_Tiger-Queen_Jade_Robe_PJ13TQ-JD_009.jpg", "printfresh-long-cotton-robe-1c112a.webp"],
  // Terrain Ruffled Marble Bowl
  ["https://static.shopmy.us/pins/zoom-106276407-1794859725529-84842855_002_b", "terrain-ruffled-marble-bowl-b353c5.webp"],
  // Vuori Logo Hoodie
  ["https://static.shopmy.us/uploads/img-product-1792156479004", "vuori-logo-hoodie-8921ae.webp"],
  // Vuori Women's Relaxed Fit Performance Jogger
  ["https://static.shopmy.us/pins/zoom-107935304-1795122690356-VW303BTH_FA26_W_BOTTOMS_SIDE_3_7cb50704-e7b9-4c71-bf90-c3cf5d721031.png", "vuori-women-s-relaxed-fit-performance-jogger-eedae8.webp"],
]);

/** The photo to show for `image`: its transparent cutout when one exists, else `image` itself. */
export const cutoutPhoto = (image) => {
  if (typeof image !== "string") return image;
  const file = CUTOUTS_1120.get(image.split("?")[0]);
  return file ? CUTOUT_BASE + file : image;
};
