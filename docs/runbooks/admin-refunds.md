# Admin refunds (Stripe Dashboard)

## Tips are final (owner, 2026-09-27, Q781)

A tip is never refunded by the app. No edge function, cron or client path issues a
refund against a tip's PaymentIntent (guard: `src/test/tipsAreFinal.test.ts`).

If a tip must be refunded by hand in the Stripe Dashboard (a mistaken charge, a court
or card-network order), refund it with BOTH:

- `reverse_transfer=true`: pulls the tip back from the Helpr's connected account, so the
  platform does not pay the refund out of its own balance;
- `refund_application_fee=true`: returns the card-fee top-up the poster paid on top.

Then add a line to the job's admin notes naming who asked and why. Do not refund the
job's escrow PaymentIntent to "cover" a tip: tips are separate PaymentIntents
(`metadata.type = "tip"`), and the escrow refund paths do not know about them.

## A Dashboard full refund on a Declutter haul-away job whose Helpr was paid (Q1924)

A full refund made in the Stripe Dashboard on a job whose payout already went out ('released')
leaves payment_status as it is (the platform has paid twice; reconcile by hand), so the trigger
that puts a haul-away job's items back on sale never fires. The page "Full refund on a job in
'released'" names those items ("This is a Declutter haul-away job: ... (declutter item <ids>)"):
put each back on sale by hand (its declutter_haul_aways row says what it was before: live or ended).
