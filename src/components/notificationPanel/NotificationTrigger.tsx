import { forwardRef } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";

export const NotificationTrigger = forwardRef<HTMLButtonElement, { unreadCount: number } & React.ComponentPropsWithoutRef<typeof Button>>(
  ({ unreadCount, ...props }, ref) => (
    <Button ref={ref} variant="ghost" size="icon" className="relative" aria-label="Notifications" {...props}>
      <Bell className="w-4 h-4" />
      {unreadCount > 0 && (
        <span
          className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full text-ds-10 leading-none flex items-center justify-center font-bold ring-2 ring-background"
          style={{ background: "hsl(var(--burnt-sienna))", color: "hsl(var(--parchment))" }}
        >
          {/* The panel's Unread segment shows this same number, so the badge
              must not truncate at a figure the panel would then contradict —
              a "9+" bell opening onto an Unread segment reading 12 is the two
              disagreeing. Both are derived from one array, and that array is
              capped at 50 rows by the panel's fetch, so an unabbreviated
              badge is at most two digits and the "99+" branch is a guard
              rather than a state the product can currently reach. */}
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Button>
  )
);
NotificationTrigger.displayName = "NotificationTrigger";
