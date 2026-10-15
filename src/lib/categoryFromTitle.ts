/**
 * Best-guess category match from a free-text job title.
 *
 * Used by Post-a-Task to pre-pick a category after the user pauses
 * typing the title. The result is treated as a soft suggestion: the
 * UI shows a tiny "Auto-selected from title — tap to change" pill so
 * a wrong guess can be corrected in one tap.
 *
 * Matching is intentionally simple — a short keyword→category table.
 * No ML, no fuzzy matching. False positives are bad here (silently
 * miscategorising someone's post is worse than the user picking
 * themselves), so we only fire when a keyword is a clean word match.
 */

/** Keyword (lower-case word, matched word-boundary) → category slug. */
const KEYWORD_TO_CATEGORY: Array<[RegExp, string]> = [
  // ── Trades (T1, 2026-10-14) ── FIRST, because first match wins and a trade
  // word is more specific than the generic "fix"/"repair"/"clean" below.
  // Each pattern names the TRADE, not an object: "move a fridge" stays
  // moving, "mop the floor" stays cleaning, "paint the fence" stays painting.
  [/\b(?:pressure|power)\s*wash(?:ing|er)?\b/i, "pressure_washing"],
  [/\belectric(?:al|ian)\b/i, "electrical"],
  [/\b(?:outlets?|rewir(?:e|ing)|wiring|breaker\s*(?:box|panel)?)\b/i, "electrical"],
  [/\bplumb(?:ing|er)\b/i, "plumbing"],
  [/\b(?:faucet|toilet|water\s*heater|unclog|clogged)\b/i, "plumbing"],
  [/\b(?:leak(?:y|ing)?)\s+(?:pipe|sink|faucet)\b/i, "plumbing"],
  [/\b(?:hvac|furnace|heat\s*pump|ductwork|air\s*condition(?:er|ing))\b/i, "hvac"],
  [/\ba\/?c\s+(?:unit|repair|service|install|not\s+cooling)\b/i, "hvac"],
  [/\b(?:roof(?:ing|er)?|shingles?)\b/i, "roofing"],
  [/\bweld(?:ing|er)?\b/i, "welding"],
  [/\b(?:carpent(?:ry|er)|trim\s*carpentry|cabinets?|deck\s*(?:build|repair|boards?))\b/i, "carpentry"],
  [/\b(?:mechanic|oil\s*change|brake\s*(?:pads?|job)|small\s*engine|carburet(?:or|tor)|mower\s*repair)\b/i, "auto_repair"],
  [/\b(?:car|auto|truck)\s+(?:repair|maintenance)\b/i, "auto_repair"],
  [/\bappliance\s*repair\b/i, "appliance_repair"],
  [/\b(?:fix|repair)\s+(?:my\s+|the\s+|a\s+|our\s+)?(?:washer|dryer|dishwasher|fridge|refrigerator|freezer|oven|stove|microwave)\b/i, "appliance_repair"],
  [/\b(?:washer|dryer|dishwasher|fridge|refrigerator|freezer|oven|stove|microwave)\s+(?:repair|fix)\b/i, "appliance_repair"],
  [/\b(?:flooring|retil(?:e|ing)|grout\s*repair)\b/i, "flooring"],
  [/\b(?:install|lay|replace)\s+(?:\w+\s+)?(?:tile|tiles|floor|floors|laminate|hardwood|carpet)\b/i, "flooring"],
  [/\b(?:concrete|masonry|mason|brick\s*(?:work|wall|repair)|bricklay(?:ing|er))\b/i, "concrete_masonry"],
  [/\bfencing\b/i, "fencing"],
  [/\b(?:install|repair|build|replace|fix)\s+(?:a\s+|the\s+|my\s+|our\s+)?(?:\w+\s+)?fence\b/i, "fencing"],
  [/\bfence\s+(?:install|repair|posts?|build)\b/i, "fencing"],

  // yard / lawn
  [/\bmow(?:ing|er)?\b/i, "yard_work"],
  [/\blawn\b/i, "yard_work"],
  [/\byard\b/i, "yard_work"],
  [/\bedge\b/i, "yard_work"],
  [/\bleaves?\b/i, "yard_work"],
  [/\brake\b/i, "yard_work"],
  [/\btrim(?:ming)?\b/i, "yard_work"],
  [/\blandscap(?:e|ing)\b/i, "yard_work"],
  [/\bgarden(?:ing)?\b/i, "yard_work"],
  [/\bhedge\b/i, "yard_work"],

  // cleaning
  [/\bclean(?:ing|er)?\b/i, "cleaning"],
  [/\btidy\b/i, "cleaning"],
  [/\bvacuum\b/i, "cleaning"],
  [/\bmop(?:ping)?\b/i, "cleaning"],
  [/\bhousekeep(?:ing|er)?\b/i, "cleaning"],
  [/\bdust(?:ing)?\b/i, "cleaning"],
  [/\bscrub\b/i, "cleaning"],

  // moving
  [/\bmove(?:r|rs)?\b/i, "moving"],
  [/\bmoving\b/i, "moving"],
  [/\bhaul\b/i, "moving"],
  [/\bcouch\b/i, "moving"],
  [/\bfurniture\b/i, "moving"],

  // errands
  [/\berrand(?:s)?\b/i, "errands"],
  [/\bgrocer(?:y|ies)\b/i, "errands"],
  [/\bshop(?:ping)?\b/i, "errands"],
  [/\bpharmac(?:y|ies)\b/i, "errands"],

  // handyman / repair
  [/\bfix\b/i, "handyman"],
  [/\brepair\b/i, "handyman"],
  [/\bmount\b/i, "handyman"],
  [/\bdrill\b/i, "handyman"],
  [/\binstall\b/i, "handyman"],
  [/\bhand(?:y|yman)\b/i, "handyman"],
  [/\btv\b/i, "handyman"],

  // painting
  [/\bpaint(?:ing|er)?\b/i, "painting"],
  [/\bprime(?:r)?\b/i, "painting"],
  [/\broller\b/i, "painting"],

  // delivery
  [/\bdeliver(?:y|ies)?\b/i, "delivery"],
  [/\bdrop\s*off\b/i, "delivery"],
  [/\bcourier\b/i, "delivery"],
  [/\btransport\b/i, "delivery"],

  // pet care
  [/\bpet\b/i, "pet_care"],
  [/\bdog\b/i, "pet_care"],
  [/\bcat\b/i, "pet_care"],
  [/\bwalk(?:er|ing)?\b/i, "pet_care"],
  [/\bfeed\b/i, "pet_care"],
  [/\bsitter\b/i, "pet_care"],
  [/\bboarding\b/i, "pet_care"],

  // assembly
  [/\bassembl(?:e|y|ing)\b/i, "assembly"],
  [/\bikea\b/i, "assembly"],
  [/\bput\s*together\b/i, "assembly"],
  [/\bdresser\b/i, "assembly"],
  [/\bdesk\b/i, "assembly"],

  // storm_prep — hurricane / storm preparation work
  [/\bhurricane\b/i, "storm_prep"],
  [/\bstorm\s*prep\b/i, "storm_prep"],
  [/\bboard(?:ing)?\s*up\b/i, "storm_prep"],
  [/\bshutter(?:ing)?\b/i, "storm_prep"],
  [/\bsandbag\b/i, "storm_prep"],
  [/\bgenerator\s*(?:set|install|hook)\b/i, "storm_prep"],
  [/\bstorm\s*(?:drain|damage|debris|cleanup|clear|ready|prep)\b/i, "storm_prep"],
];

/**
 * Returns the best category slug for the given title, or null when no
 * keyword matched cleanly. The match is the first keyword that hits in
 * declaration order — long, specific words come first so generic
 * fallbacks ("paint") don't beat compound terms ("paint roller").
 */
export function categoryFromTitle(title: string): string | null {
  const trimmed = (title ?? "").trim();
  if (trimmed.length < 3) return null;
  for (const [pattern, category] of KEYWORD_TO_CATEGORY) {
    if (pattern.test(trimmed)) return category;
  }
  return null;
}
