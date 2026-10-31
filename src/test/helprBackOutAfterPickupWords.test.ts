/**
 * AUD31-9 (Declutter delivery audit, 2026-10-31): a Helpr pressing Back out after the pickup (a stale page) read "The
 * buyer already picked up this item." The Helpr has the item; helpr_task_release raises already_picked_up with its own
 * hint, "You already have the item. Deliver it, or report a problem." The Helpr's copy is that hint, read from the
 * newest helpr_task_release, so the two cannot drift; the buyer's copy for the same code is unchanged.
 *
 * @mutate src/lib/helprTasks/errorCopy.ts |     already_picked_up: "You already have the item. Deliver it, or report a problem.", |     already_picked_up: DC.already_picked_up,
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { rpcErrorMessage } from "@/lib/helprTasks/errorCopy";
import { DECLUTTER_ERROR_COPY } from "@/lib/declutter/errors";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));

describe("AUD31-9: Back out after the pickup speaks to the Helpr", () => {
  it("the Helpr's message is the server's own hint, not the buyer's line", () => {
    const def = DEFS.get("helpr_task_release");
    expect(def, "helpr_task_release has a definition").toBeTruthy();
    const body = blankSqlComments(def!.stmt);
    const hint = /'already_picked_up'[^;]*HINT = '((?:[^']|'')*)'/.exec(body)?.[1]?.replace(/''/g, "'");
    expect(hint?.length ?? 0).toBeGreaterThan(10);
    const msg = rpcErrorMessage("helpr_task_release", { message: "already_picked_up", code: "55000" });
    expect(msg).toBe(hint);
    expect(msg).not.toBe(DECLUTTER_ERROR_COPY.already_picked_up);
    expect(DECLUTTER_ERROR_COPY.already_picked_up).toBe("The buyer already picked up this item.");
  });
});
