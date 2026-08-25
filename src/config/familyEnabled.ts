/**
 * Master kill switch for Family & Care — the care-relationship dashboard at
 * `/family`, its Profile row, and the invite-accept flow.
 *
 * Turned OFF 2026-08-23 at the owner's request: "I think remove Family & Care
 * bc you literally just post the job on their behalf? like it seems pointless."
 *
 * That is a fair read of what it currently does. The feature lets you link a
 * relative and manage jobs for them — but the app already has no role model
 * (every account can post AND work), the poster's address and payment are
 * already the poster's, and nothing in the job flow behaves differently for a
 * job posted "for" somebody else. So the whole surface amounted to a second
 * place to press Post a Job, plus a relationship row nothing else reads.
 *
 * Nothing is deleted. The pages, components, queries, tables and RLS all remain,
 * so flipping this back to `true` restores the feature. Mirrors the existing
 * `RECURRING_ENABLED` switch.
 *
 * BEFORE RE-ENABLING, it needs a reason to exist that posting a job does not
 * already cover — the obvious one being that the CARED-FOR person, not the
 * poster, is who the helpr meets and whose address and access notes apply. None
 * of that is modelled today.
 */
export const FAMILY_ENABLED = false;
