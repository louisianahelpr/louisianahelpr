import { useNavigate } from "react-router-dom";
import AppPage from "@/components/AppPage";
import { SettingsGroup } from "@/components/profile/profileLanding/SettingsSection";
import { JOBS_SETTINGS_GROUPS } from "@/components/profile/profileLanding/jobsSettingsGroups";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useFeature } from "@/hooks/useFeature";

/** /jobs/settings: the Jobs section's own settings (see jobsSettingsGroups.tsx). */
export default function JobsSettings() {
  usePageTitle("Jobs settings — Helpr");
  const navigate = useNavigate();
  // Instant book is off for everyone (owner 11-01, switch 'instant_book'): no row for its settings.
  const instantBookOn = useFeature("instant_book");
  const groups = JOBS_SETTINGS_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => instantBookOn || i.key !== "instant-book") }));
  return (
    <AppPage title="Jobs settings" backTo="/jobs?tab=posted">
      <div className="space-y-4 pb-6" data-testid="jobs-settings">
        {groups.map((group) => (
          <SettingsGroup key={group.title} group={group} onSelect={(item) => item.href && navigate(item.href)} />
        ))}
      </div>
    </AppPage>
  );
}
