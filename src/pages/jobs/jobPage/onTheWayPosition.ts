import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";

type OnTheWayPosition = { status: string | null; latitude: number | null; longitude: number | null };

/** The Helpr's latest point on the job_tracking row his en-route watch writes (RLS: the job's two parties). */
export async function fetchOnTheWayPosition(jobId: string): Promise<OnTheWayPosition | null> {
  return unwrap(
    await supabase.from("job_tracking").select("status, latitude, longitude").eq("job_id", jobId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ) as OnTheWayPosition | null;
}
