import type { ReactNode } from "react";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { adminActivityRows } from "./constants";
import type { Row } from "./types";

/**
 * The "Member activity" group on the Notifications screen, admins only (owner 11-12, migration 20261112061000): the
 * admin bell's notice for every real member activity (listings, offers, sales, jobs, Shops orders). The notices are
 * always in the bell; this switch only adds push and email, both OFF by default (one per activity would flood them).
 * Not a member-facing preference: an account that is not an admin never gets these notices, so it never sees the row.
 */
export function AdminActivityNotificationGroup({ renderRow }: { renderRow: (row: Row) => ReactNode }) {
  const { isAdmin } = useCurrentUser();
  if (!isAdmin) return null;
  return (
    <>
      <div
        className="px-3 min-[360px]:px-4 pt-3 pb-1.5 shrink-0"
        style={{ borderBottom: "0.5px solid hsl(var(--olivewood) / 0.08)" }}
        data-testid="admin-activity-notification-group"
      >
        <h2 className="font-sans font-semibold text-ds-13 mb-0" style={{ color: "hsl(var(--ink-deep))" }}>
          Admin
        </h2>
        <p className="font-sans mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Member activity always lands in the bell icon. Push and email are off unless you turn them on.
        </p>
      </div>
      {adminActivityRows.map((r) => renderRow(r))}
    </>
  );
}
