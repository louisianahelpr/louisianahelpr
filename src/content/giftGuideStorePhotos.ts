/**
 * One product photo per store for the deals days' code and sale cards (owner 2026-11-21: "like Muck Boot show a Muck
 * Boot picture like the rest of the guides"). Each is a real product from that store's own site, cut out (no
 * background: owner 11-20) and saved as a local ~400px WebP under public/gift-guides/deals/stores/. The source of every
 * photo is in scripts/gift-guide-store-photos.json. A store missing here shows its name in the photo well: we never
 * invent a photo. Amazon photos are never used (Amazon Associates rules).
 */
const DIR = "/gift-guides/deals/stores/";

/** Store name (exactly as the codes and sales spell it) -> its photo's file name. */
export const STORE_PHOTO_FILES: Record<string, string> = {
  "At Home": "at-home.webp",
  "Aurate": "aurate.webp",
  "Belk": "belk.webp",
  "Bon Wellness": "bon-wellness.webp",
  "Bonheur Jewelry": "bonheur-jewelry.webp",
  "Bonobos": "bonobos.webp",
  "Bruno Marc": "bruno-marc.webp",
  "Camp Snap": "camp-snap.webp",
  "Champs Sports": "champs-sports.webp",
  "Club Recess": "club-recess.webp",
  "Daily Crunch Snacks": "daily-crunch-snacks.webp",
  "Dolce Vita": "dolce-vita.webp",
  "Durango Boots": "durango-boots.webp",
  "Everyday Dose": "everyday-dose.webp",
  "Fabrique": "fabrique.webp",
  "Foot Locker": "foot-locker.webp",
  "Georgia Boot": "georgia-boot.webp",
  "Hanna Andersson": "hanna-andersson.webp",
  "Homage": "homage.webp",
  "Journeys": "journeys.webp",
  "Kevin Murphy": "kevin-murphy.webp",
  "Kids Foot Locker": "kids-foot-locker.webp",
  "Magnifique": "magnifique.webp",
  "Muck Boot": "muck-boot.webp",
  "Nordstrom": "nordstrom.webp",
  "PUMA": "puma.webp",
  "PetSmart": "petsmart.webp",
  "Petite Plume": "petite-plume.webp",
  "RMS Beauty": "rms-beauty.webp",
  "Ring": "ring.webp",
  "Ring Concierge": "ring-concierge.webp",
  "Sally Beauty": "sally-beauty.webp",
  "SharkNinja": "sharkninja.webp",
  "T3 Micro": "t3-micro.webp",
  "Thrive Creative": "thrive-creative.webp",
  "Tushbaby": "tushbaby.webp",
  "Ulta Beauty": "ulta-beauty.webp",
  "Under Armour": "under-armour.webp",
  "Victoria's Secret": "victorias-secret.webp",
  "XTRATUF": "xtratuf.webp",
  "YVO Warrior": "yvo-warrior.webp",
};

/** The store's photo path, or null when we have none. */
export const storePhoto = (store: string): string | null => (STORE_PHOTO_FILES[store] ? DIR + STORE_PHOTO_FILES[store] : null);
