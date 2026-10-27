/**
 * The Helpr Guarantee's windows and limits (Q2450), the same numbers as guarantee_rules() in
 * supabase/migrations/20261027200455_helpr_guarantee.sql. No imports: the Terms page reads it without the
 * Supabase client.
 */
export const GUARANTEE_RULES = {
  claimWindowHours: 48,
  posterAnswerHours: 48,
  fixWithinDays: 3,
  maxPhotos: 6,
  noteMin: 15,
  noteMax: 1000,
} as const;
