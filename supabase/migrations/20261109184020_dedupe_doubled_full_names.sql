-- F085 (owner UI audit 11-09; owner decision 11-09: "fix the 3 doubled names").
--
-- Three members typed their whole name into both the First and Last boxes at sign-up, and sign-up joined the two
-- blindly, so profiles.full_name was stored as the name said twice ("Annette Washum Annette Washum"). The admins'
-- new-member summary printed it that way. The client now builds full_name with joinName (src/lib/splitName.ts), which
-- never repeats a name; this data fix stores those three names once.
--
-- Measured on prod 11-09 (read-only): 3 of 349 profiles match. The rule is deliberately narrow: ONLY a full_name that
-- is exactly a name of two or more words, one space, then the same name again ("X Y X Y" -> "X Y"). A one-word name
-- said twice ("Mary Mary") and any near-repeat ("John Johnson", "Ann Annette") are left alone. Nothing else on the
-- row is written (profiles has no separate first/last name columns); the updated_at trigger stamps the change.
--
-- REPLAY-SAFE: a row it fixed no longer matches, so a second run changes nothing; guarded on the table existing.
DO $do$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.profiles
     SET full_name = substring(full_name FROM '^(\S+(?: \S+)+) \1$')
   WHERE full_name ~ '^(\S+(?: \S+)+) \1$';
END
$do$;
