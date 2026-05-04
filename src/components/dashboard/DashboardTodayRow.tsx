import { Link } from "react-router-dom";
import { MessageSquare, Send, Calendar, Bookmark, Wallet, Plus, MapPin } from "lucide-react";
import { useUnreadCounts } from "@/hooks/useUnreadCounts";

interface Props {
  userId: string | null | undefined;
  isHelper: boolean;
  jobsNearby: number;
}

const StatChip = ({
  to,
  icon: Icon,
  label,
  value,
  highlight,
}: {
  to: string;
  icon: typeof MessageSquare;
  label: string;
  value: string | number;
  highlight?: boolean;
}) => (
  <Link
    to={to}
    className="liquid-glass shrink-0 flex items-center gap-2.5 px-3.5 py-2 rounded-2xl transition-transform active:scale-95"
    style={{ minWidth: "fit-content" }}
  >
    <span
      className="w-7 h-7 rounded-xl flex items-center justify-center"
      style={{
        background: highlight ? "hsl(var(--burnt-sienna) / 0.12)" : "hsl(var(--bark) / 0.1)",
      }}
    >
      <Icon
        className="w-3.5 h-3.5"
        style={{ color: highlight ? "hsl(var(--burnt-sienna))" : "hsl(var(--bark))" }}
        strokeWidth={2}
      />
    </span>
    <div className="flex flex-col items-start leading-tight">
      <span
        className="text-[0.62rem] font-serif italic uppercase tracking-[0.14em]"
        style={{ color: "hsl(var(--burnt-sienna) / 0.7)" }}
      >
        {label}
      </span>
      <span
        className="font-display italic font-bold leading-none"
        style={{
          fontSize: "1rem",
          color: "hsl(var(--ink-deep))",
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </span>
    </div>
  </Link>
);

const ActionChip = ({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: typeof MessageSquare;
  label: string;
}) => (
  <Link
    to={to}
    className="liquid-glass shrink-0 flex items-center gap-2 px-3.5 h-11 rounded-2xl transition-transform active:scale-95"
  >
    <Icon
      className="w-3.5 h-3.5"
      style={{ color: "hsl(var(--bark))" }}
      strokeWidth={2}
    />
    <span
      className="font-sans font-medium tracking-tight"
      style={{
        fontSize: "0.78rem",
        color: "hsl(var(--ink-deep))",
      }}
    >
      {label}
    </span>
  </Link>
);

const DashboardTodayRow = ({ userId, isHelper, jobsNearby }: Props) => {
  const { messages, applications } = useUnreadCounts(userId);

  return (
    <div className="-mx-5 px-5 overflow-x-auto scrollbar-hide">
      <div className="flex items-stretch gap-2 py-1">
        <StatChip
          to="/messages"
          icon={MessageSquare}
          label="Unread"
          value={messages}
          highlight={messages > 0}
        />
        {isHelper ? (
          <StatChip
            to="/my-jobs"
            icon={Send}
            label="Pending"
            value={applications}
            highlight={applications > 0}
          />
        ) : (
          <StatChip
            to="/my-posts"
            icon={Send}
            label="My posts"
            value={applications}
          />
        )}
        <StatChip
          to="/dashboard"
          icon={MapPin}
          label="Nearby"
          value={jobsNearby}
        />

        {/* Quick actions */}
        {!isHelper && (
          <ActionChip to="/post-job" icon={Plus} label="Post a job" />
        )}
        <ActionChip to="/schedule" icon={Calendar} label="Schedule" />
        <ActionChip to="/saved-helpers" icon={Bookmark} label={isHelper ? "Saved" : "Helprs"} />
        {isHelper && <ActionChip to="/profile?tab=earnings" icon={Wallet} label="Earnings" />}
      </div>
    </div>
  );
};

export default DashboardTodayRow;
