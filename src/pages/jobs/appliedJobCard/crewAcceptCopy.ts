/**
 * A crew member's FIRST step, in words (Q1523): saying yes to their spot.
 *
 * It is the crew's Accept (rpc_group_member_confirm stamps the roster row's
 * helper_confirmed_at, the same hire moment as the single Helpr's
 * accept_job_offer, Q706), so it reads accept, never confirm: confirm is the
 * later day-before step (owner, 2026-10-07, Q1399). The single-Helpr card says
 * "Accept job"; a crew member accepts their spot.
 *
 * Guard: src/test/acceptStepNeverSaysConfirm.test.ts.
 */
export const CREW_ACCEPT_COPY = {
  hint: "Accept your spot so the person who posted this job knows their crew is set.",
  button: "Accept my spot",
  accepted: "You accepted your spot on this crew.",
  failed: "We couldn't accept your spot. Please try again.",
  /* After the accept, before anyone sets out. */
  onCrewWaiting: "You're on the crew. You can head out once the job is booked. At the start time it goes ahead with whoever's on the crew.",
  onCrewSetOut: "You're on the crew. Tap I'm on my way when you head out.",
  lateLeaveStrike: "Leaving a crew you accepted within 24 hours of the start counts as a reliability strike",
} as const;
