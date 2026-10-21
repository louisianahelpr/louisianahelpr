-- Lead ruling 2026-10-21 (after ready/builder2h-jobs-10 made category and skill-chip labels sentence case): a
-- member's SAVED skills keep the old Title Case chip words ("Yard Work", "Moving Help"), so one profile could read
-- "Yard Work, Pet care". This one-time rewrite changes only the display text of those exact chip words to the
-- sentence-case ones. Measured on prod 2026-10-21 (read-only): 2 of the 3 profiles with skills carry one.
--
-- profiles.skills is a comma-separated text. A word is rewritten only when it is a WHOLE item that equals an old
-- chip label exactly (case-sensitive); free-text skills a member typed ("Yard Work and more") are never touched.
-- Matching is unaffected either way: job matching lower-cases both sides (_shared/categorySkillMatch.ts) and the
-- profile editor selects case-insensitively.
-- Idempotent: the new words never match an old one, so a second run changes nothing.
-- Proof: node src/test/pglite/skillsSentenceCase.pglite.mjs (red without the file, 3x apply).
DO $skills$
DECLARE
  pair text[];
  pairs text[][] := ARRAY[
    ARRAY['Yard Work', 'Yard work'],
    ARRAY['Declutter Help', 'Declutter help'],
    ARRAY['Pet Care', 'Pet care'],
    ARRAY['Storm Prep', 'Storm prep'],
    ARRAY['Auto & Small Engine', 'Auto & small engine'],
    ARRAY['Appliance Repair', 'Appliance repair'],
    ARRAY['Flooring & Tile', 'Flooring & tile'],
    ARRAY['Concrete & Masonry', 'Concrete & masonry'],
    ARRAY['Pressure Washing', 'Pressure washing'],
    ARRAY['Moving Help', 'Moving help'],
    ARRAY['Event Help', 'Event help']
  ];
  v_rows int;
BEGIN
  FOREACH pair SLICE 1 IN ARRAY pairs LOOP
    UPDATE public.profiles
       SET skills = regexp_replace(
             skills,
             '(^|,)(\s*)' || regexp_replace(pair[1], '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '(\s*)(?=,|$)',
             -- A bare "&" is literal in a PostgreSQL replacement (only "\&" means the whole match).
             '\1\2' || pair[2] || '\3',
             'g')
     WHERE skills ~ ('(^|,)\s*' || regexp_replace(pair[1], '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\s*(,|$)');
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RAISE NOTICE 'skills sentence case: % -> % on % profile(s)', pair[1], pair[2], v_rows;
  END LOOP;
END
$skills$;
