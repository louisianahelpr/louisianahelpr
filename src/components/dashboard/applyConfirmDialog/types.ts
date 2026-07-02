import type { Dispatch, SetStateAction } from "react";
import type { EnrichedJob } from "@/components/dashboard/types";

export interface ApplyConfirmDialogProps {
  /** Whether the dialog is open — true once a feed job has been picked. */
  open: boolean;
  /** Closes the dialog (clears the parent's pending-apply job id). */
  onClose: () => void;
  /** The job being applied to, resolved from the loaded feed. May be null
   *  if the pending id isn't in the loaded pages — a generic prompt shows. */
  confirmApplyJob: EnrichedJob | null;
  /** Platform commission percentage, for the take-home breakdown. */
  platformFee: number;
  applyMessage: string;
  setApplyMessage: (value: string) => void;
  applyFiles: File[];
  setApplyFiles: Dispatch<SetStateAction<File[]>>;
  /** True while the application is being submitted — disables the controls. */
  applyLoading: boolean;
  /** Optional reliability stake amount ($5, $10, $25, or null). */
  stakeAmount: number | null;
  setStakeAmount: (value: number | null) => void;
  /** Proposed bid price (only relevant when job pricing_mode='accept_bids'). */
  bidPrice: string;
  setBidPrice: (value: string) => void;
  /** Submits the application. */
  handleApplyConfirm: () => void;
}
