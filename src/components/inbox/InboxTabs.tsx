import { createContext, useContext, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { hapticLight } from "@/lib/haptics";
import { formatUnreadBadge } from "@/lib/format";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLanguage } from "@/lib/i18n/language";
import { inboxPath, rememberInboxTab, type InboxTab } from "./inboxTab";
import { useInboxCounts } from "./useInboxCounts";

/**
 * THE INBOX'S TABS (owner 11-15: "Merge messages and notifications into one, like Vinted does"): "Messages N" and
 * "Notifications N", each with its own unread count, two equal halves of one row under the top bar. A real tablist
 * (role tablist / tab, aria-selected, arrow keys move between them), every tab 44px tall. Choosing one writes ?tab=
 * (replace, so Back still leaves the Inbox) and remembers it for the top-bar icon. Messages draws them inside its own
 * header through InboxTabsSlot, so the conversation list keeps its own shell. Guard: src/test/inboxOneIconTwoTabs.test.tsx.
 */
export const INBOX_PANEL_ID = "inbox-tab-panel";

export function InboxTabs({ tab }: { tab: InboxTab }) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const counts = useInboxCounts(user?.id);
  const { t } = useLanguage();
  const refs = useRef<Record<InboxTab, HTMLButtonElement | null>>({ messages: null, notifications: null });
  const tabs: { key: InboxTab; label: string; count: number }[] = [
    { key: "messages", label: t("inbox.messages"), count: counts.messages },
    { key: "notifications", label: t("inbox.notifications"), count: counts.notifications },
  ];
  const choose = (next: InboxTab) => {
    rememberInboxTab(next);
    if (next !== tab) {
      hapticLight();
      navigate(inboxPath(next), { replace: true });
    }
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next: InboxTab = tab === "messages" ? "notifications" : "messages";
    choose(next);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={t("inbox.tabs")} data-testid="inbox-tabs" className="shrink-0 flex w-full border-b border-[hsl(var(--olivewood)/0.12)]">
      {tabs.map((x) => {
        const on = x.key === tab;
        const n = formatUnreadBadge(x.count);
        return (
          // The shared Button (OWN-SHARED, src/test/noNewHandMadeControls.test.ts): ghost, sm (44px); the tab's
          // own colour and weight ride on the inline style, which wins over the base's font-bold.
          <Button
            variant="ghost"
            size="sm"
            key={x.key}
            ref={(el) => { refs.current[x.key] = el; }}
            type="button"
            role="tab"
            id={`inbox-tab-${x.key}`}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            // WCAG 2.5.3: the visible count is part of the name ("Messages, 3 unread").
            aria-label={x.count > 0 ? t("inbox.unread", { name: x.label, n }) : x.label}
            data-inbox-tab={x.key}
            onClick={() => choose(x.key)}
            onKeyDown={onKeyDown}
            className="relative flex-1 gap-1.5 px-3 focus-visible:ring-inset focus-visible:ring-offset-0 focus-visible:ring-[hsl(var(--ring))]"
            style={{ color: on ? "hsl(var(--ink-deep))" : "hsl(var(--olivewood) / 0.7)", fontWeight: on ? 700 : 600 }}
          >
            <span className="whitespace-nowrap">{x.label}</span>
            {x.count > 0 && (
              <span
                aria-hidden
                data-inbox-tab-count={x.key}
                className="min-w-[18px] h-[18px] rounded-full px-1 text-ds-10 font-bold leading-[18px] text-center"
                // Count badges are --alert (spec v2 §1.1), as the icon's is.
                style={{ background: "hsl(var(--alert))", color: "#fff" }}
              >
                {n}
              </span>
            )}
            {on && <span aria-hidden className="absolute inset-x-4 bottom-0 h-0.5 rounded-full" style={{ background: "hsl(var(--ink-deep))" }} />}
          </Button>
        );
      })}
    </div>
  );
}

/** The tabs a page inside the Inbox draws in its own header (ConversationList); null outside the Inbox (admin preview). */
export const InboxTabsSlot = createContext<ReactNode>(null);
export const useInboxTabsSlot = () => useContext(InboxTabsSlot);
