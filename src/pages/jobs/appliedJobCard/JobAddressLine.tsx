/**
 * IS THIS LOCATION A STREET ADDRESS, OR JUST A TOWN?
 *
 * ── THE COMPONENT THAT USED TO LIVE HERE IS GONE ──────────────────────────
 * `JobAddressLine` printed the job's full street address on a row of its own,
 * below the card's meta row (VN-55, owner 2026-09-14: "they need to be able to
 * actually see the full address when the offer is sent to the helpr, not just
 * in the map"). The meta row printed the CITY, so a hired Helpr's card showed
 * the place twice:
 *
 *     📍 New Iberia   📅 Thu, Sep 17   🕐 12:00 PM
 *     📍 1103 Center St, New Iberia, LA 70560
 *
 * Owner, 2026-09-19, with that screenshot: "this shouldnt show 2 addresses.
 * once they are at the correct state, the full address should replace the city
 * in the job card. not be on a whole nother line. the full address needs to go
 * where the city place is. fix this."
 *
 * So the address moved INTO the meta row's location slot — `JobCardMetaRow`'s
 * `showFullAddress` prop, which carries the arithmetic for why it takes a line
 * of its own there rather than competing with the date and time at 320. The
 * mount's entitlement condition moved with it, verbatim.
 *
 * ── THIS PREDICATE STAYS, AND IS THE POINT OF THE FILE ────────────────────
 * It is the only workable test for "did the server give me the real address or
 * the masked one", because masking is UNDETECTABLE BY COMPARISON:
 * `mask_job_location('New Iberia, LA')` returns `'New Iberia, LA'`, identical
 * in and out. A digit in the first comma-segment is the street number.
 *
 * It is imported by `JobCardMetaRow` (which decides what to paint) and by
 * `src/test/seedFixtureAddressRealism.test.ts` (which holds the seed scripts'
 * own transcription of it to exactly this answer). The path is unchanged so
 * neither import had to move.
 */
export function hasStreetAddress(location: string | null | undefined): location is string {
  const first = (location ?? "").split(",")[0]?.trim() ?? "";
  return /\d/.test(first) && (location ?? "").includes(",");
}
