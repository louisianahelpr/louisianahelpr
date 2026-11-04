// helpr-travel-estimates (Q2485): every 15 minutes (cron job helpr-travel-estimates, migration 20261104114456), measure
// the drive time of each hired Helpr with a job 35 minutes to 3 hours out, from their saved device position to the job,
// with Apple Maps, and store it in helpr_travel_estimates. sweep_helpr_start_reminders then sends "Time to head out" at
// start minus that time (the owner's Q2483 rule; 30 minutes before with no estimate). The work is
// _shared/travelEstimates.ts storeTravelEstimates. No member input: cron secret only; positions go to Apple and nowhere
// else, and logs carry counts only.
import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "../_shared/buildStamp.ts";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { verifyCronSecret } from "../_shared/cron-auth.ts";
import { cronError, cronResult } from "../_shared/cron-result.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { mapkitKeyFromEnv, signMapkitJwt } from "../_shared/mapkitJwt.ts";
import { type TravelStore, storeTravelEstimates } from "../_shared/travelEstimates.ts";

const FN = "helpr-travel-estimates";

serve(async (req: Request) => {
  const refused = verifyCronSecret(req);
  if (refused) return refused;
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "",
      { auth: { persistSession: false }, global: { fetch: boundedFetch() } },
    );
    const key = mapkitKeyFromEnv((name) => Deno.env.get(name));
    const apple = key ? { developerToken: () => signMapkitJwt(key, 300) } : null;
    const run = await storeTravelEstimates(admin as unknown as TravelStore, apple);
    console.log(JSON.stringify({ event: "helpr_travel_estimates", pairs: run.pairs, stored: run.stored, missed: run.missed }));
    // A stopped run dropped every pair (a read, the key, the token or the write failed): a defect the cron sweep alerts on.
    // A single route Apple could not answer is an outcome: that job keeps the 30-minute rule.
    return cronResult(FN, { pairs: run.pairs, stored: run.stored, missed: run.missed },
      run.stopped ? { count: 1, reasons: [run.stopped] } : { count: 0 });
  } catch (e) {
    return cronError(FN, caughtMessage(e));
  }
});
