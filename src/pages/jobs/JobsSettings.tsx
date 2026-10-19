import { useNavigate } from "react-router-dom";
import AppPage from "@/components/AppPage";
import { SettingsGroup } from "@/components/profile/profileLanding/SettingsSection";
import { JOBS_SETTINGS_GROUPS } from "@/components/profile/profileLanding/jobsSettingsGroups";
import { usePageTitle } from "@/hooks/usePageTitle";

/** /jobs/settings: the Jobs section's own settings (see jobsSettingsGroups.tsx). */
export default function JobsSettings() {
  usePageTitle("Jobs settings — Helpr");
  const navigate = useNavigate();
  return (
    <AppPage title="Jobs settings" backTo="/jobs?tab=posted">
      <div className="space-y-4 pb-6" data-testid="jobs-settings">
        {JOBS_SETTINGS_GROUPS.map((group) => (
          <SettingsGroup key={group.title} group={group} onSelect={(item) => item.href && navigate(item.href)} />
        ))}
      </div>
    </AppPage>
  );
}
