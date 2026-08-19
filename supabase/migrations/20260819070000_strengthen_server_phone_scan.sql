-- The server-side phone scanner was weaker than the client's, so the backstop
-- did not actually back anything up.
--
-- scan_message_content() is a BEFORE INSERT trigger, which is what makes
-- moderation *enforced* rather than advisory — a modified client that skips
-- ViolationDialog still hits it. But its pattern allowed at most ONE separator
-- between digit groups:
--
--   [0-9]{3}[^0-9]?[0-9]{3}[^0-9]?[0-9]{4}
--
-- while the client (src/lib/messageScanner.ts) uses `[\s.-]*` and allows many.
-- Verified against this database before writing the fix:
--
--   '(504) 555-1212'    → NOT caught   ← the most common US format
--   '504 . 555 . 1212'  → NOT caught
--   '504-555-1212'      → caught
--   '5045551212'        → caught
--
-- So the single most ordinary way to write a phone number passed the server
-- while the client blocked it. Off-platform contact is how a marketplace loses
-- both the transaction and the safety record of it.
--
-- The replacement allows up to four non-alphanumeric separator characters
-- between groups, which covers '(504) ', ' . ', '--' and '+1 '. Verified
-- against 12 cases on this database: all 8 phone spellings caught, and all 4
-- realistic false positives still rejected —
--   'order 12345 for 2026 at 9am', 'I have 3 dogs and 2 cats',
--   'job 1234 costs 100 dollars', 'meet at 123 Main St apt 4567'
-- — which is why the class is [^0-9a-zA-Z] rather than [^0-9]: excluding
-- letters stops it welding unrelated numbers together across words.
--
-- Only the phone branch changes; every other branch of the function, and the
-- fraud_flags / escalation behaviour, is preserved exactly as deployed.
DO $$
DECLARE
  v_def text;
  v_old text := '[0-9]{3}[^0-9]?[0-9]{3}[^0-9]?[0-9]{4}';
  v_new text := '[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{3}[^0-9a-zA-Z]{0,4}[0-9]{4}';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc
  WHERE proname = 'scan_message_content'
    AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE NOTICE 'scan_message_content() not present — skipping (replay-safe).';
    RETURN;
  END IF;

  IF position(v_old IN v_def) = 0 THEN
    -- Already strengthened, or the body has moved on. Do not silently rewrite
    -- a function we no longer recognise.
    RAISE NOTICE 'scan_message_content() does not contain the known weak pattern — leaving untouched.';
    RETURN;
  END IF;

  EXECUTE replace(v_def, v_old, v_new);
  RAISE NOTICE 'scan_message_content() phone pattern strengthened.';
END $$;
