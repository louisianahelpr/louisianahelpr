/**
 * 11-07 free-claim trace: what happens to a first-timer the giver picks. declutter_pick_free_request books the asked
 * time only for a member already verified; anyone else gets the item held, clears declutter_free_claim_gate, then
 * chooses the pickup time. Said the same way in the Ask sheet and How it works, and only for a member whose first
 * pick has something ahead (the callers' oneTimeCheckAhead).
 *
 * The ID check is named only while the identity_check switch is on (identityCheckOn(), the class guard
 * identityCheckOffEntryPoints c2). With it off the gate asks for nothing (identity_check_exempt), so the steps are
 * just: choose the time, get the address.
 */
import { identityCheckOn } from "@/lib/identityCheckSwitch";
import { t } from "@/lib/i18n/language";

/** F260q: the words are enFree.ts's (free.stepsId / free.stepsNoId), registered by both callers' panel (DeclutterFreeClaim). */
export function firstPickSteps(idCheckOn: boolean = identityCheckOn()): string {
  return idCheckOn ? t("free.stepsId") : t("free.stepsNoId");
}
