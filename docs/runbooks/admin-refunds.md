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
