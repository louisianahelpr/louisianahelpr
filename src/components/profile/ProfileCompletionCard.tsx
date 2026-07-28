// ProfileCompletionCard — shown only on the user's own public-profile view
// (UserProfile.tsx when isOwnProfile === true). It computes a 0–100 score
// from the five fields below, renders a progress bar, and surfaces a compact
// checklist of what's still missing. Completed items are shown with a
// checkmark and muted styling; tapping an incomplete item navigates the user
// to the relevant section. The whole card is hidden once the score hits 100.
//
// Scoring:
//   Profile photo  — 25 pts
//   Bio / about    — 20 pts
//   Skills (≥1)    — 20 pts
//   3+ completed jobs — 20 pts
//   At least 1 review — 15 pts
//   ──────────────────────────
//   Total possible:  100 pts

import { useNavigate } from "react-router-dom";
import { Check, ChevronRight, Camera, FileText, Hammer, Star, Wrench } from "lucide-react";

interface ProfileCompletionCardProps {
  /** URL of the user's avatar — null/empty means no photo */
  avatarUrl?: string | null;
  /** Profile bio text */
  bio?: string | null;
  /** Comma-separated skills string (from profiles.skills) */
  skills?: string | null;
  /** Number of completed jobs (helper OR poster) */
  completedJobs: number;
  /** Number of reviews the user has received */
  reviewCount: number;
  /** The auth'd user's own id — used to build edit-profile deeplink */
  userId: string;
}

interface CheckItem {
  label: string;
  done: boolean;
  points: number;
  /** Route or action to take when tapping the incomplete row */
  action: "edit-profile" | "find-jobs" | "view-profile";
  /** Short hint shown on the incomplete row */
  hint: string;
  icon: React.ReactNode;
}

