import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Notification } from "@/components/notificationPanel/types";

/**
 * Q2037: the "N more on this job" control under a notification that has
 * other notices about the same job folded beneath it (foldByJob). It names
 * how many of the hidden ones are unread, so folding never hides an unread
 * notice without saying so. A tap opens or closes the fold; it never opens
 * the row's job (the row's own tap does that).
 */
export function JobFoldToggle({ more, open, onToggle }: { more: Notification[]; open: boolean; onToggle: () => void }) {
  if (more.length === 0) return null;
  const unread = more.filter((m) => !m.read).length;
  const label = open
    ? "Hide the other updates"
    : `${more.length} more on this job${unread > 0 ? ` (${unread} unread)` : ""}`;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-expanded={open}
      data-job-fold=""
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className="mt-1 -ml-2 px-2 text-ds-12 font-semibold"
      style={{ color: "hsl(var(--bark))" }}
    >
      {label}
      <ChevronDown className={`w-4 h-4 transition-transform${open ? " rotate-180" : ""}`} strokeWidth={2.25} aria-hidden />
    </Button>
  );
}
