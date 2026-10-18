import { safeStorage } from "@/lib/safeStorage";

/**
 * Did the Profile landing on THIS device last show the Declutter row?
 *
 * A LAYOUT hint for the landing's skeleton only, never the switch: the row
 * itself still waits for the server's answer (useFeature, fail-closed). The
 * skeleton draws an inert row-shaped box when the hint is set, so a returning
 * tester's Work list sits where the loaded one will (Q1894: it was 90px
 * higher). A device whose hint is wrong (the switch changed, or a different
 * account signed in) sees the list move once at the skeleton-to-page swap,
 * as a finished-payout account already does for the setup row.
 */
const KEY = "helpr_declutter_row";

export function rememberDeclutterRow(on: boolean): void {
  if (on) safeStorage.setItem(KEY, "1");
  else safeStorage.removeItem(KEY);
}

export function declutterRowHint(): boolean {
  return safeStorage.getItem(KEY) === "1";
}
