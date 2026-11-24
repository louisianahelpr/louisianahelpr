/**
 * The tracker's line under its steps while the Helpr has not confirmed and the confirm window is open (JobTrackingView
 * decides when). Normally it points at JobConfirmation's button below. #31 (deep audit 11-22): once the job day is
 * over JobConfirmation hides that button (the SAME helprConfirmClosed rule, read by the caller as `dayPassed`), so
 * "Confirm the job below" pointed at nothing; the line says what the Helpr CAN do instead.
 */
export function TrackerConfirmNote({ dayPassed, posterName }: { dayPassed: boolean; posterName?: string | null }) {
  if (dayPassed) {
    const posterFirst = (posterName ?? "").trim().split(/\s+/)[0] || "the poster";
    return (
      <div className="pt-2 border-t border-border">
        <p className="text-ds-11 text-muted-foreground text-center" data-confirm-day-passed="">
          The day passed without a confirm. Message {posterFirst} or cancel the job.
        </p>
      </div>
    );
  }
  return (
    <div className="pt-2 border-t border-border">
      <p className="text-ds-11 text-muted-foreground text-center">
        Confirm the job below to unlock the next step
      </p>
    </div>
  );
}
