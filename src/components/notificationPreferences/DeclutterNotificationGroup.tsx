import { useEffect, useRef, type ReactNode } from "react";
import { useFeature } from "@/hooks/useFeature";
import { declutterRows } from "./constants";
import type { Row } from "./types";

/**
 * The "Declutter" group on the Notifications screen (owner 2026-10-28, via the
 * lead: "Yes, build them"): one switch per declutter_* notification kind
 * (migration 20261028162048). Shown only to a member who has Declutter, and
 * the Wanted matches row only while Wanted is on for them. Its own component
 * so the switch reads happen only where the group can show.
 */
export function DeclutterNotificationGroup({ renderRow }: { renderRow: (row: Row) => ReactNode }) {
  const declutterOn = useFeature("declutter");
  const wantedOn = useFeature("declutter_wanted");
  const heading = useRef<HTMLDivElement>(null);
  // Declutter settings' Notifications row links here with ?show=declutter: open at this group, not the top of the screen.
  useEffect(() => {
    if (!declutterOn || new URLSearchParams(window.location.search).get("show") !== "declutter") return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    heading.current?.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [declutterOn]);
  if (!declutterOn) return null;
  return (
    <>
      <div
        ref={heading}
        className="px-3 min-[360px]:px-4 pt-3 pb-1.5 shrink-0"
        style={{ borderBottom: "0.5px solid hsl(var(--olivewood) / 0.08)" }}
        data-testid="declutter-notification-group"
      >
        <h3 className="font-sans font-semibold text-ds-13 mb-0" style={{ color: "hsl(var(--ink-deep))" }}>
          Declutter
        </h3>
        <p className="font-sans mt-0.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Buying and selling your things. Everything still lands in the bell icon.
        </p>
      </div>
      {declutterRows.filter((r) => r.key !== "declutter_wanted" || wantedOn).map((r) => renderRow(r))}
    </>
  );
}
