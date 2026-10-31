import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { ChecklistSteps } from "./FirstJobHome";

/** The poster's side of the first week (UX-5, owner approved 10-29): read from the member's own posted jobs. */
export interface PosterFirstJobState {
  /** Posted at least one job. */
  posted: boolean;
  /** One of their posted jobs has someone hired on it. */
  hired: boolean;
  /** One of their posted jobs is finished (they approved it, or it is completed). */
  finished: boolean;
}

/** From the member's posted jobs (RLS: "Users can view their own jobs"). Exported for its test. */
export function posterFirstJobState(jobs: { helper_id: string | null; status: string | null; poster_completed_at: string | null }[]): PosterFirstJobState {
  return {
    posted: jobs.length > 0,
    hired: jobs.some((j) => !!j.helper_id),
    finished: jobs.some((j) => !!j.poster_completed_at || j.status === "completed"),
  };
}

/**
 * UX-5 (Growth and ops, owner approved 10-29: "First-week checklist on Home for new Helprs and posters"). The Helpr half
 * is FirstJobHome's "Get your first job" (a member with no job history). This is the poster half: a member who has
 * posted a job and has not had one finished yet sees where they are: posted, hired, approved. It leaves once a posted
 * job is finished, and draws nothing while loading, on a failed read, or before a first post (the first-job card covers
 * a newcomer). Never role-based: any member who posted sees it, whatever else they do.
 * Guard: src/test/posterFirstJobCard.test.tsx.
 */
export function PosterFirstJobCard({ userId }: { userId: string | undefined }) {
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["home", "poster-first-job", userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async () =>
      posterFirstJobState(
        unwrap(
          await supabase.from("jobs").select("helper_id, status, poster_completed_at").eq("customer_id", userId!).limit(50),
        ) ?? [],
      ),
  });
  if (!data || !data.posted || data.finished) return null;
  const steps = [
    { key: "post", label: "Post your first job", done: true, go: () => navigate("/posts") },
    { key: "hire", label: "Hire a Helpr", done: data.hired, go: () => navigate("/posts") },
    { key: "approve", label: "Approve the work when it's done", done: false, go: () => navigate("/posts") },
  ];
  return (
    <section aria-label="Your first job posted" data-testid="poster-first-job" className="liquid-glass p-card flex flex-col gap-1">
      <h2 className="text-ds-12 font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-1">Your first job posted</h2>
      <ChecklistSteps steps={steps} />
    </section>
  );
}
