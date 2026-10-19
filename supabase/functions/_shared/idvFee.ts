// idvFee — THE price of a paid Stripe Identity check (photo ID + selfie), in
// one place for the app (Homes' "Verify your ID" pill quotes it) and for the
// edge runtime (stripe-idv-start charges it). ZERO imports, so vitest and the
// edge-function harness load it straight from disk.
//
// OWNER, 2026-10-19 (pop-up): "BOTH WAYS, BUT THEY HAVE TO PAY FOR THEIR OWN
// ID". The landlord pays what Stripe bills us for the check PLUS the card
// processing fee on that charge; the platform never absorbs any fee (standing
// rule). So the charge is grossed up until what we keep after Stripe's cut is
// at least the check's cost.
//
// STRIPE_IDENTITY_CHECK_CENTS: Stripe's published US price for a document
// verification, selfie included: "$1.50 per verification", "Charged when a user
// completes verification" (stripe.com/identity, read 2026-10-18). Billing is
// per completed VerificationReport (verified OR unverified): an abandoned
// session that was never submitted is not billed, and a resubmission after a
// failed check produces a new report, which is.
//
// The card rate (2.9% + 30c, the same numbers as _shared/stripeFees.ts,
// pinned against it by src/test/idvFee.test.ts) holds because the checkout
// offers card and Link only.
//
// PENDING OWNER CONFIRMATION before launch (reported by the landlord-idv lane).

/** What Stripe bills the platform for one completed document + selfie check. */
export const STRIPE_IDENTITY_CHECK_CENTS = 150;

const CARD_PCT = 0.029;
const CARD_FLAT_CENTS = 30;

/** What Stripe keeps on a successful card/Link charge of `cents` (stripeProcessingCostCents). */
function cardFeeCents(cents: number): number {
  return Math.round(cents * CARD_PCT) + CARD_FLAT_CENTS;
}

/** The smallest whole-cent charge whose net after the card fee covers `netCents`. */
function grossUpForCardFeeCents(netCents: number): number {
  if (!(netCents > 0)) return 0;
  let gross = Math.ceil((netCents + CARD_FLAT_CENTS) / (1 - CARD_PCT));
  while (gross - 1 - cardFeeCents(gross - 1) >= netCents) gross--;
  while (gross - cardFeeCents(gross) < netCents) gross++;
  return gross;
}

/** What the landlord is charged for one ID check: 185 cents ($1.85) at the rates above. */
export const IDV_FEE_CENTS = grossUpForCardFeeCents(STRIPE_IDENTITY_CHECK_CENTS);

/** "$1.85" */
export const IDV_FEE_TEXT = `$${(IDV_FEE_CENTS / 100).toFixed(2)}`;

/** Checkout metadata.kind for this purchase (stripe-webhook's KNOWN_CHECKOUT_KINDS). */
export const IDV_FEE_CHECKOUT_KIND = "idv_fee";
