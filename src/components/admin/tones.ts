/**
 * Semantic tone classes for admin surfaces.
 *
 * The admin panel has ~180 places that reach for raw palette utilities
 * (text-red-800, bg-amber-100, dark:text-red-300, …) to color status
 * badges, severity chips, and health indicators. Each spot re-picks its
 * own shade, so the exact same "high severity" tone renders as 4-5
 * different colors across the admin views — the audit called this the
 * biggest cohesion-debt hotspot in the app.
 *
 * The fix is a one-shot semantic map: pick a SEVERITY, ask for the
 * classes. Every "danger" chip pulls the same string; a future palette
 * edit changes one line and every admin surface follows.
 *
 * Migration: AdminFraudDashboard is the anchor case that adopts this.
 * The remaining admin files (AdminHealth, AdminAuditLog, AdminHelperTiers,
 * AdminExceptionQueue, …) each still hand-pick shades and should be
 * migrated as they're touched. Grep the codebase for
 * `text-(red|amber|yellow|green|blue)-\d+` to find remaining offenders.
 */

export type Tone = "danger" | "warning" | "notice" | "success" | "info" | "neutral";

/**
 * Full badge-shaped tone classes (background + foreground for both
 * light and dark). Use on <Badge>, <span>, or any pill-style status
 * indicator. Every admin severity chip should pull from here.
 */
export const toneBadgeClasses: Record<Tone, string> = {
  danger:
    "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  warning:
    "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  notice:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  success:
    "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  info:
    "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  neutral:
    "bg-muted text-muted-foreground",
};

/**
 * Foreground-only variant for icons/text labels next to a value.
 */
export const toneTextClasses: Record<Tone, string> = {
  danger: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  notice: "text-yellow-600 dark:text-yellow-400",
  success: "text-green-600 dark:text-green-400",
  info: "text-blue-600 dark:text-blue-400",
  neutral: "text-muted-foreground",
};
