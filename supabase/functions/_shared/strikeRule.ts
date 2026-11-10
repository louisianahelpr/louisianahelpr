/**
 * F466/F502 (whole-app audit 11-10, lead confirmed): the ONE wording of the strike rules, used by every member strike
 * email and push. The enforcement code applies two ladders side by side, and this states exactly what each does:
 *   - strikes from our team: admin-user-actions formal_warning (count of warning/final_warning rows; 3rd = 7 days);
 *   - automatic flags: public.auto_restrict_repeat_violators (own types, last 7 days; 2nd = 7 days, 3rd = 30 days).
 * The same two sentences are written verbatim into that trigger's member notices
 * (supabase/migrations/20261110200605_strike_rule_one_wording.sql); src/test/strikeRuleOneWording.test.ts checks
 * both copies match byte for byte. No apostrophes, so the SQL copy needs no escaping.
 */
export const STRIKE_RULE =
  'Strikes from our team: the 1st is a warning, the 2nd is a final warning, and the 3rd suspends your account for 7 days. Automatic flags from our system, counted over 7 days: the 1st is a final warning, the 2nd suspends your account for 7 days, and the 3rd suspends it for 30 days.'
