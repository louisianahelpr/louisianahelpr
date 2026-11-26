/**
 * One product photo per store for the deals days' code and sale cards (owner 2026-11-21: "like Muck Boot show a Muck
 * Boot picture like the rest of the guides"). Each is a real product from that store's own site, cut out (no
 * background: owner 11-20) and saved as a local ~400px WebP under public/gift-guides/deals/stores/. The source of every
 * photo is in scripts/gift-guide-store-photos.json. A store whose sales are store-wide shows the brand's clean logo
 * instead (owner 11-22 #10: "for sales some things are missing pictures"; every deals-day card has a picture, guarded by
 * src/test/giftGuideDealCardsHavePhotos1122.test.ts). We never invent a photo. Amazon photos are never used (Amazon
 * Associates rules).
 */
import { slugify } from "@/lib/goLinks.mjs";

const DIR = "/gift-guides/deals/stores/";

/** Store slug (slugify of the name the codes and sales spell, as the store-<slug> page ids do) -> its photo's file name. */
export const STORE_PHOTO_FILES: Record<string, string> = {
  "anthropologie": "anthropologie.webp",
  "at-home": "at-home.webp",
  "aurate": "aurate.webp",
  "belk": "belk.webp",
  "benefit-cosmetics": "benefit-cosmetics.webp",
  "bergdorf-goodman": "bergdorf-goodman.webp",
  "bloomingdales": "bloomingdales.webp",
  "bon-wellness": "bon-wellness.webp",
  "bonheur-jewelry": "bonheur-jewelry.webp",
  "bonobos": "bonobos.webp",
  "bruno-marc": "bruno-marc.webp",
  "cb2": "cb2.webp",
  "camp-snap": "camp-snap.webp",
  "champs-sports": "champs-sports.webp",
  "club-recess": "club-recess.webp",
  "daily-crunch-snacks": "daily-crunch-snacks.webp",
  "dolce-vita": "dolce-vita.webp",
  "dream-pairs": "dream-pairs.webp",
  "dsw": "dsw.webp",
  "durango-boots": "durango-boots.webp",
  "everyday-dose": "everyday-dose.webp",
  "fabrique": "fabrique.webp",
  "famous-footwear": "famous-footwear.webp",
  "foot-locker": "foot-locker.webp",
  "georgia-boot": "georgia-boot.webp",
  "hanna-andersson": "hanna-andersson.webp",
  "homage": "homage.webp",
  "journeys": "journeys.webp",
  "keurig": "keurig.webp",
  "kevin-murphy": "kevin-murphy.webp",
  "kids-foot-locker": "kids-foot-locker.webp",
  "kitchenaid": "kitchenaid.webp",
  "lands-end": "lands-end.webp",
  "macys": "macys.webp",
  "magnifique": "magnifique.webp",
  "muck-boot": "muck-boot.webp",
  "neiman-marcus": "neiman-marcus.webp",
  "nordstrom": "nordstrom.webp",
  "oriental-trading-company": "oriental-trading-company.webp",
  "patchmd": "patchmd.webp",
  "perelel": "perelel.webp",
  "perk-energy": "perk-energy.webp",
  "puma": "puma.webp",
  "petsmart": "petsmart.webp",
  "petite-plume": "petite-plume.webp",
  "rms-beauty": "rms-beauty.webp",
  "ring": "ring.webp",
  "ring-concierge": "ring-concierge.webp",
  "saks-fifth-avenue": "saks-fifth-avenue.webp",
  "sally-beauty": "sally-beauty.webp",
  "sams-club": "sams-club.webp",
  "scheels": "scheels.webp",
  "sharkninja": "sharkninja.webp",
  "t3-micro": "t3-micro.webp",
  "the-home-depot": "the-home-depot.webp",
  "the-mens-wearhouse": "the-mens-wearhouse.webp",
  "thrive-creative": "thrive-creative.webp",
  "tushbaby": "tushbaby.webp",
  "ulta-beauty": "ulta-beauty.webp",
  "under-armour": "under-armour.webp",
  "universal-standard": "universal-standard.webp",
  "victorias-secret": "victorias-secret.webp",
  "xtratuf": "xtratuf.webp",
  "yvo-warrior": "yvo-warrior.webp",
  "zappos": "zappos.webp",
};

/** The store's photo path, or null when we have none. */
export const storePhoto = (store: string): string | null => {
  const file = STORE_PHOTO_FILES[slugify(store)];
  return file ? DIR + file : null;
};
