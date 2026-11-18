/**
 * Design audit 11-17 #15: /fees and /safety were four bare lines on an empty page (a tiny text block in a 1440 page).
 * Their lines sit in the white rounded list card Help uses, in a 672px column, with the title lined up over it (the
 * header column is the card plus the shell's own side padding at each breakpoint, px-5 / sm:px-8 / lg:px-12, as the
 * /hire town pages do). Guard: src/test/feesAndSafetyPages.test.tsx.
 */
export const INFO_COLUMN = "mx-auto max-w-2xl";
export const INFO_HEADER_COLUMN = "mx-auto max-w-[calc(42rem+2.5rem)] sm:max-w-[calc(42rem+4rem)] lg:max-w-[calc(42rem+6rem)]";
export const INFO_CARD_LIST = "divide-y divide-border overflow-hidden rounded-[20px] border border-border bg-card font-sans text-ds-15 leading-relaxed text-foreground";
export const INFO_CARD_ROW = "px-5 py-4 sm:px-6";
