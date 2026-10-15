/**
 * Quotes: every refusal the quote RPCs can give, in plain words. The server
 * RAISEs a code as the error MESSAGE ('quotes_closed'); the contact-leak
 * trigger raises a sentence already written for the member, shown as it is.
 *
 * EXACT: src/components/quotes/quoteScreens.test.tsx ("error copy") reads
 * every RAISE EXCEPTION code in 20261015091114_job_quotes.sql and fails on one
 * with no line here, and on a line here the migration does not raise.
 *
 * Kept import-free: src/lib/lifecycleErrors.ts builds each quote RPC's
 * RPC_ERROR_COPY entry from these lines (the rpcErrorCopyCoverage rule).
 */
export const QUOTE_ERROR_COPY: Record<string, string> = {
  feature_disabled: "Quotes aren't open for your account yet.",
  not_authenticated: "Please sign in again to continue.",
  account_restricted: "Your account is restricted, so quotes are not available right now.",
  under_18: "You must be 18 or older to post or quote on jobs.",
  invalid_window: "Pick 24 hours, 48 hours or 3 days for quotes.",
  invalid_date: "Pick the date you need this done.",
  job_start_too_soon: "This job starts too soon for quotes. Pick a later date, or set your own price.",
  too_many_open_requests: "You can ask for quotes on up to 5 jobs at a time.",
  rate_limited: "You've sent a lot of quotes today. Try again tomorrow.",
  unknown_request: "This request isn't available anymore.",
  cannot_quote_own_request: "This is your own request.",
  quotes_closed: "This request isn't taking quotes anymore.",
  already_quoted: "You've already sent a quote for this job.",
  invalid_photo: "One of the photos didn't upload. Remove it and add it again.",
  invalid_action: "Something went wrong. Please try again.",
  unknown_quote: "This quote isn't available anymore.",
  quote_unavailable: "This quote isn't available anymore.",
  // Q345: the two members are blocked (either direction). Never says who blocked.
  applicant_blocked: "This quote is no longer available to you.",
  quote_closed: "This quote is closed.",
  quote_expired: "This offer ran out of time.",
  not_your_turn: "Waiting for the other side to answer your last offer.",
  price_required: "Enter a price for your counter-offer.",
  no_agreed_quote: "There is no accepted quote to book yet.",
  invalid_budget: "Enter a whole-dollar price.",
  request_closed: "This request is already closed.",
  request_booked: "This job is paid for. Cancel it from the job instead.",
  checkout_open: "A checkout is open for this job. Finish it, or try again once it expires.",
  quote_terms_locked: "The agreed price and details of this job can't be changed.",
};
