import { motion } from "framer-motion";
import { Clock } from "lucide-react";

/** Nearest accepted / in-progress job where the user is the helper. */
export type UpcomingJob = {
  id: string;
  title: string;
  date_needed: string | null;
  start_time: string | null;
  status: string;
};

interface DashboardStatusBannersProps {
  isPendingReview: boolean;
  upcomingJob: UpcomingJob | null;
  onPendingClick: () => void;
  onUpcomingClick: () => void;
}

/**
 * The `beforePanel` status strips lifted verbatim out of Dashboard: the
 * progressive-activation "verification in progress" banner and the
 * upcoming-booked-job reminder row. Pure presentation; navigation is
 * threaded in as explicit callbacks.
 */
const DashboardStatusBanners = ({
  isPendingReview,
  upcomingJob,
  onPendingClick,
  onUpcomingClick,
}: DashboardStatusBannersProps) => {
  return (
    <>
      {/* Progressive-activation banner — a pending user can browse,
          save and apply right now; this is a non-blocking progress
          strip, not a wall. Tapping opens the verification center
          (/account-pending) where they can track review status. */}
      {isPendingReview && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="liquid-glass shrink-0 px-4 py-3 flex items-start gap-3"
          style={{
            background:
              "radial-gradient(70% 90% at 100% 0%, hsl(var(--bark) / 0.10) 0%, transparent 55%)",
            border: "0.5px solid hsl(var(--bark) / 0.32)",
          }}
        >
          <div
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: "hsl(var(--bark) / 0.18)", color: "hsl(var(--bark))" }}
          >
            <Clock className="w-4 h-4" strokeWidth={2.25} />
          </div>
          <button
            type="button"
            onClick={onPendingClick}
            className="flex-1 text-left min-w-0 active:opacity-70 transition-opacity"
          >
            <p className="font-display italic font-bold leading-tight" style={{ fontSize: "0.92rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}>
              Verification in progress — browse and apply now.
            </p>
            <p className="font-serif italic mt-0.5" style={{ fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.8)" }}>
              Review usually finishes in 24–48 hours. You'll just need it cleared before you can accept a job. Tap to track status.
            </p>
          </button>
        </motion.div>
      )}

      {/* Upcoming booked-job reminder — only visible to helpers with an
          accepted or in-progress job. Keeps commitments front-of-mind
          without forcing a trip to Activity > My Jobs. */}
      {upcomingJob && (
        // De-filled + SINGLE-LINE: a thin tinted/bordered row (the FAB is
        // the screen's only primary fill). Label + title + date all sit on
        // one line, so this is a slim reminder strip rather than a card —
        // it must not steal vertical space from the feed below.
        <button
          type="button"
          onClick={onUpcomingClick}
          className="mx-4 mb-3 w-[calc(100%-2rem)] rounded-2xl px-3 py-2 text-left flex items-center gap-2 transition-transform active:scale-[0.99]"
          style={{
            background: "hsl(var(--bark) / 0.06)",
            border: "1px solid hsl(var(--bark) / 0.18)",
          }}
        >
          <span
            className="shrink-0 font-serif italic uppercase tracking-[0.12em] text-ds-9"
            style={{ color: "hsl(var(--burnt-sienna) / 0.78)" }}
          >
            {upcomingJob.status === "in_progress" ? "In progress" : "Upcoming"}
          </span>
          <span className="flex-1 min-w-0 truncate text-ds-12" style={{ color: "hsl(var(--ink-deep))" }}>
            <span className="font-semibold">{upcomingJob.title}</span>
            {upcomingJob.date_needed && (
              <span style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                {" · "}
                {new Date(upcomingJob.date_needed).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                {upcomingJob.start_time ? ` ${upcomingJob.start_time.slice(0, 5)}` : ""}
              </span>
            )}
          </span>
          <span
            className="shrink-0 text-ds-11 font-sans font-semibold"
            style={{ color: "hsl(var(--bark))" }}
          >
            View ›
          </span>
        </button>
      )}
    </>
  );
};

export default DashboardStatusBanners;
