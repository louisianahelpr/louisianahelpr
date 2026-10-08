import { forwardRef } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatUnreadBadge } from "@/lib/format";
import { cn } from "@/lib/utils";

export const NotificationTrigger = forwardRef<HTMLButtonElement, { unreadCount: number } & React.ComponentPropsWithoutRef<typeof Button>>(
  ({ unreadCount, className, ...props }, ref) => (
    <Button ref={ref} variant="ghost" size="icon" className={cn("relative", className)} aria-label="Notifications" {...props}>
      <Bell className="w-4 h-4" />
      {unreadCount > 0 && (
        <span
          className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full text-ds-10 leading-none flex items-center justify-center font-bold ring-2 ring-background"
          style={{ background: "hsl(var(--burnt-sienna))", color: "hsl(var(--parchment))" }}
        >
          {/* The panel's Unread segment shows this same count, formatted by
              the same function, so the two can never read differently. The
              count is the server's unread total (bellUnreadCount), not the
              fetched page, so "99+" is a reachable state. */}
          {formatUnreadBadge(unreadCount)}
        </span>
      )}
    </Button>
  )
);
NotificationTrigger.displayName = "NotificationTrigger";
