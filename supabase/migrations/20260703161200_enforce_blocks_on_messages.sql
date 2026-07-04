-- F-TRUST-01: blocking a user hid them client-side but nothing stopped a
-- blocked user from inserting messages directly (the INSERT policy only
-- checks auth.uid() = sender_id). are_users_blocked() (20260418053532) has
-- existed since April but was never wired into any write path. Enforce it
-- server-side with a BEFORE INSERT trigger on messages.
--
-- Service-role inserts (system/lifecycle messages from edge functions,
-- auth.uid() IS NULL) are exempt — the guard targets user-initiated sends.

CREATE OR REPLACE FUNCTION public.enforce_block_on_message_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.are_users_blocked(NEW.sender_id, NEW.receiver_id) THEN
    RAISE EXCEPTION 'You can''t message this user.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_block_on_message_insert ON public.messages;
CREATE TRIGGER trg_enforce_block_on_message_insert
  BEFORE INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_block_on_message_insert();
