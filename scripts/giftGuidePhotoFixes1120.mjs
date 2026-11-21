/**
 * WRONG PHOTOS (photo review 11-20, ~/.lh-shots/holiday-audit-1120/PHOTO-findings.md, "wrong-product", Highs): every
 * gift guide photo was viewed and these show something other than the product named (a brand logo, another product,
 * another brand, another colour). Matched on the photo's URL without its query string.
 *   - a URL value: the product's own photo from the maker's product page (checked by eye 11-20), shown instead;
 *   - "": no right photo is in hand, so the photo is dropped. NO PHOTO, NO ROW then takes the pick off the page until
 *     a right photo exists; a wrong photo is worse than a missing pick (owner 11-20: "correct pictures").
 * Amazon photos are never edited (Associates), only dropped here: each of these is the wrong product's photo.
 */
export const WRONG_PHOTOS_1120 = new Map([
  // A brand logo where the product belongs: the maker's own product shot.
  ["https://mantasleep.com/cdn/shop/files/manta_seo.png", "https://cdn.shopify.com/s/files/1/1582/3265/products/Manta-PRO-Buy-Box-1.png?v=1636380988"],
  ["https://cdn.shopify.com/s/files/1/0060/9982/8802/files/Webp.net-resizeimage_1_827c0eee-5b50-4271-9658-e919e73bec43.jpg", "https://cdn.shopify.com/s/files/1/0060/9982/8802/files/MarbleTushbabyandblacksnug3.webp?v=1762200997"],
  ["https://crew-dog.com/cdn/shop/files/Copy_of_Untitled_Design_1_22c48a21-66c4-494b-9224-d372312a73d3.png", "https://cdn.shopify.com/s/files/1/0723/4584/6077/files/LSULandscapeEMB_crewneck_CrewneckClay_center.png?v=1794194165"],
  // lululemon Men's Zeroed In Linerless Short 7": a plain black T-shirt.
  ["https://static.shopmy.us/uploads/pretty-prod-1786696032941", ""],
  // UGG Disquette Heritage Slippers: a cropped close-up of three different UGG shoes on a wood floor.
  ["https://images.urbndata.com/is/image/Anthropologie/108979261_025_b14", ""],
  // Meri Meri Nutcracker Gift Tags: the Maisonette store logo.
  ["https://static.shopmy.us/pins/zoom-107826257-1795111508033-mid409239_1548270053.jpg", ""],
  // Hunter Original Short Rain Boots Yellow: a dark green Hunter Play wedge boot.
  ["https://m.media-amazon.com/images/I/61LQC7BUmDL._AC_SL500_.jpg", ""],
  // Charlotte Tilbury Airbrush Bronzer: a bare refill pan, a flat brown circle.
  ["https://static.shopmy.us/pins/zoom-107883478-1795117235715-Refill_AFF_Bronzer_Medium.png", ""],
  // Stanley Quencher Tumbler: the Farm Rio ornament set's gift box.
  ["https://www.stanley1913.com/cdn/shop/files/Web_PNG_Square-The_Quencher_Flowstate_Ornament_Set_PACKAGING-NoCapacity-Farm_Rio_Multi-Hero.png", ""],
  // Sockwell Women's Plantar Ease Socks: a night splint and a massage ball.
  ["https://m.media-amazon.com/images/I/71hraa-ScmL._AC_SL500_.jpg", ""],
  // The Mayfair Group You Are Safe Here Zip-Up Hoodie: a different crewneck, on a model.
  ["https://static.shopmy.us/uploads/img-product-1792102389656", ""],
  // Fanatics New Orleans Saints Men's Defender Evo hoodie: a women's zebra-stripe hoodie, on a model.
  ["https://m.media-amazon.com/images/I/81f7e9GsgwL.jpg", ""],
  // Costa Farms Snake Plant: a rubber plant.
  ["https://m.media-amazon.com/images/I/71RPsSnVJCL._AC_SL500_.jpg", ""],
  // Southern Marsh Backroads Louisiana Tee: the Tennessee tee.
  ["https://m.media-amazon.com/images/I/81eC4XytU1L._AC_SL1500_.jpg", ""],
]);

/** The photo to show for `image`: its right photo, undefined when the wrong photo is dropped, or `image` itself. */
export const rightPhoto = (image) => {
  if (typeof image !== "string") return image;
  const fix = WRONG_PHOTOS_1120.get(image.split("?")[0]);
  return fix === undefined ? image : fix || undefined;
};
/** True when `image` is a wrong photo with no replacement: the pick shows no photo at all, not a fallback one. */
export const droppedPhoto = (image) => typeof image === "string" && WRONG_PHOTOS_1120.get(image.split("?")[0]) === "";
