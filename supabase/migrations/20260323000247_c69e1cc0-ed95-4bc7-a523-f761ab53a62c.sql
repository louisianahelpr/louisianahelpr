ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_payment_status_check;

ALTER TABLE public.jobs
ADD CONSTRAINT jobs_payment_status_check
CHECK (
  payment_status IS NULL
  OR payment_status = ANY (
    ARRAY[
      'unpaid'::text,
      'escrow'::text,
      'payout_pending'::text,
      'released'::text,
      'refunded'::text,
      'cancelled'::text
    ]
  )
);