import { Eye } from "lucide-react";
import SectionCard from "./SectionCard";
import type { Analytics } from "./fetchAnalytics";

interface ProfileViewsCardProps {
  analytics: Analytics | undefined;
  hasAccess: boolean;
  isLoading: boolean;
  onUpgrade: () => void;
}

const ProfileViewsCard = ({ analytics, hasAccess, isLoading, onUpgrade }: ProfileViewsCardProps) => {
  return (
    <SectionCard
      title="Profile views"
      icon={<Eye className="w-4 h-4" />}
      hasAccess={hasAccess}
      isLoading={isLoading}
      onUpgrade={onUpgrade}
      lockedPreview="See how many posters viewed your profile this month."
    >
      {analytics && (
        <div className="text-center py-2 space-y-1">
          <p
            className="font-display italic font-bold"
            style={{ fontSize: "2.2rem", color: "hsl(var(--ink-deep))", letterSpacing: "-0.03em" }}
          >
            {analytics.profileViewCount}
          </p>
          <p className="font-serif italic text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            profile views in the last 30 days
          </p>
          {analytics.profileViewCount === 0 && (
            <p className="text-ds-11 text-muted-foreground">
              Views are counted once per visitor per hour.
            </p>
          )}
        </div>
      )}
    </SectionCard>
  );
};

export default ProfileViewsCard;
