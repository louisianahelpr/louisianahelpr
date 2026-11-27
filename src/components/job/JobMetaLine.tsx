import { Calendar, Clock, MapPin } from "lucide-react";

/**
 * THE JOB DETAILS LINE (polish audit 11-27 #3; owner 11-27: "location category time day" hard to tell apart, "keep
 * them ALL ON ONE LINE"). The Browse row's look (JobCard, PR #5026) for every other short job line: a pin before the
 * place, a calendar before the day, a clock before the time, 10px apart, no "·" between them, so a line can never end
 * on a separator. Each part is one unbreakable chunk; the place comes first and is never cut: when a narrow screen
 * cannot fit the whole line, the LAST part (the time) moves under it rather than the town losing letters.
 * Used by Home's "Jobs near you", Schedule's upcoming rows and the guest job sheet; the Working/Posted cards draw the
 * same look in JobCardMetaRow. Guard: src/test/jobMetaOneLine1127.test.tsx.
 */
export function JobMetaLine({ place, day, time, extra, className = "" }: {
  place?: string | null;
  day?: string | null;
  time?: string | null;
  /** A plain trailing chunk with no icon (a distance band, "Flexible"). */
  extra?: string | null;
  className?: string;
}) {
  const ICON = "h-3 w-3 shrink-0";
  const CHUNK = "inline-flex shrink-0 items-center gap-1 whitespace-nowrap";
  if (!place && !day && !time && !extra) return null;
  return (
    <span data-job-meta-line="" className={`flex flex-wrap items-center gap-x-2.5 gap-y-0.5 ${className}`}>
      {place && <span data-meta-place="" className={CHUNK}><MapPin className={ICON} aria-hidden />{place}</span>}
      {extra && <span data-meta-extra="" className={CHUNK}>{extra}</span>}
      {day && <span data-meta-day="" className={CHUNK}><Calendar className={ICON} aria-hidden />{day}</span>}
      {time && <span data-meta-time="" className={CHUNK}><Clock className={ICON} aria-hidden />{time}</span>}
    </span>
  );
}

/** "3 PM" for "3:00 PM" (the Browse row's own short form). */
export const shortTime = (label: string | null | undefined): string | null => (label ? label.replace(/:00(?= [AP]M)/g, "") : null);
