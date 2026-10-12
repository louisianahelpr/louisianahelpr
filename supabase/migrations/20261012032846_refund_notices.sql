-- Q1714 (docs/OPEN.md; owner report 2026-10-12: "was i refunded for mow and
-- weed eat yard? i dont think i got an email that i was refunded").
--
-- One row per refund notice ever sent, keyed on the money movement it is
-- about: 'refund:<Stripe refund id>' or 'release:<PaymentIntent id>' (an
-- uncaptured hold released in full or in part). _shared/refundNotice.ts
-- INSERTs the row BEFORE it writes the notification and sends the email, so
-- the two senders of one refund (the path that made it and the charge.refunded
-- webhook, or a webhook redelivery) race on this primary key and exactly one
-- of them tells the poster. A sender that fails to write the notification
-- deletes its claim so a retry can send it; a claim left unwritten for more
-- than 5 minutes (its sender died) is taken over. notification_id
-- 00000000-0000-0000-0000-000000000000 marks a notice a trigger dropped by
-- design (the seed boundary), which is never re-sent.
--
-- Server-only: RLS on with no policy, no client grant. The notice itself is
-- the user-facing record (notifications); this table only dedupes it.

CREATE TABLE IF NOT EXISTS public.refund_notices (
  notice_key        text PRIMARY KEY,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id            uuid REFERENCES public.jobs(id) ON DELETE SET NULL,
  payment_intent_id text,
  amount_cents      integer NOT NULL CHECK (amount_cents >= 0),
  notification_id   uuid,
  emailed           boolean NOT NULL DEFAULT false,
  -- Why the email did not go: the person's own switch ("skipped: ...") or a
  -- failure to find and re-send. NULL once emailed.
  email_error       text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT refund_notices_key_shape CHECK (notice_key ~ '^(refund|release):[A-Za-z0-9_]+$')
);

CREATE INDEX IF NOT EXISTS refund_notices_user_id_idx ON public.refund_notices (user_id);
CREATE INDEX IF NOT EXISTS refund_notices_job_id_idx ON public.refund_notices (job_id);

ALTER TABLE public.refund_notices ENABLE ROW LEVEL SECURITY;
-- Q807: every public table created since gets the unconfirmed-email write gate
-- (a no-op for service_role, the only writer here).
SELECT public.attach_unconfirmed_email_gate();

REVOKE ALL ON TABLE public.refund_notices FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.refund_notices TO service_role;

COMMENT ON TABLE public.refund_notices IS
  'Q1714: one refund notice (in-app + email) per refund or released hold; the primary key dedupes the senders. Server-only.';
