import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * THE SHARED NOTICE: a plain-English card that says what is going on, why, and the one thing to do about it (M1, iOS
 * design audit 11-16: "Your page is hidden right now ... Ask us why" sat as loose text between cards on Home, Selling
 * and You, read as an alarm and gave no reason). A title, an optional icon, the reason as body text and an optional
 * action under it. `warn` is for something that needs the member; `info` is calm and is the default.
 * Declutter's DeclutterNotice draws through this. Guard: src/components/ui/Notice.test.tsx.
 */
export function Notice({ title, children, tone = "info", icon: Icon, action, className = "", ...data }: {
  title: string;
  children?: ReactNode;
  tone?: "info" | "warn";
  icon?: LucideIcon;
  /** The one thing to do (a shared Button or link). */
  action?: ReactNode;
  className?: string;
} & { [k: `data-${string}`]: string | undefined }) {
  return (
    <div
      {...data}
      data-notice={tone}
      role={tone === "warn" ? "alert" : "status"}
      className={`rounded-2xl border p-4 text-sm ${tone === "warn" ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" : "border-border bg-card text-foreground"} ${Icon ? "flex items-start gap-3" : ""} ${className}`}
    >
      {Icon && <Icon className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />}
      <div className={Icon ? "min-w-0 flex-1" : undefined}>
        <p className="font-semibold">{title}</p>
        {children && <div className="mt-1 text-muted-foreground">{children}</div>}
        {action && <div data-notice-action="" className="mt-3">{action}</div>}
      </div>
    </div>
  );
}
