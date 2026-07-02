import { Award, BadgeCheck, Users2 } from "lucide-react";

export const categories = [
  { value: "cleaning", label: "Cleaning" },
  { value: "yard_work", label: "Yard Work" },
  { value: "moving", label: "Moving" },
  { value: "errands", label: "Errands" },
  { value: "handyman", label: "Handyman" },
  { value: "painting", label: "Painting" },
  { value: "delivery", label: "Delivery" },
  { value: "pet_care", label: "Pet Care" },
  { value: "assembly", label: "Assembly" },
  { value: "storm_prep", label: "Storm" },
  { value: "other", label: "Other" },
];

export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 1000;

// Categories where credential-tier requirements make sense (trade work).
// All others default to tier 0 (open) with the selector hidden.
export const CREDENTIAL_TIER_CATEGORIES = new Set([
  "handyman",
  "painting",
  "moving",
  "assembly",
]);

// The tier options rendered in the "Who can apply?" segmented control.
// No "ID-Verified" tier: every helper accepted for a job is already
// ID-verified, so it would never actually narrow the applicant pool.
// The only meaningful gates for trade work are licensing and insurance.
export const CREDENTIAL_TIERS = [
  { value: 0, label: "Open", sub: "Anyone can apply", Icon: Users2 },
  { value: 2, label: "Licensed", sub: "Licensed pros only", Icon: Award },
  { value: 3, label: "Licensed + Insured", sub: "Licensed & insured", Icon: BadgeCheck },
] as const;

// Category-specific title placeholders — once the poster picks a
// category the example title matches what they're actually posting,
// which both speeds entry and models a good, specific title.
export const titlePlaceholders: Record<string, string> = {
  cleaning: "e.g. Deep clean a 2-bedroom apartment",
  yard_work: "e.g. Mow & edge the front and back yard",
  moving: "e.g. Help me move a couch up two flights",
  errands: "e.g. Grocery run and a pharmacy pickup",
  handyman: "e.g. Mount a TV and hide the cables",
  painting: "e.g. Paint a 12×12 bedroom, one coat",
  delivery: "e.g. Pick up a dresser and drop it off",
  pet_care: "e.g. Walk my dog twice a day this week",
  assembly: "e.g. Assemble an IKEA wardrobe",
  storm_prep: "e.g. Board up windows before the storm",
  other: "e.g. Help me with a quick job",
};

// Category-specific description prompts — tells the poster what detail
// a helpr needs to quote accurately. Vague posts get fewer applicants.
export const descriptionHints: Record<string, string> = {
  cleaning: "Mention square footage, number of rooms, supplies on hand, and parking or access.",
  yard_work: "Mention yard size, what needs doing, and whether tools and bags are provided.",
  moving: "Mention what's being moved, stairs or elevator, distance, and any heavy items.",
  errands: "List the stops, anything time-sensitive, and how purchases get paid for.",
  handyman: "Describe the fix, what parts/tools you already have, and any specific skill needed.",
  painting: "Mention the area, surface condition, whether paint is provided, and number of coats.",
  delivery: "Mention pickup and drop-off addresses, item size, and whether a truck is needed.",
  pet_care: "Mention pet type and temperament, the schedule, and any feeding or medication.",
  assembly: "Mention the item(s), whether you have the manual, and what tools are available.",
  storm_prep: "Describe what needs doing (boarding, debris, generator setup, etc.), the timeline, and any materials or equipment you already have.",
  other: "Add anything a Helpr needs to quote accurately — access, timing, and supplies.",
};
