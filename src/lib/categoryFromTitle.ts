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
