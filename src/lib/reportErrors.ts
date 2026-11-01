/**
 * Copy for a failed insert into public.reports. The reports_rate_limit trigger
 * (TS-012) refuses a reporter's 11th report in an hour or 31st in a day with
 * the message 'report_rate_limited'; anything else keeps the caller's fallback.
 */
export function reportSubmitError(error: { message?: string } | null | undefined, fallback: string): string {
  if (error?.message?.includes("report_rate_limited")) {
    return "You've sent a lot of reports in a short time. Please try again in a little while.";
  }
  // B48 (owner decision 10-31): a Declutter question or answer is never reported by the person who wrote it, and a
  // removed one reads as not found (report_message_party_and_copy, 20261101021934).
  if (error?.message?.includes("report_own_content")) return "You wrote this, so you can't report it.";
  if (error?.message?.includes("report_target_not_found")) return "We couldn't find that. It may have been removed.";
  return fallback;
}
