/**
 * Re-engagement card for users returning after 30+ days away.
 *
 * Rendered conditionally on the dashboard. Dismissible. Once dismissed,
 * it doesn't show again for another 30 days.
 */
import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shouldShowReengagement, recordAppOpen, daysSinceLastSeen } from "@/lib/onboardingState";

const DISMISSED_KEY = "helpr_reengagement_dismissed_at";

export function ReengagementCard() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const dismissedAt = localStorage.getItem(DISMISSED_KEY);
    const recentlyDismissed =
      dismissedAt && Date.now() - new Date(dismissedAt).getTime() < 30 * 24 * 60 * 60 * 1000;
    if (shouldShowReengagement() && !recentlyDismissed) {
      setShow(true);
    }
    // Refresh "last seen" after we've decided whether to show the card.
    recordAppOpen();
  }, []);

  if (!show) return null;

  const days = daysSinceLastSeen();

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, new Date().toISOString());
    setShow(false);
  };

  return (
    <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10 p-5 mb-6 relative">
      <button
        onClick={dismiss}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4" />
      </button>
      <div className="flex items-start gap-3 pr-8">
        <div className="rounded-full bg-primary/15 p-2 flex-shrink-0">
          <Sparkles className="w-5 h-5 text-primary" aria-hidden />
        </div>
        <div className="flex-1">
          <h3 className="font-display font-semibold text-base">Welcome back!</h3>
          <p className="text-sm text-muted-foreground mt-1">
            It's been {days} days. Your parish has new helpers and fresh jobs since you were last here.
          </p>
          <div className="flex gap-2 mt-3">
            <Button asChild size="sm">
              <Link to="/post-job">Post a job</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard">See what's new</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
