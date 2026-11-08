import type { ReactNode } from "react";
import { useFeature } from "@/hooks/useFeature";
import { shopsRows } from "./constants";
import type { Row } from "./types";

/**
 * The "Shops" group on the Notifications screen (shops audit 11-08 #6, migration 20261108201153): one switch per
 * shops_* notification kind (orders, shop messages, shop updates), all ON by default, so a shop's new orders no longer
 * ride the Jobs "Job offers" switch. Shown only to a member who has Shops; its own component so the switch read
 * happens only where the group can show.
 */
export function ShopsNotificationGroup({ renderRow }: { renderRow: (row: Row) => ReactNode }) {
  const shopsOn = useFeature("shops");
  if (!shopsOn) return null;
  return (
    <>
      <div
        className="px-3 min-[360px]:px-4 pt-3 pb-1.5 shrink-0"
        style={{ borderBottom: "0.5px solid hsl(var(--olivewood) / 0.08)" }}
        data-testid="shops-notification-group"
      >
        <h2 className="font-sans font-semibold text-ds-13 mb-0" style={{ color: "hsl(var(--ink-deep))" }}>
          Shops
        </h2>
        <p className="font-sans mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Your shop and what you order from shops. Everything still lands in the bell icon.
        </p>
      </div>
      {shopsRows.map((r) => renderRow(r))}
    </>
  );
}
