// categorySkillMatch — does a Helpr's saved skill name a job's category? (Q1832)
//
// ZERO imports, so the edge functions and vitest both load the real module.
//
// profiles.skills is ONE comma-separated string of the LABELS ProfileEditForm's
// skill chips save ("Yard Work", "Pet Care", "Auto & Small Engine", plus the
// chip wording "Moving Help" / "Event Help"); older profiles may hold the raw
// enum value ("yard_work"). jobs.category is the job_category enum value.
// instant-job-match compared the two with a bare substring test, and an
// underscore value never contains a spaced label, so a "Yard Work" Helpr never
// scored the skill match on a yard_work job (single-word categories like
// "plumbing" matched by luck).
//
// CATEGORY_LABELS mirrors src/lib/jobCategories.ts JOB_CATEGORY_LABELS and
// SKILL_CHIP_LABELS mirrors its skillChipLabel(); src/test/edge/
// instant-job-match.test.ts fails if either drifts, and proves the match for
// every category.

export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  cleaning: "Cleaning",
  yard_work: "Yard Work",
  handyman: "Handyman",
  moving: "Moving",
  errands: "Errands",
  delivery: "Delivery",
  pet_care: "Pet Care",
  assembly: "Assembly",
  painting: "Painting",
  storm_prep: "Storm Prep",
  events: "Events",
  electrical: "Electrical",
  plumbing: "Plumbing",
  hvac: "HVAC",
  roofing: "Roofing",
  welding: "Welding",
  carpentry: "Carpentry",
  auto_repair: "Auto & Small Engine",
  appliance_repair: "Appliance Repair",
  flooring: "Flooring & Tile",
  concrete_masonry: "Concrete & Masonry",
  fencing: "Fencing",
  pressure_washing: "Pressure Washing",
  other: "Other",
};

/** The chip wording a skill is saved under when it differs from the category label. */
export const SKILL_CHIP_LABELS: Readonly<Record<string, string>> = {
  moving: "Moving Help",
  events: "Event Help",
};

/** Lowercase, "_" and "&" to spaces, whitespace collapsed. */
function normalizeSkillText(s: string): string {
  return s.toLowerCase().replace(/[_&]/g, " ").replace(/\s+/g, " ").trim();
}

/** Every spelling a saved skill can use for this category, normalized. */
function categoryTerms(category: string): string[] {
  const terms = [category, CATEGORY_LABELS[category] ?? "", SKILL_CHIP_LABELS[category] ?? ""]
    .map(normalizeSkillText)
    .filter(Boolean);
  return [...new Set(terms)];
}

/**
 * True when the saved skill names the category: either side contains the other
 * once both are normalized (so "Moving Help" names moving, "plumbing" names
 * plumbing). An empty skill names nothing.
 */
export function skillMatchesCategory(skill: string, category: string): boolean {
  const s = normalizeSkillText(skill);
  if (!s) return false;
  return categoryTerms(category).some((t) => t.includes(s) || s.includes(t));
}
