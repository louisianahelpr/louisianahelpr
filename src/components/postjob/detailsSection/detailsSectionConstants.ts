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

// 32, down from 100. A job card gives the title ONE line (line-clamp-1) in a
// ~254px column at the tightest breakpoint — the two-up grid — sharing that row
// with the price chip. Measured against the card's own italic display face:
// 40 still clipped real titles at 35-37 chars, and 32 is where they stop
// clipping ("Board windows ahead of the storm" is exactly 32 and fits).
//
// Enforced at the INPUT, where the poster sees a live n/32 counter and can
// choose their own wording, rather than silently cutting their words later on
// the board. line-clamp-1 stays only as a safety net for rows posted before
// this cap existed.
//
// If this proves too tight in practice, the lever is card LAYOUT, not the cap:
// the title currently yields ~90px of its row to the price chip, so moving the
// price into the meta line below would buy back roughly a third more room.
export const TITLE_MAX = 32;
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

// `descriptionHints` was removed 2026-08-10. It rendered a fixed
// per-category sentence directly above DescriptionField's adaptive
// "Tip:" line, so an empty description showed two serif-italic hints at
// once saying much the same thing. The adaptive one names what is
// actually still missing and self-dismisses, so it won.
