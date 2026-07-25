import { HelperAvailability } from "@/components/HelperAvailability";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";

interface AvailabilityTabProps {
  userId: string;
  onBack: () => void;
}

export function AvailabilityTab({ userId, onBack }: AvailabilityTabProps) {
  return (
    <div className="space-y-4">
      <ProfileTabHeader
        title="Availability"
        onBack={onBack}
      />

      <div className="rounded-2xl liquid-glass p-5">
        <HelperAvailability userId={userId} />
      </div>
    </div>
  );
}
