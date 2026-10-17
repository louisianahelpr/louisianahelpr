import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useFeatureStatus } from "@/hooks/useFeature";
import { rememberDeclutterRow } from "./declutterRowHint";
import { DECLUTTER_ROW_CLASS, DeclutterRowBody } from "./DeclutterRowShape";

/**
 * The phone entry to Declutter (docs/specs/declutter-auctions.md row 1), on
 * the Profile landing while the hidden 'declutter' switch is on for this
 * member; nothing at all otherwise. The desktop rail lists it as a
 * destination too (DesktopSidebarNav). A tab of its own in the phone dock
 * waits for a look at 375 with six tabs (spec build decision B21).
 *
 * Profile.tsx holds the landing's skeleton until the switch has answered
 * (Q1894), so this row is in the landing's FIRST paint instead of pushing the
 * settings list 90px down ~50 ms later. Each settled answer is remembered as
 * the skeleton's layout hint (declutterRowHint.ts).
 */
export function DeclutterEntryRow() {
  const { on, settled } = useFeatureStatus("declutter");
  useEffect(() => {
    if (settled) rememberDeclutterRow(on);
  }, [settled, on]);
  if (!on) return null;
  return (
    <Link to="/declutter" className={DECLUTTER_ROW_CLASS}>
      <DeclutterRowBody />
    </Link>
  );
}
