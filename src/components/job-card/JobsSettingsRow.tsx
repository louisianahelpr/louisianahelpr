import { Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { GroupRow } from "@/components/sections/StatusBoxes";

/** The foot of Jobs > Posted and Jobs > Working: the way into /jobs/settings (lead decision 2026-10-19, option A). */
export function JobsSettingsRow({ className = "" }: { className?: string }) {
  const navigate = useNavigate();
  return (
    <div className={`liquid-glass overflow-hidden ${className}`} data-testid="jobs-settings-row">
      <GroupRow
        leading={
          <span className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0" aria-hidden>
            <Settings className="w-[18px] h-[18px]" />
          </span>
        }
        title="Jobs settings"
        meta="Schedule, availability, saved Helprs and more"
        onClick={() => navigate("/jobs/settings")}
        last
      />
    </div>
  );
}
