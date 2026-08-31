/**
 * How long a STANDARD payout takes to land, stated once.
 *
 * WHY THIS EXISTS. Two screens described the same fact with two different
 * numbers: InstantPayoutDialog said standard payouts "take 1–2 business days"
 * while PayoutHistory said they "land within 2 business days". Neither was
 * derived from anything, so nothing held them together — the same drift that
 * put "five strikes is a ban" in front of users for weeks, and the same reason
 * `escrowTiming` and `reliabilityLadder` exist.
 *
 * The ceiling, not a range. "1–2" reads as a promise the platform does not
 * control: the leg after Helpr releases the transfer belongs to Stripe and the
 * receiving bank, and a payout that lands on day 2 has to be the expected
 * outcome rather than the disappointing one. A person deciding whether to pay
 * the instant-payout fee is making that call against the worst case, so the
 * worst case is the honest number to show them.
 *
 * This describes the STANDARD path only. The instant path has its own fee and
 * its own timing — see `instantPayoutFee.ts`.
 */
export const STANDARD_PAYOUT_WINDOW_DAYS = 2;

/** "within 2 business days" — the fragment both surfaces interpolate. */
export const STANDARD_PAYOUT_WINDOW = `within ${STANDARD_PAYOUT_WINDOW_DAYS} business days`;
