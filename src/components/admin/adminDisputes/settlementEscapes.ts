/**
 * The two ways out for a decided dispute whose settlement cannot run, moved out
 * of AdminDisputes.tsx (component-size ratchet) with their bodies unchanged:
 *   - closeWithoutPayment: a job with NO payment on file (Q235);
 *   - clearTestModeRecords: a split that ran in Stripe TEST mode (Q1732);
 *   - closeAsTest: a decided dispute on a Stripe TEST-mode payment between
 *     test accounts, closed as "test, no money moved" (Q1769).
 * Both are admin-only on the server, gated by the biometric prompt here, and
 * reload the queue when they finish.
 */
import type { Dispatch, SetStateAction } from "react";
import { confirmConsequential } from "@/lib/toastPolicy";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { report } from "@/lib/errorLogger";
import { functionErrorMessage } from "@/lib/supabaseResult";
import { requireBiometric } from "@/lib/biometricGate";
import { userFacingError } from "@/lib/userFacingError";
import { rpcErrorMessage } from "@/components/admin/adminRpcErrorCopy";
import type { DisputedJob, DisputeRecord } from "./types";

export function settlementEscapes({
  disputeRecords,
  setRetrying,
  loadDisputes,
}: {
  disputeRecords: Record<string, DisputeRecord>;
  setRetrying: Dispatch<SetStateAction<string | null>>;
  loadDisputes: () => unknown;
}) {
  /**
   * Close a decided dispute whose job has NO payment on file (Q235). The split
   * refuses such a job ("no payment intent on file"), so "Retry settlement"
   * can only fail again; this records the settlement as moving nothing, with
   * the admin's reason, through rpc_settle_dispute_without_payment. The RPC
   * re-checks every condition under row locks and raises on anything it did
   * not write, so a null error here means the dispute row changed.
   */
  const closeWithoutPayment = async (job: DisputedJob, note: string) => {
    const disputeId = disputeRecords[job.id]?.id ?? null;
    if (!disputeId) {
      toast.error("This dispute has no formal record to close.");
      return;
    }
    const ok = await requireBiometric("Confirm closing this settlement with no payment");
    if (!ok) return;
    setRetrying(job.id);
    try {
      const { error } = await supabase.rpc(
        "rpc_settle_dispute_without_payment",
        { _dispute_id: disputeId, _note: note.trim() },
      );
      if (error) {
        toast.error(rpcErrorMessage("rpc_settle_dispute_without_payment", error) ?? userFacingError(error, "Couldn't close that settlement — try again."));
        return;
      }
      confirmConsequential("Settlement closed. No payment was on file, so nothing moved.");
    } catch (err: unknown) {
      // A thrown call (network drop, client fault) never reached the RPC's
      // refusals above: say so, and report it, instead of an unhandled rejection.
      report(err, { tags: { source: "AdminDisputes.closeWithoutPayment" } });
      toast.error(userFacingError(err, "Couldn't close that settlement — try again."));
    } finally {
      setRetrying(null);
      loadDisputes();
    }
  };

  /**
   * Q1732 (owner, 2026-10-12): un-stick a decided dispute that ran in Stripe
   * TEST mode. execute-dispute-split's clear_test_mode_records branch asks
   * Stripe about every refund and transfer id the books and the dispute hold,
   * clears them only if EVERY one is a test-mode object
   * (clear_test_mode_dispute_ledger: admin, audited, compare-and-set), then
   * supersedes the decision as this admin so it can be decided again. A live
   * id refuses with nothing changed. Pressing it twice does nothing twice.
   */
  const clearTestModeRecords = async (job: DisputedJob, note: string) => {
    const disputeId = disputeRecords[job.id]?.id ?? null;
    if (!disputeId) {
      toast.error("This dispute has no formal record to clear.");
      return;
    }
    const ok = await requireBiometric("Confirm clearing this dispute's test-mode records");
    if (!ok) return;
    setRetrying(job.id);
    try {
      const { data, error } = await supabase.functions.invoke("execute-dispute-split", {
        body: { dispute_id: disputeId, action: "clear_test_mode_records", reason: note.trim() },
      });
      const invokeError = error ?? (data?.error ? new Error(String(data.error)) : null);
      if (invokeError) {
        report(invokeError, { tags: { source: "AdminDisputes.clearTestModeRecords" } });
        // A non-2xx carries the server's own words in its Response body; a 2xx
        // with an error envelope carries them in data.error.
        toast.error(
          error
            ? await functionErrorMessage(error, "Couldn't clear the test-mode records — nothing was changed; try again.")
            : String(data.error),
        );
        return;
      }
      confirmConsequential(
        (data as { action?: string } | null)?.action === "already_superseded"
          ? "Already done: this decision was re-opened earlier."
          : "Test-mode records cleared. The dispute is open again to decide.",
      );
    } catch (err: unknown) {
      report(err, { tags: { source: "AdminDisputes.clearTestModeRecords" } });
      toast.error(userFacingError(err, "Couldn't clear the test-mode records — try again."));
    } finally {
      setRetrying(null);
      loadDisputes();
    }
  };

  /**
   * Q1769 (owner, 2026-10-15): close a decided dispute on a Stripe TEST-mode
   * payment between test accounts as a test, with no money moved.
   * rpc_close_test_mode_dispute re-checks under row locks that the job was
   * paid in test mode (cs_test_ session), that every party is a test account,
   * that no gift card (live money) and no refund or transfer record is on it,
   * and closes the job's payment so nothing pays it out afterwards. It raises
   * on anything it did not write, so a null error here means it closed.
   */
  const closeAsTest = async (job: DisputedJob, note: string) => {
    const disputeId = disputeRecords[job.id]?.id ?? null;
    if (!disputeId) {
      toast.error("This dispute has no formal record to close.");
      return;
    }
    const ok = await requireBiometric("Confirm closing this test-mode dispute");
    if (!ok) return;
    setRetrying(job.id);
    try {
      const { error } = await supabase.rpc(
        "rpc_close_test_mode_dispute",
        { _dispute_id: disputeId, _note: note.trim() },
      );
      if (error) {
        toast.error(rpcErrorMessage("rpc_close_test_mode_dispute", error) ?? userFacingError(error, "Couldn't close that dispute — try again."));
        return;
      }
      confirmConsequential("Closed as a test. No real money moved.");
    } catch (err: unknown) {
      // A thrown call never reached the RPC's refusals: say so, and report it.
      report(err, { tags: { source: "AdminDisputes.closeAsTest" } });
      toast.error(userFacingError(err, "Couldn't close that dispute — try again."));
    } finally {
      setRetrying(null);
      loadDisputes();
    }
  };

  return { closeWithoutPayment, clearTestModeRecords, closeAsTest };
}
