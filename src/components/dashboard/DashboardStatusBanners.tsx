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
  onPendingClick: () => void;
}

/**
 * The `beforePanel` verification banner lifted out of Dashboard: the
 * progressive-activation "verification in progress" strip. Pure
 * presentation; navigation is threaded in as an explicit callback. (The
 * upcoming/in-progress job reminder moved to the pinned top nav as
 * `DashboardInProgressBadge` so it no longer costs a content row.)
 */
const DashboardStatusBanners = ({
  isPendingReview,
  onPendingClick,
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
    </>
  );
};

export default DashboardStatusBanners;
