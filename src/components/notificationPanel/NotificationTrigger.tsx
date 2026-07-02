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
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Button>
  )
);
NotificationTrigger.displayName = "NotificationTrigger";
