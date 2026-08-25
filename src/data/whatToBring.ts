/**
 * What-to-bring checklists keyed by `jobs.category` enum value.
 *
 * Each entry is a short, opinionated list of tools / supplies a helper
 * typically wants on hand for that category. This is purely informational
 * — it surfaces on the helper's accepted-job card to reduce "showed up
 * under-prepared" failures. It is NOT a contract, NOT validated server-
 * side, and NOT used in any pricing or matching logic.
 *
 * Louisiana-warm tone: yes, every category gets a water bottle. It's hot
 * 9 months of the year here and helpers regret leaving theirs in the
 * truck.
 *
 * Categories without a curated list are intentionally omitted — the UI
 * renders NOTHING for missing keys rather than an empty card.
 *
 * Keys here MUST match the `job_category` Postgres enum values shipped
 * in `src/integrations/supabase/types.ts` (cleaning, yard_work, moving,
 * errands, handyman, painting, delivery, pet_care, assembly, other).
 */
const WHAT_TO_BRING: Record<string, readonly string[]> = {
  cleaning: [
    "Rubber gloves",
    "Microfiber cloths",
    "All-purpose cleaner (in case the poster's run out)",
    "Closed-toe shoes",
    "Water bottle",
  ],
  yard_work: [
    "Work gloves",
    "Closed-toe shoes / boots",
    "Sun hat or cap",
    "Bug spray (it's Louisiana)",
    "Sunscreen",
    "Water bottle — fill it twice",
  ],
  moving: [
    "Closed-toe shoes",
    "Work gloves",
    "Back-support belt if you've got one",
    "Moving straps or a dolly if you own one",
    "Water bottle",
  ],
  errands: [
    "Reusable shopping bags",
    "A clean phone for receipts + nav",
    "Cash float in case of card trouble",
    "Water bottle",
  ],
  handyman: [
    "Cordless drill + driver bits",
    "Tape measure",
    "Level",
    "Phillips + flat-head screwdrivers",
    "Headlamp or small flashlight",
    "Safety glasses",
    "Water bottle",
  ],
  painting: [
    "Drop cloths",
    "Painter's tape",
    "2\" and 3\" brushes + a roller",
    "Old clothes you don't mind ruining",
    "Step ladder if the job's interior trim or ceilings",
    "Water bottle",
  ],
  delivery: [
    "Moving straps or a dolly if the item is heavy",
    "Furniture blanket / pad to prevent scuffs",
    "Bungee cords or rope to secure the load",
    "Closed-toe shoes",
    "Water bottle",
  ],
  pet_care: [
    "Spare leash (in case theirs snaps)",
    "Treats (ask the owner what's okay first)",
    "Poop bags",
    "A small towel for muddy paws",
    "Water for the dog AND for you",
  ],
  assembly: [
    "Phillips + flat-head screwdriver",
    "Allen wrench / hex key set",
    "Rubber mallet",
    "Small flashlight or headlamp",
    "Box cutter for packaging",
    "Water bottle",
  ],
} as const;

/**
 * Resolve the checklist for a job's category. Returns `null` when the
 * category has no curated list — callers should render nothing in that
 * case rather than an empty card.
 */
export function getWhatToBring(category: string | null | undefined): readonly string[] | null {
  if (!category) return null;
  const list = WHAT_TO_BRING[category];
  return list && list.length > 0 ? list : null;
}