export function ProfileCompletionCard({
  avatarUrl,
  bio,
  skills,
  completedJobs,
  reviewCount,
  userId,
}: ProfileCompletionCardProps) {
  const navigate = useNavigate();

  const hasPhoto = !!avatarUrl;
  const hasBio = (bio?.trim().length ?? 0) >= 20;
  const hasSkills = skills
    ? skills
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean).length >= 1
    : false;
  const hasCompletedJobs = completedJobs >= 3;
  const hasReview = reviewCount >= 1;

  const items: CheckItem[] = [
    {
      label: "Add a profile photo",
      done: hasPhoto,
      points: 25,
      action: "edit-profile",
      hint: "A photo helps posters recognize and trust you",
      icon: <Camera className="w-3.5 h-3.5" />,
    },
    {
      label: "Write a bio",
      done: hasBio,
      points: 20,
      action: "edit-profile",
      hint: "Tell posters what makes you great",
      icon: <FileText className="w-3.5 h-3.5" />,
    },
    {
      label: "Add at least one skill",
      done: hasSkills,
      points: 20,
      action: "edit-profile",
      hint: "Skills help you show up in category searches",
      icon: <Wrench className="w-3.5 h-3.5" />,
    },
    {
      label: "Complete 3 jobs",
      done: hasCompletedJobs,
      points: 20,
      action: "find-jobs",
      hint: completedJobs > 0 ? `${completedJobs} of 3 done` : "Browse open jobs near you",
      icon: <Hammer className="w-3.5 h-3.5" />,
    },
    {
      label: "Earn your first review",
      done: hasReview,
      points: 15,
      action: "view-profile",
      hint: "Complete a job and ask the poster to rate you",
      icon: <Star className="w-3.5 h-3.5" />,
    },
  ];

  const score = items.reduce((acc, item) => acc + (item.done ? item.points : 0), 0);

  // Once all items are complete (100%), hide the card entirely.
  if (score >= 100) return null;

  const handleItemClick = (item: CheckItem) => {
    if (item.done) return;
    switch (item.action) {
      case "edit-profile":
        navigate(`/profile?tab=profile`);
        break;
      case "find-jobs":
        navigate("/dashboard");
        break;
      case "view-profile":
        // Navigate to own public profile (already viewing it, but direct
        // back to the top so the user sees the context)
        navigate(`/user/${userId}`);
        break;
    }
  };

  // Bar color shifts from burnt-sienna (early) to bark (strong progress)
  const barColor =
    score >= 66
      ? "hsl(var(--bark) / 0.85)"
      : score >= 40
        ? "hsl(var(--gold-warm) / 0.90)"
        : "hsl(var(--burnt-sienna) / 0.80)";

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background:
          "linear-gradient(145deg, hsl(var(--parchment) / 0.95) 0%, hsl(var(--sand) / 0.70) 100%)",
        border: "0.5px solid hsl(var(--bark) / 0.14)",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
          "0 1px 2px hsl(var(--olivewood) / 0.06), " +
          "0 8px 24px -8px hsl(var(--olivewood) / 0.12)",
      }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center justify-between gap-3 mb-2.5">
          <div>
            <p
              className="text-ds-13 font-semibold leading-tight"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Boost your profile
            </p>
            <p
              className="font-serif italic text-ds-11 mt-0.5"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Complete these to get more job offers
            </p>
          </div>
          <span
            className="text-ds-12 font-bold tabular-nums px-2 py-1 rounded-full shrink-0"
            style={{
              color: "hsl(var(--bark))",
              background: "hsl(var(--bark) / 0.10)",
            }}
          >
            {score}%
          </span>
        </div>

        {/* Progress bar */}
        <div
          className="h-2 rounded-full overflow-hidden"
          style={{ background: "hsl(var(--bark) / 0.10)" }}
          role="progressbar"
          aria-valuenow={score}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Profile completion: ${score}%`}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${score}%`,
              background: barColor,
            }}
          />
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: "0.5px", background: "hsl(var(--olivewood) / 0.10)" }} />

      {/* Checklist */}
      <div className="px-2 py-2 space-y-0.5">
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => handleItemClick(item)}
            disabled={item.done}
            className="w-full flex items-center gap-2.5 px-2.5 py-2.5 rounded-ds-md text-left transition-colors disabled:cursor-default enabled:active:bg-[hsl(var(--bark)/0.06)] enabled:hover:bg-[hsl(var(--bark)/0.04)]"
          >
            {/* Status indicator */}
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
              style={
                item.done
                  ? { background: "hsl(var(--bark))" }
                  : {
                      border: "1.5px dashed hsl(var(--olivewood) / 0.35)",
                      background: "transparent",
                    }
              }
            >
              {item.done ? (
                <Check
                  className="w-3 h-3"
                  style={{ color: "hsl(var(--parchment))" }}
                  strokeWidth={3}
                />
              ) : (
                <span
                  className="w-3 h-3 flex items-center justify-center"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  {item.icon}
                </span>
              )}
            </span>

            {/* Label + hint */}
            <div className="flex-1 min-w-0">
              <p
                className="text-ds-13 leading-tight font-medium"
                style={{
                  color: item.done
                    ? "hsl(var(--olivewood) / 0.8)"
                    : "hsl(var(--ink-deep))",
                  textDecoration: item.done ? "line-through" : "none",
                  textDecorationColor: "hsl(var(--olivewood) / 0.35)",
                }}
              >
                {item.label}
              </p>
              {!item.done && (
                <p
                  className="font-serif italic text-ds-11 mt-0.5 leading-tight"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  {item.hint}
                </p>
              )}
            </div>

            {/* Points badge + chevron */}
            <div className="flex items-center gap-1.5 shrink-0">
              {!item.done && (
                <span
                  className="text-ds-9 font-bold tabular-nums px-1.5 py-0.5 rounded-full"
                  style={{
                    background: "hsl(var(--burnt-sienna) / 0.10)",
                    color: "hsl(var(--burnt-sienna))",
                  }}
                >
                  +{item.points}
                </span>
              )}
              {!item.done && (
                <ChevronRight
                  className="w-3.5 h-3.5"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  strokeWidth={2.25}
                />
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
