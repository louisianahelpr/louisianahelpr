// PayPal phase 6: was this job paid through PayPal? (a funded provider_payments row for the job,
// or a repeat-visit payment that funds it). An Error when the read fails: the caller charges
// nothing. A missing table/column (the function deployed before the migration) reads "no".

// deno-lint-ignore no-explicit-any
type Db = any;

const FUNDED = ["captured", "partially_refunded", "refunded", "disputed", "capture_pending"];
const NOT_DEPLOYED = ["42P01", "42703", "PGRST204", "PGRST205"];

export async function paypalFundedJob(db: Db, jobId: string): Promise<boolean | Error> {
  const [own, visit] = await Promise.all([
    db.from("provider_payments").select("id").eq("subject_kind", "job").eq("subject_id", jobId).in("status", FUNDED).limit(1),
    db.from("provider_payments").select("id").eq("funds_job_id", jobId).in("status", FUNDED).limit(1),
  ]);
  for (const r of [own, visit]) {
    if (r.error && !NOT_DEPLOYED.includes(r.error.code ?? "")) return new Error(r.error.message);
  }
  return (own.data ?? []).length > 0 || (visit.data ?? []).length > 0;
}
