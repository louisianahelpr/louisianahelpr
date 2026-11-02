/** One member on a crew job (GroupJobHelpers.tsx). */
export type GroupHelper = {
  id: string;
  /** NULL once this member deletes their account — the slot is retained, the
      identity is severed. See FORMER_MEMBER_LABEL. */
  helper_id: string | null;
  status: string;
  helperName?: string;
  /* This member's own lifecycle stamps (Q1382). Optional: a caller that did
     not select them gets the hire status pill and no arrival control. */
  helper_confirmed_at?: string | null;
  helper_on_the_way_at?: string | null;
  helper_arrived_at?: string | null;
  poster_confirmed_arrival_at?: string | null;
  helper_completed_at?: string | null;
  /** JOBS-3: the poster confirmed this member's work (rpc_poster_approve_member); they are paid on their own. */
  poster_confirmed_completion_at?: string | null;
};
