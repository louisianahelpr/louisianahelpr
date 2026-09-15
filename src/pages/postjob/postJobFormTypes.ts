// `JobRow` (the whole jobs Row) lived here for the rebook loader, which read a
// job with `select("*")` and cast to it. That read now names its columns and
// types them with `readableJobRow` (src/lib/jobColumns.ts), because
// jobs.offered_to_helper_id is not client-selectable (20260915045110) — so
// nothing referenced this type any more and knip reported it dead.

export type Step = "entry" | "form" | "checkout";
