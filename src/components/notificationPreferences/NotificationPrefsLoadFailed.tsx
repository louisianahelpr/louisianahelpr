import { ErrorState } from "@/components/ui/ErrorState";

/**
 * The Notifications screen when the member's saved settings could not be read
 * (Q2311): say so and offer a retry. NotificationPreferences keeps every switch
 * disabled while this shows, so no press can save the defaults over them.
 */
export const NotificationPrefsLoadFailed = ({ onRetry }: { onRetry: () => void }) => (
  <div className="p-3">
    <ErrorState
      variant="inline"
      title="We couldn't load your notification settings."
      body="Your saved settings are safe. Tap Try again to load them."
      onRetry={onRetry}
    />
  </div>
);
