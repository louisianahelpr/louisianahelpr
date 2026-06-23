import { useNavigate } from "react-router-dom";
import { Plus, ClipboardList, MessageSquare, Bookmark, Calendar } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * DashboardRightRail — desktop-only ("web-desktop") right rail beside the
 * Dashboard job feed. Surfaces quick actions and shortcuts so a wide desktop
 * viewport reads as a multi-column app instead of a single phone column
 * floating in gray gutters.
 *
 * Rendered only inside the web-desktop layout: its own `hidden lg:flex`
 * utility hides it below the lg breakpoint, AND it lives inside the
 * `app-shell-frame`, which is only un-capped (full width) on
 * `html.web-desktop`. On mobile/native this column is `display:none`, so the
 * feed keeps the full width exactly as today.
 *
 * First pass: static quick-action shortcuts. Intentionally does not re-query
 * data the page already owns — it's a navigational rail, not a second feed.
 */

interface RailAction {
  icon: LucideIcon;
  label: string;
  sublabel: string;
  to: string;
  primary?: boolean;
}

const ACTIONS: RailAction[] = [
  { icon: Plus, label: "Post a task", sublabel: "Get help today", to: "/post-job", primary: true },
  { icon: ClipboardList, label: "My jobs", sublabel: "Track active work", to: "/activity?tab=applied" },
  { icon: MessageSquare, label: "Messages", sublabel: "Your conversations", to: "/messages" },
  { icon: Bookmark, label: "Saved", sublabel: "Helprs you saved", to: "/saved-helpers" },
  { icon: Calendar, label: "Schedule", sublabel: "Set availability", to: "/availability" },
];

export function DashboardRightRail() {
  const navigate = useNavigate();

  return (
    <aside
      aria-label="Quick actions"
      className="hidden lg:flex lg:flex-col lg:w-[300px] xl:w-[340px] shrink-0 gap-4 overflow-y-auto no-scrollbar pl-4 pb-6"
    >
      <div
        className="rounded-ds-lg p-4"
        style={{
          background: "var(--glass-bg-crisp, hsl(0 0% 100% / 0.97))",
          border: "1px solid hsl(var(--olivewood) / 0.1)",
          boxShadow: "0 1px 2px hsl(var(--olivewood) / 0.06)",
        }}
      >
        <h2
          className="mb-3 font-display italic"
          style={{ fontSize: "var(--headline-card, 1.05rem)", color: "hsl(var(--ink-deep))" }}
        >
          Quick actions
        </h2>
        <ul className="flex flex-col gap-2">
          {ACTIONS.map(({ icon: Icon, label, sublabel, to, primary }) => (
            <li key={to}>
              <button
                onClick={() => navigate(to)}
                className="group flex w-full items-center gap-3 rounded-ds-md px-3 py-2.5 text-left transition-colors"
                style={{
                  background: primary
                    ? "hsl(var(--bark) / 0.08)"
                    : "hsl(var(--olivewood) / 0.04)",
                }}
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: primary ? "hsl(var(--bark))" : "hsl(var(--olivewood) / 0.1)",
                    color: primary ? "hsl(var(--parchment))" : "hsl(var(--bark))",
                  }}
                >
                  <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                </span>
                <span className="min-w-0">
                  <span
                    className="block truncate font-display italic font-semibold"
                    style={{ fontSize: "0.95rem", color: "hsl(var(--ink-deep))" }}
                  >
                    {label}
                  </span>
                  <span
                    className="block truncate text-ds-12"
                    style={{ color: "hsl(var(--olivewood))" }}
                  >
                    {sublabel}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

export default DashboardRightRail;
