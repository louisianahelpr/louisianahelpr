import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { formatJobDate } from "@/lib/dateUtils";
import { formatPrice } from "@/lib/format";
import type { Conversation } from "../types";
import { dealStage, DEAL_STEPS, type DealJob } from "./dealStage";

/**
 * The deal-room chat's pinned card (board 2; chat halves of 59, 61, 62, 63).
 *
 * What it shows is read, never guessed: the job row the viewer may read (RLS
 * "Users can view their own jobs"; a Helpr who applied but is not hired reads
 * it through get_jobs_for_my_applications, the same source Working uses), and
 * the Helpr-in-this-thread's application status. Anything it cannot read, it
 * hides; the whole card hides when the job cannot be read.
 *
 * NO ADDRESS (spec v2 §1.6): the area is the parish, never `location`.
 * ONE BUTTON, AND IT ONLY OPENS THE JOB: the job's own card on Posted or
 * Working, where the tracker's controls and their gates decide. The card
 * never writes, so it can never offer a step the tracker would refuse.
 */
const COLS =
  "id,title,category,date_needed,start_time,budget,status,helper_id,customer_id,payment_status,parish,helper_on_the_way_at,helper_arrived_at,helper_arrival_verified_at,poster_confirmed_arrival_at,poster_confirmed_working_at,helper_completed_at,has_active_dispute";

type DealRow = DealJob & {
  id: string;
  title: string;
  category: string | null;
  date_needed: string | null;
  start_time: string | null;
  budget: number | null;
  parish: string | null;
};

function clock(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function useDealCard(convo: Conversation, userId: string) {
  const viewerIsPoster = !!convo.viewerIsPoster;
  const helprId = viewerIsPoster ? convo.otherUserId : userId;
  return useQuery({
    queryKey: ["deal-card", convo.jobId, userId, convo.otherUserId],
    enabled: !convo.teamThread && !!convo.jobId && !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      let job = unwrap(
        await supabase.from("jobs").select(COLS).eq("id", convo.jobId).maybeSingle(),
      ) as DealRow | null;
      if (!job && !viewerIsPoster) {
        // Applied, not hired: the jobs row is not readable directly.
        const mine = unwrap(await supabase.rpc("get_jobs_for_my_applications")) as DealRow[] | null;
        job = (mine ?? []).find((j) => j.id === convo.jobId) ?? null;
      }
      if (!job) return null;
      let application: string | null = null;
      if (helprId) {
        const row = unwrap(
          await supabase
            .from("applications")
            .select("status")
            .eq("job_id", convo.jobId)
            .eq("helper_id", helprId)
            .maybeSingle(),
        ) as { status: string } | null;
        application = row?.status ?? null;
      }
      return { job, application };
    },
  });
}

export function DealCard({ convo, userId }: { convo: Conversation; userId: string }) {
  const navigate = useNavigate();
  const { data } = useDealCard(convo, userId);
  if (!data) return null;
  const { job, application } = data;
  const viewerIsPoster = !!convo.viewerIsPoster;
  const first = (convo.otherUserName || "").split(" ")[0] || "them";
  const stage = dealStage(job, viewerIsPoster, convo.otherUserId, userId, application, first);
  const Icon = getCategoryIcon(job.category);
  const when = [job.date_needed ? formatJobDate(job.date_needed) : null, clock(job.start_time)].filter(Boolean).join(" · ");
  const meta = [when || null, job.parish ? `${job.parish} Parish` : null].filter(Boolean).join(" · ");
  const open = () =>
    navigate(
      viewerIsPoster
        ? `/jobs?tab=posted&highlight=${job.id}&manage=1`
        : `/jobs?tab=working&highlight=${job.id}`,
    );

  return (
    <section
      aria-label="This job"
      data-testid="deal-card"
      className="w-full mt-3 shrink-0 rounded-2xl px-4 py-3 space-y-3"
      style={{ background: "hsl(var(--card))", boxShadow: "0 1px 2px hsl(220 14% 20% / 0.06), 0 4px 14px -6px hsl(220 14% 20% / 0.10)" }}
    >
      <div className="flex items-start gap-3">
        <span className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: "hsl(var(--sand))" }} aria-hidden>
          <Icon className="w-5 h-5" style={{ color: "hsl(var(--olivewood))" }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-sans font-semibold text-ds-14 leading-snug line-clamp-2 [overflow-wrap:anywhere]" style={{ color: "hsl(var(--ink-deep))" }}>{job.title}</p>
          {meta && <p className="font-sans text-ds-12 text-muted-foreground truncate">{meta}</p>}
        </div>
        {typeof job.budget === "number" && job.budget > 0 && (
          <div className="shrink-0 text-right">
            <p className="font-sans font-bold text-ds-16 tabular-nums" style={{ color: "hsl(var(--burnt-sienna))" }}>${formatPrice(job.budget)}</p>
            {stage.held && <p className="font-sans text-ds-11 text-muted-foreground">held safely</p>}
          </div>
        )}
      </div>

      {stage.step !== null && (
        <ol className="grid grid-cols-4 gap-1.5" aria-label={`Step ${stage.step} of 4: ${DEAL_STEPS[stage.step - 1]}`}>
          {DEAL_STEPS.map((name, i) => {
            const reached = i < (stage.step ?? 0);
            const current = i === (stage.step ?? 0) - 1;
            return (
              <li key={name} className="min-w-0" aria-current={current ? "step" : undefined}>
                <span className="block h-1 rounded-full" style={{ background: reached ? "hsl(var(--bark))" : "hsl(var(--olivewood) / 0.15)" }} />
                <span
                  className={`block mt-1 font-sans text-ds-10 truncate ${current ? "font-bold" : ""}`}
                  style={{ color: current ? "hsl(var(--ink-deep))" : "hsl(var(--muted-foreground))" }}
                >
                  {name}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="font-sans text-ds-12 min-w-0" style={{ color: "hsl(var(--olivewood) / 0.9)" }}>
          {stage.word && <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>{stage.word}</span>}
          {stage.word && stage.label && " · "}
          {stage.label}
        </p>
        <button
          type="button"
          onClick={open}
          className="btn-grad-primary shrink-0 rounded-full min-h-[40px] px-4 font-sans font-semibold text-ds-13"
        >
          Open job
        </button>
      </div>
    </section>
  );
}
