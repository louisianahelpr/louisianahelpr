/**
 * Job category names for a Spanish reader (design audit r2 #33: the Jobs feed showed "Yard work", "Cleaning"... in
 * Spanish). The English here is JOB_CATEGORY_LABELS (src/lib/jobCategories.ts), restated as plain literals because a
 * dictionary imports nothing but the registry (design audit r2 #1); src/test/designAuditR2.test.ts holds the two
 * equal. Drawn through wordInLang by JobCategoryTab. Spanish: esJobCats.ts.
 */
import { addEnglish } from "./enRegistry";

export const enJobCats = {
  "jc.cleaning": "Cleaning",
  "jc.yard_work": "Yard work",
  "jc.handyman": "Handyman",
  "jc.moving": "Moving",
  "jc.errands": "Errands",
  "jc.declutter_help": "Declutter help",
  "jc.delivery": "Delivery",
  "jc.pet_care": "Pet care",
  "jc.assembly": "Assembly",
  "jc.painting": "Painting",
  "jc.storm_prep": "Storm prep",
  "jc.events": "Events",
  "jc.electrical": "Electrical",
  "jc.plumbing": "Plumbing",
  "jc.hvac": "HVAC",
  "jc.roofing": "Roofing",
  "jc.welding": "Welding",
  "jc.carpentry": "Carpentry",
  "jc.auto_repair": "Auto & small engine",
  "jc.appliance_repair": "Appliance repair",
  "jc.flooring": "Flooring & tile",
  "jc.concrete_masonry": "Concrete & masonry",
  "jc.fencing": "Fencing",
  "jc.pressure_washing": "Pressure washing",
  "jc.other": "Other",
} as const;

addEnglish(enJobCats);
