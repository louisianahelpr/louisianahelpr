/**
 * Copy for a failed insert into public.reports. The reports_rate_limit trigger
 * (TS-012) refuses a reporter's 11th report in an hour or 31st in a day with
 * the message 'report_rate_limited'; anything else keeps the caller's fallback.
 */
export function reportSubmitError(error: { message?: string } | null | undefined, fallback: string): string {
  if (error?.message?.includes("report_rate_limited")) {
    return "You've sent a lot of reports in a short time. Please try again in a little while.";
  }
  return fallback;
}
