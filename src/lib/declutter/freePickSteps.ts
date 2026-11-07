/**
 * 11-07 free-claim trace: what happens to a first-timer the giver picks. declutter_pick_free_request books the asked
 * time only for a member already verified; anyone else gets the item held, does the one-time ID check
 * (declutter_free_claim_gate), then chooses the pickup time. Said the same way in the Ask sheet and How it works.
 */
export const FIRST_PICK_STEPS =
  "your first free item has a one-time ID check first (we show you the cost before you pay), then you choose your pickup time and get the address";
