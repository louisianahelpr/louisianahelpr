-- Cache Stripe Connect's ACTUAL identity-verification verdict on the profile.
--
-- What was broken: the "ID verified" badge shown to other users was driven by
-- `profiles.idv_status`, and the public-profile "Verified Helpr" ribbon was
-- driven by merely having uploaded a file (`id_document_url IS NOT NULL`).
-- Nobody reviews either one — the owner confirmed admin does not look at the
-- uploads. So the app asserted a human identity review that never happens, to
-- strangers deciding whether to let someone into their home.
--
-- Blast radius before this change: 6 prod profiles carried
-- idv_status = 'verified'; only 1 had an idv_session_id and only 1 had a
-- Stripe account at all.
--
-- Decision (owner's): the badge may stay ONLY when Stripe verified them. This
-- column is that verdict, written by the `account.updated` Connect webhook
-- (supabase/functions/stripe-webhook/handlers/accountUpdated.ts via
-- _shared/stripeIdentity.ts). Webhook-driven on purpose — no extra per-render
-- Stripe API calls, so no change to Stripe call volume or cost.
--
-- Default FALSE with no backfill, deliberately: nobody has earned the badge
-- until Stripe says so, and the next `account.updated` event for a genuinely
-- verified account sets it truthfully.
--
-- REPLAY-SAFETY: additive columns only, both guarded with IF NOT EXISTS.

alter table public.profiles
  add column if not exists stripe_identity_verified boolean not null default false;

alter table public.profiles
  add column if not exists stripe_identity_verified_at timestamptz;

comment on column public.profiles.stripe_identity_verified is
  'TRUE only when Stripe Connect has no outstanding identity requirement for this account (charges + payouts enabled, not disabled, and no individual.* / company.verification field currently due, past due, eventually due, or pending verification). Written solely by the account.updated webhook. This is the ONLY signal permitted to back a user-visible "ID verified" claim; profiles.idv_status is an internal upload/admin state that nobody reviews.';

comment on column public.profiles.stripe_identity_verified_at is
  'When stripe_identity_verified last flipped to TRUE.';
