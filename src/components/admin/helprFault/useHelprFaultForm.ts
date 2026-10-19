// Q2082 (b): the "Helpr at fault" part of Admin > Jobs' refund dialog (always
// a full refund), moved out of AdminJobs.tsx (component size ratchet).
import { useState } from "react";
import type { RefundHelprFaultState } from "../adminJobs/RefundJobDialog";
import { helprFaultBody, useHelprFaultCandidate, type HelprFaultBody, type HelprFaultKind } from "./helprFault";

export function useHelprFaultForm(
  jobId: string | undefined,
  jobHelperId: string | null | undefined,
  open: boolean,
  helperName: string,
): { on: boolean; body: () => HelprFaultBody | null; reset: () => void; dialog: RefundHelprFaultState } {
  const [on, setOn] = useState(false);
  const [kind, setKind] = useState<HelprFaultKind>("no_show");
  const [note, setNote] = useState("");
  const candidate = useHelprFaultCandidate(jobId, jobHelperId, open && on);
  return {
    on,
    body: () => (on ? helprFaultBody(candidate.helperId, kind, note) : null),
    reset: () => { setOn(false); setKind("no_show"); setNote(""); },
    dialog: {
      on,
      helperId: candidate.helperId,
      helperName: candidate.helperId && candidate.helperId === jobHelperId ? helperName : null,
      loading: candidate.loading,
      kind,
      note,
      onToggle: setOn,
      onKindChange: setKind,
      onNoteChange: setNote,
    },
  };
}
