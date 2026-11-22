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
  // COMMISSION SWITCHES 11-21 (same item, better-paying store; scripts/giftGuideHer1121.mjs, scripts/giftGuideHimKids1121.mjs).
  // Each photo is from the new store's own product page (never Amazon's), Apple Vision cutout, checked on red.
  // XTRATUF Men's Ankle Deck Boot, Chocolate/Tan, style 22734 (xtratuf.com grey-backdrop main photo; Him, switched from Amazon 11-21)
  ["https://cdn.shopify.com/s/files/1/0676/1385/1803/files/22734_gray_main_720x720_4234e2d7-b576-4907-bb67-594af369ef72.jpg", "xtratuf-ankle-deck-boot-chocolate-tan-595c49.webp"],
  // TATCHA The Kissu Lip Mask (tatcha.com main photo)
  ["https://cdn.shopify.com/s/files/1/0949/3328/7221/files/TheKissuLipMask-pdp-Aug26-Omi-FullSize-MainImage-1200x1200.jpg", "tatcha-kissu-lip-mask-306203.webp"],
  // L'OCCITANE Shea Butter Classics Gift Set (anthropologie.com boxed-set photo, reflection left out)
  ["https://images.urbndata.com/is/image/Anthropologie/114587041_030_b2", "loccitane-shea-butter-classics-gift-set-5532cc.webp"],
  // Therabody Theragun Prime (6th Generation), Black (exclusivebeautyclub.com photo)
  ["https://cdn.shopify.com/s/files/1/2959/8080/files/therabody-theragun-prime-massage-gun-black.png", "therabody-theragun-prime-6th-gen-e4ad1b.webp"],
  // LaCrosse Men's Grange 18" Rubber Boot, OD Green (dillards.com photo)
  ["https://dimg.dillards.com/is/image/DillardsZoom/zoom/lacrosse-mens-grange-18-tall-waterproof-rubber-hunting-work-boots/00000000_zi_ac01ed80-ad36-4d40-8cca-066a3f05fcbd.jpg", "lacrosse-grange-18-rubber-boot-906f98.webp"],
  // BIODANCE Hydro Cera-Nol Real Deep Mask, 4 sheets (iherb.com photo, white gaps cleared; switched from Sephora UK 11-21)
  ["https://cloudinary.images-iherb.com/image/upload/f_auto,q_auto:eco/images/bdo/bdo36097/l/19.jpg", "biodance-hydro-cera-nol-real-deep-mask-4-sheets-5ff79f.webp"],
  // Stanley All Day Julienne Midi Cooler, Cream (stanley1913.com photo, already transparent; cropped only)
  ["https://cdn.shopify.com/s/files/1/0375/3269/6635/files/Web_PNG_Square-The_All-Day_Julienne_Midi_Cooler_12QT_-_Cream_-_Front.png", "stanley-all-day-julienne-midi-cooler-cream-309bba.webp"],
  // FOR HIM and FOR KIDS 11-21 (the owner's ShopMy saves, scripts/giftGuideHimKids1121.mjs): Apple Vision cutouts unless noted.
  // smathers branson duck decoys key fob
  ["https://static.shopmy.us/pins/zoom-108628349-1795247477620-DuckDecoys_AntiqueBlue__KeyFob_Primary_LowRes_c251e80f-b48c-4193-88c2-0b366856e967.jpg", "smathers-branson-duck-decoys-key-fob-f959a7.webp"],
  // smathers branson camo needlepoint belt
  ["https://static.shopmy.us/uploads/img-product-1792092560933", "smathers-branson-camo-needlepoint-belt-9362af.webp"],
  // phils face beard serum
  ["https://static.shopmy.us/pins/zoom-108626053-1795245908121-FaceBeardSerum.jpg", "phils-face-beard-serum-c7d424.webp"],
  // dr squatch fresh falls bar soap (flood filled from its white ground; Vision lifted only the logo)
  ["https://static.shopmy.us/pins/zoom-108626008-1795245889562-iewmi44ymwp5whivvent.jpg", "dr-squatch-fresh-falls-bar-soap-655c35.webp"],
  // dr squatch hand body lotion
  ["https://static.shopmy.us/pins/zoom-108626036-1795245900235-scay0j7x7kubjvla5qrv.jpg", "dr-squatch-hand-body-lotion-337147.webp"],
  // method men body wash sea surf
  ["https://static.shopmy.us/pins/zoom-108625988-1795245880004-qtvoydnznvaowxmbx9or.jpg", "method-men-body-wash-sea-surf-7c385f.webp"],
  // clinique for men oil free moisturizer
  ["https://www.clinique.com/cdn/shop/files/cl_sku_V2Y701_3000x3000_0.png", "clinique-for-men-oil-free-moisturizer-0b9a93.webp"],
  // clinique for men post shave soother
  ["https://www.clinique.com/cdn/shop/files/cl_sku_651705_3000x3000_0.png", "clinique-for-men-post-shave-soother-3ebdc1.webp"],
  // steffi love baby doctor playset
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/eWo2uVncVtpsQvebn-mR5bF0A.jpg", "steffi-love-baby-doctor-playset-6217a1.webp"],
  // mentari puppy on wheels
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/0dnFbFKBx5K6e6OmCfMNzo-dI.jpg", "mentari-puppy-on-wheels-90b238.webp"],
  // tender leaf rocket construction
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/1ZzbSn-AD4C1Zcfr2WzDUTQmE.jpg", "tender-leaf-rocket-construction-f554d4.webp"],
  // mentari wooden ramp racer
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/CaauQ70t8wMJ7uoE4RIz-0T7I.jpg", "mentari-wooden-ramp-racer-daccf5.webp"],
  // colored organics truck bath toys
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/DbI113V-lJpF_YY2t9LI_4_q4.jpg", "colored-organics-truck-bath-toys-73c1cf.webp"],
  // asweets round around
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/ASDi5ER268eeqg9QDRplkfnBw.jpg", "asweets-round-around-7d804b.webp"],
  // asweets sand and water table
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/e3bkcRFq2cOoChymkqAzOUnxU.jpg", "asweets-sand-and-water-table-4fc56a.webp"],
  // highwaykick 1 scooter ash
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/07fMtvSKy51XUzMcnMjlI4vks.jpg", "highwaykick-1-scooter-ash-467e09.webp"],
  // freddo 3 wheel balance bike
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/OED6YgUaANM9D31fVA1qZUCTA.jpg", "freddo-3-wheel-balance-bike-b29eb6.webp"],
  // model u horse ride on
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/xuh1iRemTEjNomia7C6j_bKqU.jpg", "model-u-horse-ride-on-aac217.webp"],
  // hape captains rocking boat
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/EP6NaZng2SVj-x3HxemGP-5QQ.jpg", "hape-captains-rocking-boat-6e6b18.webp"],
  // bits bows babys 1st christmas tote
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/HtPxvujQFBYNQ2lbeag2NGhew.jpg", "bits-bows-babys-1st-christmas-tote-83998c.webp"],
  // nellapima wooden toys gown
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/YVDrFHlUiF5bHBL0uzS5MXo_w.jpg", "nellapima-wooden-toys-gown-295613.webp"],
  // plantoys dancing alligator
  ["https://static.shopmy.us/pins/zoom-108632104-1795250093805-DancingAlligator-5105-Main-sq.jpg", "plantoys-dancing-alligator-20c33e.webp"],
  // melissa doug wood furnished mansion
  ["https://assets.wfcdn.com/im/45146626/compr-r85/4085/408563114/Wood+Furnished+Mansion.jpg", "melissa-doug-wood-furnished-mansion-825096.webp"],
  // melissa doug shopping cart
  ["https://assets.wfcdn.com/im/84968246/compr-r85/1747/174755531/Preschool+Pretend+Grocery+Shopping+Accessories+with+Kitchen+Accessories.jpg", "melissa-doug-shopping-cart-c485e9.webp"],
  // HIM 11-21 (the rest of her ShopMy saves, Apple Vision cutouts)
  // sb rainbow trout tumbler
  ["https://static.shopmy.us/pins/zoom-108628554-1795247624550-RainbowTrout_ClassicNavy__TumblerwithLid_LowRes.jpg", "sb-rainbow-trout-tumbler-175288.webp"],
  // sb redfish bottle opener
  ["https://static.shopmy.us/pins/zoom-108628535-1795247604494-Redfish_Dark_Navy__Bottle_Opener_Low_Res.jpg", "sb-redfish-bottle-opener-52c731.webp"],
  // sb redfish key fob
  ["https://static.shopmy.us/pins/zoom-108628533-1795247603379-Redfish_Dark_Navy__Key_Fob_Primary_Low_Res.jpg", "sb-redfish-key-fob-1f91a1.webp"],
  // sb fishing flies coasters
  ["https://static.shopmy.us/pins/zoom-108628457-1795247557821-Fishing_Fly_Black__Coaster_Primary_Low_Res.jpg", "sb-fishing-flies-coasters-f66b87.webp"],
  // sb upland shoot tumbler
  ["https://static.shopmy.us/pins/zoom-108628432-1795247539414-UplandShoot_Multi__TumblerwithLid_LowRes.jpg", "sb-upland-shoot-tumbler-f4bc50.webp"],
  // sb upland shoot key fob
  ["https://static.shopmy.us/pins/zoom-108628429-1795247534926-Upland_Shoot_Multi__Key_Fob_Primary_Low_Res.jpg", "sb-upland-shoot-key-fob-10774f.webp"],
  // sb upland shoot card wallet
  ["https://static.shopmy.us/pins/zoom-108628421-1795247530982-Upland_Shoot_CCW_Low_Res.jpg", "sb-upland-shoot-card-wallet-8310db.webp"],
  // sb upland shoot can cooler
  ["https://static.shopmy.us/pins/zoom-108628411-1795247528384-Upland_Shoot_Multi__Can_Cooler_Primary_Low_Res.jpg", "sb-upland-shoot-can-cooler-7f5371.webp"],
  // sb upland shoot sunglass strap
  ["https://static.shopmy.us/pins/zoom-108628379-1795247500915-Upland_Shoot_Multi__Sunglass_Straps_Primary_Low_Res.jpg", "sb-upland-shoot-sunglass-strap-b75498.webp"],
  // sb wood duck bottle opener
  ["https://static.shopmy.us/pins/zoom-108628348-1795247475480-WoodDuckDecoy_AntiqueBlue__BottleOpener_LowRes_f009c4b4-eb66-4d44-b476-0fec3a2f3d84.jpg", "sb-wood-duck-bottle-opener-5cb78a.webp"],
  // sb monogrammed valet tray
  ["https://static.shopmy.us/pins/zoom-108628058-1795247283281-ValetTray_ChestnutWood__FramedEdenMonogram_LowRes.jpg", "sb-monogrammed-valet-tray-019c7d.webp"],
  // sb monogrammed coasters
  ["https://static.shopmy.us/pins/zoom-108628052-1795247281134-CoasterSet_CircleSans48_MonogramBlueberryMelon_LowRes_df4b15df-1cf6-4073-b69b-5a3ad20aa27d.jpg", "sb-monogrammed-coasters-c0421f.webp"],
  // sb monogrammed key fob
  ["https://static.shopmy.us/pins/zoom-108628047-1795247277928-KeyFob_Block10_MonogramBlueberrywhite_LowRes_22103605-b81e-4f6b-b8a6-31809f82245c.jpg", "sb-monogrammed-key-fob-175faf.webp"],
  // dr squatch face wash
  ["https://static.shopmy.us/pins/zoom-108626037-1795245901003-s9tzcdtbcihhguemerog.jpg", "dr-squatch-face-wash-febf5a.webp"],
  // dr squatch total moisture soap
  ["https://static.shopmy.us/pins/zoom-108625979-1795245875843-Unscented_Shea_Butter_3.png", "dr-squatch-total-moisture-soap-afb564.webp"],
  // KIDS 11-21 (the rest of her saves; Apple Vision cutouts, the swing car with its floor reflection erased, the club chair without its props)
  // freddo swing car side
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/x2IuT5-1A8vUEdadpwkoOvMBw.jpg", "freddo-swing-car-side-6bd8af.webp"],
  // model u zebra ride on
  ["https://cdn.shopify.com/s/files/1/0583/2323/8975/files/unORD3VQuzDRRzbMq1w_2taVM_6b58675d-6a24-48b1-8321-f3c6a6bc0c79.jpg", "model-u-zebra-ride-on-63f18d.webp"],
  // melissa doug jumbo cardboard blocks
  ["https://assets.wfcdn.com/im/03058393/compr-r85/1765/176593778/24+Piece+Melissa+%26+Doug+Jumbo+Cardboard+Blocks+Learning+Tools.jpg", "melissa-doug-jumbo-cardboard-blocks-608ce0.webp"],
  // melissa doug kids club chair
  ["https://assets.wfcdn.com/im/70136508/compr-r85/8084/80848886/7.5+in.+Club+Chair+Kids+Club+Chair-38254990.jpg", "melissa-doug-kids-club-chair-8f6b24.webp"],
  // melissa doug doorbell house
  ["https://slimages.macysassets.com/is/image/MCY/products/2/optimized/1779252_fpx.tif", "melissa-doug-doorbell-house-bd8e8b.webp"],
  // melissa doug magnetic tabletop easel
  ["https://slimages.macysassets.com/is/image/MCY/products/5/optimized/8290245_fpx.tif", "melissa-doug-magnetic-tabletop-easel-a4b2f2.webp"],
  // melissa doug pull back vehicles
  ["https://slimages.macysassets.com/is/image/MCY/products/8/optimized/1836568_fpx.tif", "melissa-doug-pull-back-vehicles-7ca9db.webp"],  // HIM 11-21 PM (owner: "You can list LSU stuff"; "Find a replacement for the yeti backpack one with a price"): Apple Vision cutouts
  // sb lsu card wallet
  ["https://static.shopmy.us/pins/zoom-108628318-1795247451663-LSU_CCW_Primary_LowRes.jpg", "sb-lsu-card-wallet-b17b9d.webp"],
  // sb lsu fairisle ornament
  ["https://static.shopmy.us/pins/zoom-108628311-1795247447134-LSU_Fairisle_Ornament_Purple_White_Cord__Low_Res.jpg", "sb-lsu-fairisle-ornament-4b16b2.webp"],
  // sb lsu bottle opener
  ["https://static.shopmy.us/pins/zoom-108628309-1795247445313-LSU_BottleOpener_Primary_LowRes.jpg", "sb-lsu-bottle-opener-13ce2c.webp"],
  // sb lsu cufflinks
  ["https://static.shopmy.us/pins/zoom-108628296-1795247441296-LSU_Cufflinks_Primary_Low_Res.jpg", "sb-lsu-cufflinks-45a9a7.webp"],
  // sb lsu toiletry bag
  ["https://static.shopmy.us/pins/zoom-108628280-1795247430486-LSU_Toiletry_Bag_Low_Res_695e403b-4296-4008-acf2-a08453c932ec.jpg", "sb-lsu-toiletry-bag-531d88.webp"],
  // sb lsu wallet
  ["https://static.shopmy.us/pins/zoom-108628276-1795247429638-LSU_Wallet_Primary_LowRes_2fc565e0-ca2b-4bf3-9ab3-ea6e42f35e3d.jpg", "sb-lsu-wallet-c3075b.webp"],
  // sb lsu driver headcover
  ["https://static.shopmy.us/pins/zoom-108628274-1795247427405-LSUDHTLowResPrimary.jpg", "sb-lsu-driver-headcover-2e803f.webp"],
  // sb lsu flask
  ["https://static.shopmy.us/pins/zoom-108628018-1795247257926-LSU_Flask_Primary_LowRes.jpg", "sb-lsu-flask-4354f0.webp"],
  // yeti crossroads 22l backpack, alpine brown
  ["https://static.shopmy.us/uploads/pretty-prod-1758467247287", "yeti-crossroads-22l-alpine-brown-468ab3.webp"],
]);

/** The photo to show for `image`: its transparent cutout when one exists, else `image` itself. */
export const cutoutPhoto = (image) => {
  if (typeof image !== "string") return image;
  const file = CUTOUTS_1120.get(image.split("?")[0]);
  return file ? CUTOUT_BASE + file : image;
};
