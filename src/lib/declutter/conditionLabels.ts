/**
 * The one name per condition (stars 1-5) everywhere in Declutter. No React here, so a Browse card can read it without
 * loading declutterUi's screens; declutterUi.tsx re-exports it.
 */
export const CONDITION_LABEL: Record<number, string> = {
  5: "Like new",
  4: "Lightly used",
  3: "Used, some wear",
  2: "Heavy wear or a fault",
  1: "For parts or repair",
};
