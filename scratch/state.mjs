import { restQ } from "./lib.mjs";
const JOB="e6979a12-ee25-46c9-98f5-c088189849e5";
const j=(await restQ(`jobs?id=eq.${JOB}&select=status,payment_status,helper_confirmed_at,helper_on_the_way_at,helper_arrived_at,helper_completed_at,poster_completed_at,poster_confirmed_at,accepted_at`))[0];
console.log("JOB:", JSON.stringify(j,null,1));
console.log("APPS:", JSON.stringify(await restQ(`applications?job_id=eq.${JOB}&select=status`)));
console.log("TRANSFERS:", JSON.stringify(await restQ(`payout_transfers?job_id=eq.${JOB}&select=id,status,amount_cents`)));
console.log("REVIEWS:", JSON.stringify(await restQ(`reviews?job_id=eq.${JOB}&select=reviewer_id,reviewee_id,rating`)));
