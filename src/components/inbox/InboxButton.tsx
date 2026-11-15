import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatUnreadBadge } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLanguage } from "@/lib/i18n/language";
import { prefetchOnIntent } from "@/components/notificationPanel/notificationFeed";
import { report } from "@/lib/errorLogger";
import { loadModule } from "@/lib/loadModule";
import { INBOX_PATH, inboxPath, lastInboxTab } from "./inboxTab";
import { useInboxCounts } from "./useInboxCounts";

/**
 * THE INBOX ICON (owner 11-15: "Merge messages and notifications into one, like Vinted does"). ONE top-bar control in
 * place of the phone's Messages button and the bell (and the desktop bar's bell), with ONE badge: unread message
 * threads + unread notifications, read from the two shared stores (useInboxCounts, no request of its own). It opens
 * the Inbox on the tab the member last chose (inboxTab.ts). Once the browser is idle it holds the arrival chime the
 * mounted bell used to add (inboxArrivalAlerts.ts). Guard: src/test/inboxOneIconTwoTabs.test.tsx.
 */
export default function InboxButton({ className }: { className?: string }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user } = useCurrentUser();
  const { total } = useInboxCounts(user?.id);
  const { t } = useLanguage();
  const here = pathname === INBOX_PATH;

  useEffect(() => {
    let release: (() => void) | null = null;
    let live = true;
    // Once the browser is idle (never in the first paint's way): the chime's code is not needed to draw anything.
    const start = () => {
      void loadModule(() => import("./inboxArrivalAlerts")).then(
        (m) => { if (live && m) release = m.holdArrivalAlerts(); },
        (err: unknown) => report(err, { severity: "warning", tags: { area: "chunk", op: "inboxArrivalAlerts" } }),
      );
    };
    const idle = typeof window.requestIdleCallback === "function";
    const handle = idle ? window.requestIdleCallback(start, { timeout: 4000 }) : window.setTimeout(start, 1500);
    return () => {
      live = false;
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
      release?.();
    };
  }, []);

  const name = t("inbox.title");
  return (
    <Button
      type="button"
      variant="ghost"
      size="iconCompact"
      // WCAG 2.5.3: the badge's visible count is part of the name ("Inbox, 3 unread").
      aria-label={total > 0 ? t("inbox.unread", { name, n: formatUnreadBadge(total) }) : name}
      aria-current={here ? "page" : undefined}
      data-testid="top-bar-inbox"
      {...prefetchOnIntent}
      onClick={() => navigate(inboxPath(lastInboxTab()))}
      className={cn(
        "relative shrink-0 hover:text-foreground [&>svg]:w-[22px] [&>svg]:h-[22px]",
        here ? "text-[hsl(var(--bark))]" : "text-muted-foreground",
        className,
      )}
    >
      <Inbox aria-hidden />
      {total > 0 && (
        <span
          data-top-bar-badge="inbox"
          aria-hidden
          className="absolute top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full text-ds-10 flex items-center justify-center font-bold px-1 ring-2 ring-background"
          // Count badges are --alert, never rust (spec v2 §1.1), as the bell's and the Messages button's were.
          style={{ background: "hsl(var(--alert))", color: "#fff" }}
        >
          {formatUnreadBadge(total)}
        </span>
      )}
    </Button>
  );
}
