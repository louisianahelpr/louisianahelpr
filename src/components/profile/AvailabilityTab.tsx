import { HelperAvailability } from "@/components/HelperAvailability";
import ProfileTabHeader from "@/components/profile/ProfileTabHeader";

interface AvailabilityTabProps {
  userId: string;
  onBack: () => void;
}

export function AvailabilityTab({ userId, onBack }: AvailabilityTabProps) {
  return (
    <div className="space-y-6">
      <ProfileTabHeader
        eyebrow="Hours"
        title="Availability"
        meta="Tell posters when you can work"
        onBack={onBack}
      />

      <div className="rounded-ds-md liquid-glass p-5">
        <HelperAvailability userId={userId} />
      </div>
    </div>
  );
}
