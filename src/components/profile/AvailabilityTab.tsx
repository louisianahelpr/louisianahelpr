import { ArrowLeft } from "lucide-react";
import { HelperAvailability } from "@/components/HelperAvailability";

interface AvailabilityTabProps {
  userId: string;
  onBack: () => void;
}

export function AvailabilityTab({ userId, onBack }: AvailabilityTabProps) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-page-title text-foreground text-2xl">Availability</h1>
          <p className="text-muted-foreground text-sm">Set your weekly working hours so posters can match jobs to your schedule</p>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <HelperAvailability userId={userId} />
      </div>
    </div>
  );
}
