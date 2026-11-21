-- Short names skip a suffix and any bracketed text (Jobs audit 11-21, G9).
--
-- WHAT WAS BROKEN. member_display_name (20261021131322) took the LAST word's first letter, so a name
-- suffix became the initial. Measured on prod 2026-11-21 with a read-only SELECT of the live function:
--   'John Smith Jr.'                                   -> 'John J.'
--   'Tremaine Broussard II'                            -> 'Tremaine I.'
--   'Mary Ann Landry Sr'                               -> 'Mary S.'
--   'Jean-Baptiste Émile Arceneaux-Thibodeaux III'     -> 'Jean-Baptiste I.'
--   'Jean-Baptiste (Seed 16)'                          -> 'Jean-Baptiste 1.'
-- Counted the same day: 0 prod profiles end in a suffix word today and 46 (all is_seed) carry bracketed
-- text; suffixes are common in Louisiana, so the next real one would be shown to posters wrongly.
--
-- FIX. One rule, the same in all three copies (formatName in src/lib/utils.ts, memberDisplayName in
-- supabase/functions/_shared/memberDisplayName.ts, and this function):
--  1. trim and split on formatName's exact whitespace set, as before (written out, never the locale's \s);
--  2. the FIRST word is kept exactly as before; in the words after it, bracketed text "(...)" is dropped;
--  3. no word left after the first -> the first word alone; else the first word, a space, and the first
--     letter of the LAST later word that is not a suffix (Jr, Sr, II, III, IV, V, with an optional '.'
--     and ','), or of the last later word when every one is a suffix (so "John Jr" stays "John J." and
--     the rule is idempotent: "John S." -> "John S.", "Mary V." -> "Mary V.").
-- So the output never shows more of a name than before: the same first word, and at most one letter.
-- (lh-authz-rls review of the first draft: dropping brackets BEFORE the split turned "(Jane) Landry"
-- into "Landry", the surname in the whole-word slot. The first word is now never touched.)
-- Every other input gives exactly what it gave before (proof: src/test/pglite/memberDisplayNameSuffix.pglite.mjs).
-- display_name_for_viewer and every reader call this function, so they all follow with no change.
--
-- REPLAY-SAFETY: CREATE OR REPLACE of a function 20261021061341 defines, same signature, return type,
-- language, volatility and parallel safety; the grants are restated as prod's proacl has them
-- (postgres, authenticated, service_role; measured 2026-11-21).

CREATE OR REPLACE FUNCTION public.member_display_name(p_full_name text, p_fallback text DEFAULT 'A neighbor')
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT CASE
           WHEN v.t = '' THEN p_fallback
           -- One word, or every word after the first was bracketed: the first word alone.
           WHEN cardinality(r.rest) = 0 THEN v.parts[1]
           ELSE v.parts[1] || ' ' || left(coalesce(
                  (SELECT u.w FROM unnest(r.rest) WITH ORDINALITY AS u(w, i)
                    WHERE u.w !~* '^(jr|sr|ii|iii|iv|v)\.?,?$'
                    ORDER BY u.i DESC LIMIT 1),
                  r.rest[cardinality(r.rest)]), 1) || '.'
         END
    FROM (SELECT x.t,
                 regexp_split_to_array(x.t, '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+') AS parts
            FROM (SELECT regexp_replace(coalesce(p_full_name, ''),
                                        '^[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$',
                                        '', 'g') AS t) x) v
    -- The words after the first, brackets dropped. The first word is never changed (lh-authz-rls review: dropping a
    -- leading "(Jane)" would have put the surname in the first, whole-word slot).
    CROSS JOIN LATERAL (SELECT array_remove(regexp_split_to_array(
                                 regexp_replace(array_to_string(v.parts[2:], ' '), '\([^)]*\)', ' ', 'g'), ' +'), '') AS rest) r
$fn$;
REVOKE ALL ON FUNCTION public.member_display_name(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_display_name(text, text) TO authenticated, service_role;
