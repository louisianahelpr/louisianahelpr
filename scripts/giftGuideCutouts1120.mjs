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
  // Melissa & Doug Super Smile Dentist Play Set (melissaanddoug.com box photo, plain white; replaces the kids-at-a-table photo)
  ["https://www.melissaanddoug.com/cdn/shop/files/e7a572b0725772c6561bea26c1df68e40d6c5382_1024x1024.jpg", "melissa-doug-super-smile-dentist-play-set-b3c2a1.webp"],
  // Glow Recipe Watermelon Glow Niacinamide Serum (glowrecipe.com Dew Drops photo, bottle and watermelon slice)
  ["https://cdn.shopify.com/s/files/1/0543/8301/files/10_21_2410_21_24_WM_DEWDROPS-_1.jpg", "glow-recipe-watermelon-glow-niacinamide-serum-b3c2a2.webp"],
  // Weezie Scalloped Hand Towels (2-Pack), Grey on White (weezietowels.com pair photo, plain grey; replaces the bathroom photo)
  ["https://static.shopmy.us/pins/zoom-108005682-1795131438000-grey-on-white-2_bfe36f47-7ce5-47b9-b73f-6d841c8b9c9c.jpg", "weezie-scalloped-hand-towels-grey-on-white-b3c2a3.webp"],
  // Mejuri Stevie Hoop Earrings (mejuri.com US photo, cream backdrop)
  ["https://cdn.shopify.com/s/files/1/0631/8568/2616/files/3-THENEWHOOP-TheNewHoopVermeilHoopVermeilCharm-V-AngledFrontView_061_3f4f28ff-b6e1-45ba-9ddc-5ec29192b37a.jpg", "mejuri-stevie-hoop-earrings-b3c171.webp"],
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
  // Fabletics Evolve 3-Pocket Scrub Top, Onyx
  ["https://cdn.fabletics.com/assets/images/skus/TS2500501-0770", "fabletics-evolve-3-pocket-scrub-top-onyx-41ff66.webp"],
  // Fabletics High-Rise Wide Leg Scrub Pant, Onyx
  ["https://cdn.fabletics.com/assets/images/skus/PN2500506-0770", "fabletics-high-rise-wide-leg-scrub-pant-onyx-8d77d5.webp"],
  // Barefoot Dreams CozyChic Ribbed Robe
  ["https://cdn.shopify.com/s/files/1/0270/6977/5965/files/SP25_BDUCC23148_DustyRose_1074_HRW_3.jpg", "barefoot-dreams-cozychic-ribbed-robe-4a57c9.webp"],
  // Elyse Breanne Design Badge Reel
  ["https://cdn.shopify.com/s/files/1/0436/4484/6230/files/BDGR004.jpg", "elyse-breanne-design-badge-reel-a794f1.webp"],
  // Vuori Women's Halo Essential Hoodie
  ["https://static.shopmy.us/pins/zoom-107935469-1795122711385-VW226xBLACKHEATHERxPrimary_78657540.jpg", "vuori-women-s-halo-essential-hoodie-729379.webp"],
  // Sky & Sol Tallow Magnesium Night Balm
  ["https://cdn.shopify.com/s/files/1/0764/9466/8076/files/sky-and-sol-tallow-magnesium-night-balm-6951218.webp", "sky-sol-tallow-magnesium-night-balm-b16ed7.webp"],
  // Eberjey Gisele Short PJ Set, Navy
  ["https://static.shopmy.us/pins/zoom-108002657-1795131003013-49556467_041_b", "eberjey-gisele-short-pj-set-navy-2a60b4.webp"],
  // Weezie Towel Wrap, Daybreak Yellow
  ["https://static.shopmy.us/pins/zoom-108005718-1795131442444-DayBreak-1.jpg", "weezie-towel-wrap-daybreak-yellow-940080.webp"],
  // Barefoot Dreams Men's CozyChic Lite Hoodie
  ["https://static.shopmy.us/uploads/db9b3db2-31ae-4937-996e-78782d8358ecBDMCL21076_CCLMensHoodie_Black0731_2000x2631.png", "barefoot-dreams-men-s-cozychic-lite-hoodie-9e4df2.webp"],
  // Weezie Holiday Kitchen Towel Trio
  ["https://static.shopmy.us/uploads/57605306-b0ce-4bae-a80a-a5f25d2fcde2_festive-trio-3_600x_1010x1010.jpg", "weezie-holiday-kitchen-towel-trio-0ed5b4.webp"],
  // Maisonette Ducks Baby Pajamas
  ["https://static.shopmy.us/pins/zoom-108100673-1795144222288-WXZdEMYzF3p1mC184cAVhLxQo.jpg", "maisonette-ducks-baby-pajamas-642147.webp"],
  // VEVOR Portable Basketball Hoop
  ["https://static.shopmy.us/uploads/img-product-1792439614308", "vevor-portable-basketball-hoop-db3412.webp"],
  // Called to Surf Rainbow Striped Cardigan
  ["https://cdn.shopify.com/s/files/1/3000/9920/files/A_young_woman_wearing_a_modest_rainbow_stripe_button_down_cardigan_with_long_sleeves..jpg", "called-to-surf-rainbow-striped-cardigan-748b11.webp"],
  // Caden Lane Mommy & Me Pointelle Lounge Sets
  ["https://cdn.shopify.com/s/files/1/1275/3323/files/MommyAndMe_RoseGarden_product0001.jpg", "caden-lane-mommy-me-pointelle-lounge-sets-5e7048.webp"],
  // Splendid Sugar Cookie Marna Pillowsoft PJ Set
  ["https://static.shopmy.us/pins/zoom-104382386-1794464488284-web_HO25_RPF2028SE_HKO_4.jpg", "splendid-sugar-cookie-marna-pillowsoft-pj-set-7615a3.webp"],
  // Weezie Baby Hooded Towel, Matcha
  ["https://static.shopmy.us/pins/zoom-108005727-1795131443781-Matcha-1_2b3e3143-2471-4008-b0ec-b0ec0e599494.jpg", "weezie-baby-hooded-towel-matcha-e39877.webp"],
  // Paddywax Smoked Pistachio Cowboy Boot Candle
  ["https://static.shopmy.us/uploads/63ca53c5-0d37-4595-b335-ee61a0fa346b_image-1772082373032", "paddywax-smoked-pistachio-cowboy-boot-candle-34a349.webp"],
  // Modern Sprout Hydroponic Grow Kit, Cactus
  ["https://static.shopmy.us/uploads/img-product-1793668113498", "modern-sprout-hydroponic-grow-kit-cactus-71ec42.webp"],
  // Modern Sprout Creative Archetype Seed Balls, Set of 5
  ["https://static.shopmy.us/uploads/img-product-1794774025652", "modern-sprout-creative-archetype-seed-balls-set-of-7db2e8.webp"],
  // Southern Tide Team Colors Runaround Quarter Zip
  ["https://static.shopmy.us/uploads/img-product-1758383704156", "southern-tide-team-colors-runaround-quarter-zip-0f6be4.webp"],
  // Aunt Sally's Creole Pralines Aunt Sally's Creamy Classic Pralines - Box of 12
  ["https://goldbelly.imgix.net/uploads/showcase_media_asset/image/95943/creamy-classic-pralines-box-of-12.cfaa56fc14fda975e48dd34e8fcc9589.png", "aunt-sally-s-creole-pralines-aunt-sally-s-creamy-c-15e04c.webp"],
  // Foton Pearled Candle, 18 oz
  ["https://cdn.shopify.com/s/files/1/0568/9776/5573/files/18oz_Unscented_Colored_with_Swatch_-_White.png", "foton-pearled-candle-18-oz-85a43b.webp"],
  // Southern Tide Levitt Lounge Pant
  ["https://static.shopmy.us/uploads/img-product-1763060984280", "southern-tide-levitt-lounge-pant-551fb3.webp"],
  // Barefoot Dreams CozyChic Cotton Long Cardigan
  ["https://cdn.shopify.com/s/files/1/0270/6977/5965/files/BDWNV27078_DeepGarnet_6562_W.jpg", "barefoot-dreams-cozychic-cotton-long-cardigan-6ccf4c.webp"],
  // Chewy Solid Wood Removable Bolster Cat Window Perch
  ["https://static.shopmy.us/pins/zoom-103905618-1794379690182-069e78cb-0d47-7a90-8000-3d66b9a9388a._AC_SS1800_V1_.jpg", "chewy-solid-wood-removable-bolster-cat-window-perc-a831f4.webp"],
  // Tushbaby Tushpuppy Hip Seat Pet Carrier
  ["https://cdn.shopify.com/s/files/1/0060/9982/8802/files/1_1d893b4f-034d-476e-b67f-7a8901cb652a.png", "tushbaby-tushpuppy-hip-seat-pet-carrier-31d46a.webp"],
  // Huk Pursuit Hoodie
  ["https://static.shopmy.us/pins/zoom-107794758-1795108334212-00000000_zi_658f3e74-aab2-41ce-a7b2-331ee6d6c4bd.jpg", "huk-pursuit-hoodie-f6d950.webp"],
  // Nike Sportswear Club Fleece Hoodie
  ["https://static.shopmy.us/uploads/2a8cddc4-4db4-4479-ab05-24d03633871eimgi_1_M%2BCLUB%2BBB%2BHOODIE%2BCWASH.png", "nike-sportswear-club-fleece-hoodie-b44dcb.webp"],
  // Hickory Farms Savory Snacks Gift Box
  ["https://static.shopmy.us/pins/zoom-108165589-1795157355359-522c0afc-1816-4611-a47d-14473b4ecb9b.f34c4828ce66a07183ce544443810628.jpeg", "hickory-farms-savory-snacks-gift-box-d4132e.webp"],
  // Old Navy High-Waisted Wow Wide-Leg Jeans
  ["https://static.shopmy.us/uploads/1dd59d27-2c41-45e5-af53-51d0877c1950_cn61704405_1605x2140.png", "old-navy-high-waisted-wow-wide-leg-jeans-5e16a8.webp"],
  // Paddywax Sweet Like Peppermint Candle
  ["https://static.shopmy.us/uploads/6bf7fbb4-6ccc-41ff-9fe2-2614f404c0f7_image-1790168566381", "paddywax-sweet-like-peppermint-candle-64753a.webp"],
  // AeroPress Clear Coffee Press
  ["https://static.shopmy.us/uploads/21aa3a79-d9f9-46aa-b7ec-43dd0c2fc390_aeropress-clear-coffee-press-xl.jpg", "aeropress-clear-coffee-press-473649.webp"],
  // FOR HER 11-21 (the owner's 14 ShopMy saves, scripts/giftGuideHer1121.mjs): Apple Vision cutouts unless noted.
  // On Cloud 6 Sneakers, Glacier/White
  ["https://static.shopmy.us/pins/zoom-108613972-1795240704146-3MF10070_050", "on-cloud-6-sneakers-glacier-white-4f6466.webp"],
  // BIODANCE Hydro Cera-Nol Real Deep Mask (flood-filled from its white ground; Vision lifted only the box art)
  ["https://static.shopmy.us/uploads/c5e32645-7fc2-4c8a-af7f-d12b9c83bc61imageye___-_imgi_1_4201001452-847__1.jpeg", "biodance-hydro-cera-nol-real-deep-mask-08b369.webp"],
  // Hatch Restore 3, Putty
  ["https://static.shopmy.us/pins/zoom-108613500-1795240519319-R3_Putty.jpg", "hatch-restore-3-putty-37e619.webp"],
  // Ember Mug 2, Brown
  ["https://static.shopmy.us/pins/zoom-108613356-1795240468332-17103719_fpx.tif", "ember-mug-2-6dfd0f.webp"],
  // Owala FreeSip 24 oz, Open Air
  ["https://static.shopmy.us/pins/zoom-108613192-1795240422444-C07940_450", "owala-freesip-24-oz-open-air-3af608.webp"],
  // Therabody Theragun Mini
  ["https://static.shopmy.us/pins/zoom-108612982-1795240352615-253765107_0435.jpg", "therabody-theragun-mini-a30abd.webp"],
  // Camp Snap CS-8 Micro Video Camera Keychain
  ["https://static.shopmy.us/pins/zoom-106643598-1794927315931-micro1.jpg", "camp-snap-cs-8-micro-video-camera-keychain-60114e.webp"],
  // Stanley All Day Julienne Midi Cooler
  ["https://www.rei.com/media/40f2076a-b808-4b12-b912-240e6fa0e847", "stanley-all-day-julienne-midi-cooler-792e50.webp"],
  // YETI Camino 35 Carryall, Cape Taupe
  ["https://static.shopmy.us/uploads/pretty-prod-1787425474692", "yeti-camino-35-carryall-cape-taupe-2e1972.webp"],
  // BaubleBar Fallon 14K Gold Bezel Earrings
  ["https://static.shopmy.us/uploads/adc16a77-2764-49c6-8995-55c0e42754c9_s-blob-v1-IMAGE-DBeu-uRDNQQ.png", "baublebar-fallon-gold-bezel-earrings-099398.webp"],
  // Shark Depuffi Hot & Cold Face Sculpting Tool
  ["https://asset.sephora.co.uk/img/prod/pid/P1000211062/114692_media_principal_extendedaten_gb_0_extended_06-05-26-09-52-04.jpg", "shark-depuffi-hot-cold-face-tool-154ac1.webp"],
  // CurrentBody LED Red Light Therapy Face Mask
  ["https://static.shopmy.us/uploads/pretty-prod-1789545457784", "currentbody-led-red-light-face-mask-86c492.webp"],
  // UGG Goldenstar Evelina Clog, Beige
  ["https://static.shopmy.us/pins/zoom-108604684-1795237968140-108971391_025_b", "ugg-goldenstar-evelina-clog-beige-39d6c0.webp"],
  // Lola Blankets Original Throw (flood-filled, grey shadow removed; Vision lifted only the label)
  ["https://static.shopmy.us/uploads/346f926f-f41b-444e-b686-921455d30264_74A53B12-D898-44DD-8ADB-BBB0CD895907.jpg", "lola-blankets-original-throw-green-ac1ca0.webp"],
]);

/** The photo to show for `image`: its transparent cutout when one exists, else `image` itself. */
export const cutoutPhoto = (image) => {
  if (typeof image !== "string") return image;
  const file = CUTOUTS_1120.get(image.split("?")[0]);
  return file ? CUTOUT_BASE + file : image;
};
