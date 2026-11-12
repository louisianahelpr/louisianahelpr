import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { ChecklistProgress } from "./FirstJobHome";
import "@/lib/i18n/enHome";
import { useLanguage } from "@/lib/i18n/language";

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
export function usePosterFirstJob(userId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["home", "poster-first-job", userId],
    enabled: !!userId && enabled,
    staleTime: 60_000,
    queryFn: async () =>
      posterFirstJobState(
        unwrap(
          await supabase.from("jobs").select("helper_id, status, poster_completed_at").eq("customer_id", userId!).limit(50),
        ) ?? [],
      ),
  });
}

export function PosterFirstJobCard({ userId }: { userId: string | undefined }) {
  const navigate = useNavigate();
  const { data } = usePosterFirstJob(userId);
  const { t } = useLanguage();
  if (!data || !data.posted || data.finished) return null;
  const steps = [
    { key: "post", label: t("home.pf.post"), done: true, go: () => navigate("/posts") },
    { key: "hire", label: t("home.pf.hire"), done: data.hired, go: () => navigate("/posts") },
    { key: "approve", label: t("home.pf.approve"), done: false, go: () => navigate("/posts") },
  ];
  return (
    <section aria-label={t("home.pf.title")} data-testid="poster-first-job" className="flex flex-col gap-1 px-1">
      <ChecklistProgress title={t("home.pf.title")} steps={steps} />
    </section>
  );
}
